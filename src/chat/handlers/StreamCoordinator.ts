import * as vscode from "vscode"
import { DiffApplier } from "../../diff/DiffApplier"
import { TabManager, type TabState } from "../TabManager"
import { SessionManager } from "../../session/SessionManager"
import { SessionStore } from "../../session/SessionStore"
import { ContextEngine } from "../../context/ContextEngine"
import { ContextMonitor } from "../../monitor/ContextMonitor"
import { RateLimitMonitor } from "../../monitor/RateLimitMonitor"
import { estimateContextTokens, parseModelRef, estimateTokens } from "../../utils/tokenCounter"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"
import type { Block, ChatMessage } from "../types"
import type { Part } from "@opencode-ai/sdk"
import { partsToBlocks as sdkConvertPartsToBlocks } from "../../session/sdkMessageConverter"
import type { LiveToolOutputSnapshot } from "../../session/liveToolOutput"
import { StreamFinalizerService } from "./StreamFinalizerService"
import { MethodologyAdvisor, type MethodologyAdvice } from "../../methodology/MethodologyAdvisor"
import { classifyTool, isSubagentToolName, parseSubagentInvocation } from "./toolClassifier"
import { parseQuestionArgs, parseAllowFreeText } from "../../session/questionModel"
import type { AdvisoryOrchestrationResult } from "../../methodology/MethodologyOrchestrator"
import { updateMethodologyStatus } from "../../methodology/registry"
import { createAttachmentStorage, type MaterializedAttachment } from "./attachmentStorage"
import { RunActivityTracker } from "./RunActivityTracker"
import type { AgentRunState, RunProgressEvent, SubagentActivityInput, SubagentRunState, ToolActivityInput } from "./runActivityTypes"
import { SubagentHeartbeat } from "./SubagentHeartbeat"
import { mapRunError, type RunErrorContext } from "./runErrorMapper"
import { logStreamTrace } from "../../session/streamTrace"
import { modeToAgent } from "../modePolicy"

import type { StreamCallbacks, ToolEndResult, ToolPartialInput, StreamLifecycleState } from "./StreamCoordinatorTypes"
export type { StreamCallbacks, ToolEndResult, ToolPartialInput, StreamLifecycleState }

type ActiveRunState = "sending" | "accepted" | "streaming" | "finalizing" | "completed" | "failed" | "aborted" | "timeout" | "interrupted"

interface PromptRunIdentity {
  userMessageId?: string
  clientRequestId?: string
}

interface ActiveStreamRun {
  tabId: string
  cliSessionId?: string
  clientRequestId?: string
  userMessageId?: string
  assistantMessageId?: string
  mode?: string
  agent?: string
  model?: string
  startedAt: number
  state: ActiveRunState
}

function subagentStatusFromToolStatus(status: ToolActivityInput["status"]): SubagentActivityInput["status"] {
  switch (status) {
    case "pending": return "pending"
    case "running": return "running"
    case "completed":
    case "result": return "completed"
    case "failed":
    case "error":
    case "unresolved": return "failed"
    default: return "running"
  }
}

export class StreamCoordinator {
  private finalizerService: StreamFinalizerService
  /** Watchdog interval for streams with no server activity across all channels.
   *  Set to 45 min to accommodate long-running models (Minimax, DeepSeek, etc.)
   *  that may take extended time between streaming events (subagents, long
   *  thinking pauses, tool call gaps). Previously 10 min, then 30 min. */
  private readonly STREAM_STUCK_MS = 2_700_000
  /**
   * How long after an intentional `abort()` the late server `MessageAbortedError`
   * is treated as expected and suppressed. The SSE error normally lands within a
   * second or two; the window only gates abort-category errors, so it is safe to
   * keep generous. */
  private readonly ABORT_ERROR_SUPPRESS_MS = 8000
  /** Time-to-first-byte timeout: no chunk received within 45s */
  readonly TTFB_TIMEOUT_MS = 45000
  /** Short grace window for terminal status to be followed by late tool_end events */
  readonly TOOL_FINALIZE_GRACE_MS = 30000
  private readonly MAX_UNACKED_STREAM_CHUNKS = 8
  private readonly MAX_STREAM_DEFER_MS = 250
  /** Tracks last deferral log time per tab to suppress duplicate logging during long subagent waits. */
  private lastDeferralLogTs = new Map<string, number>()
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()
  private ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private ttfbAbortControllers: Map<string, AbortController> = new Map()
  private pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Tabs currently in the process of finalizing — guards against double-finalize */
  private finalizingTabs = new Set<string>()
  /** Tabs whose stream was explicitly aborted — finalizeStream must not emit its own stream_end */
  private abortedTabs = new Set<string>()
  /**
   * Per-tab expiry (epoch ms) of the "intentional abort" window. Set by `abort()`.
   * The server emits a `MessageAbortedError` on the SSE stream a beat after we call
   * `abortSession`, which is expected — not a failure. `wasIntentionallyAborted()`
   * lets the `server_error` handler swallow that error instead of surfacing a
   * spurious "The request was cancelled." card (and tearing down a replacement run
   * started by interrupt-and-send). Distinct from the one-tick `abortedTabs` set,
   * which only coordinates finalize/abort stream_end de-duplication.
   */
  private intentionalAbortUntil = new Map<string, number>()
  /** Per-tab stream lifecycle state for observability */
  private streamStates = new Map<string, StreamLifecycleState>()
  /** Per-tab accepted backend run identity. Distinct from the coarse streaming boolean. */
  private activeRuns = new Map<string, ActiveStreamRun>()
  /** Per-tab active message ID — detects when the server starts a new assistant message mid-stream */
  private activeMessageIds = new Map<string, string>()
  /** Per-tab set of server messageIds we've already logged a bubble-id mismatch for — dedupes the log to once per turn instead of once per chunk */
  private loggedBubbleMismatches = new Map<string, Set<string>>()
  /** Per-tab tool call counter for stable deterministic IDs when server IDs are missing */
  private toolCallCounts = new Map<string, number>()
  /** Per-tab pending tool call IDs. Set insertion order gives FIFO fallback for missing IDs. */
  private activeToolCallIds = new Map<string, Set<string>>()
  /** Last activity per pending tool, used when reconciling stale terminal states. */
  private toolActivityAt = new Map<string, Map<string, number>>()
  private readonly TOOL_PARTIAL_FALLBACK_DELAY_MS = 1000
  private readonly TOOL_PARTIAL_POLL_INTERVAL_MS = 500
  private toolPartialFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private toolPartialPollTimers = new Map<string, ReturnType<typeof setInterval>>()
  private toolPartialOffsets = new Map<string, { token: number; stdoutLength: number; stderrLength: number }>()
  private toolPartialWarnedSessions = new Set<string>()
  /** Per-tab heartbeat sequence counters */
  private heartbeatSeqs = new Map<string, number>()
  /** Per-tab last acked heartbeat seq */
  private heartbeatAckedSeqs = new Map<string, number>()
  /** Per-tab last acked chunk seq */
  private heartbeatAckedChunkSeqs = new Map<string, number>()
  /** Per-tab heartbeat interval timers */
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** CLI session IDs that have already received per-tab instructions — prevents re-injection on follow-up turns */
  private injectedInstructionsSessions = new Set<string>()
  /** Per-tab last force_rerender seq sent — prevents spamming the webview when acks fall behind */
  private lastForceRerenderSeqs = new Map<string, number>()
  /** Called after stream finalization to drain the host-side prompt queue */
  public onQueueDrain: ((tabId: string, reason?: string) => void) | null = null
  /** Per-tab message sequence counter — monotonically increasing, attached to every streaming message */
  private msgSeqs = new Map<string, number>()
  /** Per-tab chunk sequence counter — used for rendered-chunk ACK backpressure. */
  private postedChunkSeqs = new Map<string, number>()
  private deferredChunks = new Map<string, {
    text: string
    messageId?: string
    callbacks: StreamCallbacks
    timer: ReturnType<typeof setTimeout>
  }>()
  /** Per-tab token/cost totals at prompt start, used to dedupe final SDK usage fallback */
  private finalUsageBaselines = new Map<string, { total: number; cost: number }>()
  /** Per-tab async context estimate version; incremented by estimates and final actual usage. */
  private contextEstimateVersions = new Map<string, number>()
  private tabCloseDisposable: vscode.Disposable | null = null
  /** Methodology classifier/selector — pluggable so tests can stub it */
  private readonly methodologyAdvisor: MethodologyAdvisor
  private readonly activityTracker = new RunActivityTracker()
  private readonly subagentHeartbeat: SubagentHeartbeat
  /**
   * Materializes image attachments to temp files and returns `file://` URLs
   * instead of inline `data:` URLs. This avoids the opencode server (v1.15.x)
   * auto-reading the OS clipboard on Linux (where wl-clipboard/xclip may be
   * absent) and the documented `data:` URL failures with some MCP tools.
   * Pluggable for tests.
   */
  private readonly attachmentStorage: ReturnType<typeof createAttachmentStorage>
  /**
   * Per-tab file:// URLs we handed to the server for the current prompt.
   * Cleaned up when the tab closes or on dispose. Holds at most one
   * batch of attachment URLs per tab — overwritten on each new prompt.
   */
  private pendingAttachmentUrls = new Map<string, string[]>()
  /** Optional delegate: called by SubagentHeartbeat when a new child session is discovered,
   *  so the host can drain the pending event buffer and replay events through the parent tab. */
  private childSessionReplayer: ((tabId: string, childSessionId: string) => void) | null = null

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly modelManager: ModelManager,
    private readonly tabManager: TabManager,
    private readonly rateLimitMonitor: RateLimitMonitor,
    diffApplier: DiffApplier,
    methodologyAdvisor?: MethodologyAdvisor,
    attachmentStorage?: ReturnType<typeof createAttachmentStorage>,
  ) {
    this.methodologyAdvisor = methodologyAdvisor ?? new MethodologyAdvisor()
    this.attachmentStorage = attachmentStorage ?? createAttachmentStorage()
    this.subagentHeartbeat = new SubagentHeartbeat(
      this.sessionManager.sessionClient,
      {
        getSubagentSnapshot: (id) => this.getSubagentSnapshot(id),
        recordSubagentActivity: (id, input) => this.recordSubagentActivity(id, input),
        hasActiveRun: (id) => {
          const run = this.activeRuns.get(id)
          return !!run && run.state !== "completed" && run.state !== "failed" && run.state !== "aborted"
        },
        registerChildSessionMapping: (tabId, childSessionId) => {
          this.childSessionReplayer?.(tabId, childSessionId)
        },
      },
    )
    this.finalizerService = new StreamFinalizerService({
      streamStates: this.streamStates,
      finalizingTabs: this.finalizingTabs,
      abortedTabs: this.abortedTabs,
      activeMessageIds: this.activeMessageIds,
      activeToolCallIds: this.activeToolCallIds,
      toolCallCounts: this.toolCallCounts,
      toolActivityAt: this.toolActivityAt,
      pendingToolGraceTimeouts: this.pendingToolGraceTimeouts,
      stuckStreamHandlers: this.stuckStreamHandlers,
      ttfbTimeouts: this.ttfbTimeouts,
      tabManager: this.tabManager,
      stopWatchdogIfNoStreams: () => this.stopWatchdogIfNoStreams(),
      stopHeartbeat: (id) => this.stopHeartbeat(id),
      setStreamState: (id, state, ctx) => this.setStreamState(id, state, ctx),
      ensureStreamMessageId: (id, cliSessionId) => this.ensureStreamMessageId(id, cliSessionId),
      fetchFinalBlocks: (id, cliSessionId, cbs) => this.fetchFinalBlocks(id, cliSessionId, cbs),
      mergeFinalBlocks: (id, blocks) => this.mergeFinalBlocks(id, blocks),
      storeAssistantMessage: (id, msgId, blocks, tokenTotal) => this.storeAssistantMessage(id, msgId, blocks, tokenTotal),
      nextSeq: (id) => this.nextSeq(id),
    })
    this.tabCloseDisposable = this.tabManager.onTabClosed((tabId) => {
      this.cleanupTab(tabId)
    })
  }

  private nextSeq(tabId: string): number {
    const seq = (this.msgSeqs.get(tabId) || 0) + 1
    this.msgSeqs.set(tabId, seq)
    return seq
  }

  private nextChunkSeq(tabId: string): number {
    const seq = (this.postedChunkSeqs.get(tabId) || 0) + 1
    this.postedChunkSeqs.set(tabId, seq)
    return seq
  }

  /**
   * Classify the outgoing prompt, prepend a methodology hint to `parts`, and
   * notify the webview via `methodology_selected`. Returns the advice (or
   * null when the advisor declined). Never throws — methodology guidance
   * must never block the user's prompt.
   */
  private applyMethodologyAdvice(
    tabId: string,
    text: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
    callbacks: StreamCallbacks,
    hasImageAttachment = false,
  ): MethodologyAdvice | null {
    if (!this.methodologyAdvisor.isEnabled()) return null
    try {
      const tab = this.tabManager.getTab(tabId)
      // Per-tab opt-out, toggled by the user via /methodology on|off.
      if (tab?.methodologyDisabled === true) return null

      const advice = this.methodologyAdvisor.advise(text, {
        hasImageAttachment,
      })
      if (!advice) return null

      parts.push({ type: "text", text: advice.promptAddendum })
      log.info(`[methodology] tab=${tabId.slice(0, 8)} ${advice.signature} (conf=${advice.selection.confidence.toFixed(2)})`)

      // Surface the selection so the user can see — and override — what
      // guidance was attached to their prompt.
      void callbacks.postMessage({
        type: "methodology_selected",
        sessionId: tabId,
        label: advice.label,
        methodology: advice.selection.methodology,
        strategy: advice.selection.promptStrategy,
        confidence: advice.selection.confidence,
        taskType: advice.classification.type,
        auto: true,
      })

      // Status bar renders the SAME advice that was injected. (It used to run
      // a second, independent classification via the orchestrator, which could
      // disagree with the addendum the model actually received.)
      try {
        updateMethodologyStatus({
          label: advice.label,
          methodology: advice.selection.methodology,
          strategy: advice.selection.promptStrategy,
          recommendedTier: advice.selection.recommendedTier,
          confidence: advice.selection.confidence,
          taskType: advice.classification.type,
        })
      } catch { /* best-effort status update */ }

      return advice
    } catch (err) {
      // Methodology advice is best-effort. Never break the user's send path.
      log.warn("[methodology] advice failed", err)
      return null
    }
  }

  private setStreamState(tabId: string, state: StreamLifecycleState, context?: Record<string, unknown>): void {
    const previous = this.streamStates.get(tabId) || "idle"
    if (previous === state) return
    this.streamStates.set(tabId, state)
    const ctxStr = context ? ` ${JSON.stringify(context)}` : ""
    log.info(`[stream:${tabId}] ${previous} → ${state}${ctxStr}`)
  }

  private setActiveRunState(tabId: string, state: ActiveRunState, context?: Record<string, unknown>): void {
    const run = this.activeRuns.get(tabId)
    if (!run) return
    run.state = state
    logStreamTrace("run.state", {
      tabId,
      cliSessionId: run.cliSessionId,
      clientRequestId: run.clientRequestId,
      userMessageId: run.userMessageId,
      assistantMessageId: run.assistantMessageId,
      mode: run.mode,
      agent: run.agent,
      model: run.model,
      state,
      ...(context ?? {}),
    })
  }

  private traceRun(tabId: string, stage: string, context?: Record<string, unknown>): void {
    const run = this.activeRuns.get(tabId)
    logStreamTrace(stage, {
      tabId,
      cliSessionId: run?.cliSessionId ?? this.tabManager.getTab(tabId)?.cliSessionId,
      clientRequestId: run?.clientRequestId,
      userMessageId: run?.userMessageId,
      assistantMessageId: run?.assistantMessageId ?? this.activeMessageIds.get(tabId),
      mode: run?.mode ?? this.tabManager.getTab(tabId)?.mode,
      agent: run?.agent,
      model: run?.model ?? this.tabManager.getTab(tabId)?.model,
      state: run?.state,
      ...(context ?? {}),
    })
  }

  private createStreamMessageId(tabId: string, cliSessionId?: string): string {
    const base = (cliSessionId || tabId).replace(/[^A-Za-z0-9_-]/g, "_")
    return `resp-${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private ensureStreamMessageId(tabId: string, cliSessionId?: string): string {
    const existing = this.activeMessageIds.get(tabId)
    if (existing) return existing
    const messageId = this.createStreamMessageId(tabId, cliSessionId)
    this.activeMessageIds.set(tabId, messageId)
    return messageId
  }

  private startWatchdog(): void {
    if (this.streamWatchdog) return
    this.streamWatchdog = setInterval(() => {
      const allTabs = this.tabManager.getAllTabs()
      const anyStreaming = allTabs.some(t => t.isStreaming)
      if (!anyStreaming) {
        this.stopWatchdog()
        return
      }
      for (const tab of allTabs) {
        if (tab.isStreaming && tab.lastActivityTime) {
          const stuckMs = Date.now() - tab.lastActivityTime
          if (stuckMs > this.STREAM_STUCK_MS) {
            log.warn(`Watchdog: Stream for tab ${tab.id} stuck for ${Math.round(stuckMs / 1000)}s, ending as hard_timeout`)
            const callbacks = this.stuckStreamHandlers.get(tab.id)
            if (callbacks) {
              callbacks.postMessage({
                type: "stream_end",
                sessionId: tab.id,
                messageId: this.ensureStreamMessageId(tab.id, tab.cliSessionId),
                blocks: [...tab.blocksBuffer],
                reason: "hard_timeout",
                partial: true,
                retryable: true,
                seq: this.nextSeq(tab.id),
              })
              this.cleanupTab(tab.id)
            } else {
              log.warn(`No callbacks for stuck tab ${tab.id}, resetting state`)
              this.tabManager.setStreaming(tab.id, false)
              this.tabManager.setWaitingForCompletion(tab.id, false)
            }
          }
        }
      }
    }, 15000)
  }

  private stopWatchdog(): void {
    if (this.streamWatchdog) {
      clearInterval(this.streamWatchdog)
      this.streamWatchdog = null
    }
  }

  /** Stop the watchdog if no tabs are currently streaming (prevents unnecessary polling) */
  private stopWatchdogIfNoStreams(): void {
    const allTabs = this.tabManager.getAllTabs()
    if (!allTabs.some(t => t.isStreaming)) {
      this.stopWatchdog()
    }
  }

  private clearTtfbTimeout(tabId: string): void {
    const timer = this.ttfbTimeouts.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.ttfbTimeouts.delete(tabId)
    }
  }

  private clearTtfbTimeoutIfPending(tabId: string): boolean {
    if (!this.ttfbTimeouts.has(tabId)) return false
    this.clearTtfbTimeout(tabId)
    return true
  }

  private postRunActivitySnapshot(tabId: string, snapshot: AgentRunState | undefined, callbacks?: StreamCallbacks): void {
    if (!snapshot) return
    const cbs = callbacks || this.stuckStreamHandlers.get(tabId)
    if (!cbs) return
    cbs.postMessage({
      type: "run_activity_update",
      sessionId: tabId,
      activity: snapshot,
      seq: this.nextSeq(tabId),
    })
  }

  private recordRunActivity(tabId: string, event: RunProgressEvent, callbacks?: StreamCallbacks): void {
    if (event.kind === "prompt_accepted") {
      this.setActiveRunState(tabId, "accepted", { activityKind: event.kind })
    } else {
      this.setActiveRunState(tabId, "streaming", { activityKind: event.kind })
    }
    const snapshot = this.activityTracker.recordActivity(tabId, event)
    if (snapshot && event.kind !== "prompt_accepted" && this.clearTtfbTimeoutIfPending(tabId)) {
      log.info(`Startup wait cleared by ${event.kind} activity for tab ${tabId}`)
    }
    this.tabManager.touchActivity(tabId)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
  }

  private recordToolRunActivity(tabId: string, input: ToolActivityInput, callbacks?: StreamCallbacks): void {
    this.setActiveRunState(tabId, "streaming", { activityKind: "tool", toolId: input.id, toolName: input.name })
    const snapshot = this.activityTracker.recordTool(tabId, input)
    if (snapshot && this.clearTtfbTimeoutIfPending(tabId)) {
      log.info(`Startup wait cleared by tool activity for tab ${tabId}`)
    }
    this.tabManager.touchActivity(tabId)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
    this.bridgeSubagentFromTool(tabId, input, callbacks)
  }

  private bridgeSubagentFromTool(tabId: string, input: ToolActivityInput, callbacks?: StreamCallbacks): void {
    if (!isSubagentToolName(input.name)) return
    const { agentName, purpose, prompt } = parseSubagentInvocation(input.input)
    this.recordSubagentActivity(
      tabId,
      {
        id: `subagent:${input.id}`,
        agentName,
        status: subagentStatusFromToolStatus(input.status),
        currentActivity: purpose || undefined,
        inputPrompt: prompt || undefined,
        error: input.error,
      },
      callbacks,
    )
  }

  /**
   * Mark a question block as answered in the blocksBuffer and remove it
   * from activeToolCallIds so the stream can finalize. Called by
   * WebviewEventRouter when the user submits an answer.
   */
  markQuestionAnswered(tabId: string, toolCallId: string): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    const qBlock = tab.blocksBuffer.find(
      b => b.type === "question" && (b.id === toolCallId || (b as Record<string, unknown>).toolCallId === toolCallId)
    )
    if (qBlock) {
      ;(qBlock as Record<string, unknown>).answered = true
      log.info(`markQuestionAnswered: marked question ${toolCallId} as answered in blocksBuffer for ${tabId}`)
    }
    const pending = this.activeToolCallIds.get(tabId)
    if (pending && pending.has(toolCallId)) {
      pending.delete(toolCallId)
      if (pending.size === 0) {
        this.activeToolCallIds.delete(tabId)
      }
      log.info(`markQuestionAnswered: removed ${toolCallId} from activeToolCallIds for ${tabId}`)
    }
  }

  /**
   * B9: undo an optimistic markQuestionAnswered when the SDK reply fails
   * (network blip, unknown requestID, server 4xx). Re-arms the question
   * block as pending and re-adds the id to activeToolCallIds so the user
   * can retry the submission.
   */
  unmarkQuestionAnswered(tabId: string, toolCallId: string): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    const qBlock = tab.blocksBuffer.find(
      b => b.type === "question" && (b.id === toolCallId || (b as Record<string, unknown>).toolCallId === toolCallId)
    )
    if (qBlock) {
      const rec = qBlock as Record<string, unknown>
      delete rec.answered
      delete rec.answer
      delete rec.answerSource
      log.info(`unmarkQuestionAnswered: reverted question ${toolCallId} to pending in blocksBuffer for ${tabId}`)
    }
    const pending = this.getOrCreatePendingToolIds(tabId)
    if (!pending.has(toolCallId)) {
      pending.add(toolCallId)
      this.trackToolActivity(tabId, toolCallId)
      log.info(`unmarkQuestionAnswered: re-added ${toolCallId} to activeToolCallIds for ${tabId}`)
    }
  }

  recordExternalActivity(tabId: string, activity: { kind: string; label: string }, callbacks?: StreamCallbacks): void {
    this.recordRunActivity(tabId, {
      kind: activity.kind === "permission" ? "permission" : "agent",
      label: activity.label,
    }, callbacks)
  }

  recordSubagentActivity(tabId: string, input: SubagentActivityInput, callbacks?: StreamCallbacks): void {
    this.setActiveRunState(tabId, "streaming", { activityKind: "subagent", subagentId: input.id })
    const snapshot = this.activityTracker.recordSubagent(tabId, input)
    if (snapshot && this.clearTtfbTimeoutIfPending(tabId)) {
      log.info(`Startup wait cleared by subagent activity for tab ${tabId}`)
    }
    this.tabManager.touchActivity(tabId)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
  }

  /**
   * Snapshot of currently-tracked subagents for a tab. Used by the
   * `get_subagent_activities` RPC to cross-reference SDK child sessions
   * against the in-memory live tracker — so we can mark a child as
   * "running" even though the SDK `Session` type carries no status field.
   *
   * Returns the live SubagentRunState[] directly (not the full AgentRunState).
   * Empty if no run is active for the tab.
   */
  getSubagentSnapshot(tabId: string): SubagentRunState[] {
    return this.activityTracker.getSnapshot(tabId)?.subagents ?? []
  }

  private clearPendingToolGraceTimeout(tabId: string): void {
    const timer = this.pendingToolGraceTimeouts.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    this.pendingToolGraceTimeouts.delete(tabId)
  }

  private getOrCreatePendingToolIds(tabId: string): Set<string> {
    let pending = this.activeToolCallIds.get(tabId)
    if (!pending) {
      pending = new Set<string>()
      this.activeToolCallIds.set(tabId, pending)
    }
    return pending
  }

  private getLastPendingToolId(tabId: string): string | undefined {
    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return undefined
    return Array.from(pending)[pending.size - 1]
  }

  private trackToolActivity(tabId: string, toolId: string): void {
    let activity = this.toolActivityAt.get(tabId)
    if (!activity) {
      activity = new Map<string, number>()
      this.toolActivityAt.set(tabId, activity)
    }
    activity.set(toolId, Date.now())
  }

  private toolPartialKey(tabId: string, toolId: string): string {
    return `${tabId}\u0000${toolId}`
  }

  private isToolPartialPollable(toolCall: { name?: string; class?: string; args?: unknown }): boolean {
    const name = (toolCall.name || "").toLowerCase()
    const cls = (toolCall.class || this.toolClass(toolCall.name || "")).toLowerCase()
    if (cls === "exec") return true
    if (/(bash|shell|command|terminal|zsh|sh|exec)/i.test(name)) return true
    const args = toolCall.args && typeof toolCall.args === "object" ? toolCall.args as Record<string, unknown> : undefined
    return typeof args?.command === "string" || typeof args?.cmd === "string"
  }

  private stopToolPartialPolling(tabId: string, toolId: string): void {
    const key = this.toolPartialKey(tabId, toolId)
    const fallback = this.toolPartialFallbackTimers.get(key)
    if (fallback) clearTimeout(fallback)
    this.toolPartialFallbackTimers.delete(key)
    const poll = this.toolPartialPollTimers.get(key)
    if (poll) clearInterval(poll)
    this.toolPartialPollTimers.delete(key)
    this.toolPartialOffsets.delete(key)
  }

  private stopAllToolPartialPolling(tabId: string): void {
    const prefix = `${tabId}\u0000`
    for (const [key, timer] of Array.from(this.toolPartialFallbackTimers)) {
      if (!key.startsWith(prefix)) continue
      clearTimeout(timer)
      this.toolPartialFallbackTimers.delete(key)
    }
    for (const [key, timer] of Array.from(this.toolPartialPollTimers)) {
      if (!key.startsWith(prefix)) continue
      clearInterval(timer)
      this.toolPartialPollTimers.delete(key)
    }
    for (const key of Array.from(this.toolPartialOffsets.keys())) {
      if (key.startsWith(prefix)) this.toolPartialOffsets.delete(key)
    }
  }

  private armToolPartialPolling(
    tabId: string,
    toolId: string,
    toolCall: { name?: string; class?: string; args?: unknown },
    callbacks: StreamCallbacks,
  ): void {
    if (!this.isToolPartialPollable(toolCall)) return
    const key = this.toolPartialKey(tabId, toolId)
    if (this.toolPartialFallbackTimers.has(key) || this.toolPartialPollTimers.has(key)) return

    const fallback = setTimeout(() => {
      this.toolPartialFallbackTimers.delete(key)
      if (this.toolPartialOffsets.has(key)) return
      const poll = setInterval(() => {
        void this.pollToolPartialOutput(tabId, toolId, callbacks)
      }, this.TOOL_PARTIAL_POLL_INTERVAL_MS)
      this.toolPartialPollTimers.set(key, poll)
      void this.pollToolPartialOutput(tabId, toolId, callbacks)
    }, this.TOOL_PARTIAL_FALLBACK_DELAY_MS)
    this.toolPartialFallbackTimers.set(key, fallback)
  }

  private warnNoLiveOutputOnce(tabId: string): void {
    const cliSessionId = this.tabManager.getTab(tabId)?.cliSessionId ?? tabId
    if (this.toolPartialWarnedSessions.has(cliSessionId)) return
    this.toolPartialWarnedSessions.add(cliSessionId)
    log.warn(`Live tool output polling: no recognizable live output buffer exposed for session ${cliSessionId}`)
  }

  private partialFromSnapshot(toolId: string, snapshot: LiveToolOutputSnapshot): ToolPartialInput {
    return {
      id: toolId,
      token: snapshot.token,
      stdout: snapshot.stdout,
      stderr: snapshot.stderr,
      stdoutLength: snapshot.stdoutLength,
      stderrLength: snapshot.stderrLength,
      stdoutLineCount: snapshot.stdoutLineCount,
      stderrLineCount: snapshot.stderrLineCount,
      durationMs: snapshot.durationMs,
      exitCode: snapshot.exitCode,
    }
  }

  private async pollToolPartialOutput(tabId: string, toolId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return
    const pending = this.activeToolCallIds.get(tabId)
    if (!pending?.has(toolId)) {
      this.stopToolPartialPolling(tabId, toolId)
      return
    }

    const key = this.toolPartialKey(tabId, toolId)
    const previous = this.toolPartialOffsets.get(key)
    try {
      const snapshot = await this.sessionManager.getToolPartialOutput(tab.cliSessionId, toolId, previous?.token ?? 0)
      if (!snapshot.available) {
        this.warnNoLiveOutputOnce(tabId)
        return
      }
      this.appendToolPartial(tabId, this.partialFromSnapshot(toolId, snapshot), callbacks, "poll")
    } catch (err) {
      log.warn(`Live tool output polling failed for ${tabId}/${toolId}`, err)
    }
  }

  private postToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): boolean {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return false

    const pending = this.activeToolCallIds.get(tabId)
    let toolId = result.id && result.id !== "unknown" ? result.id : undefined
    if (!toolId || (pending && !pending.has(toolId))) {
      if (pending && pending.size === 1) {
        toolId = pending.values().next().value
      } else if (pending && pending.size > 1) {
        log.warn(`postToolEnd: ambiguous ID "${result.id}" with ${pending.size} pending tools — picking most recently active`)
        const activity = this.toolActivityAt.get(tabId)
        let latestTime = 0
        for (const id of pending) {
          const t = activity?.get(id) ?? 0
          if (t > latestTime) { latestTime = t; toolId = id }
        }
      }
    }
    if (!toolId) return false

    this.stopToolPartialPolling(tabId, toolId)

    if (pending) {
      pending.delete(toolId)
      if (pending.size === 0) {
        this.activeToolCallIds.delete(tabId)
        this.clearPendingToolGraceTimeout(tabId)
      }
    }
    this.toolActivityAt.get(tabId)?.delete(toolId)

    const block = tab.blocksBuffer.find(b => (b.type === "tool-call" || b.type === "question") && b.id === toolId)
    this.recordToolRunActivity(tabId, {
      id: toolId,
      name: typeof block?.name === "string" ? block.name : "tool",
      status: result.stale ? "unresolved" : result.ok ? "completed" : "failed",
      result: result.result,
      error: result.ok ? undefined : result.result,
    }, callbacks)

    callbacks.postMessage({
      type: "stream_tool_end",
      sessionId: tabId,
      toolId,
      result: { ...result, id: toolId },
    })

    if (block) {
      block.state = result.state ?? (result.stale ? "stale" : result.ok ? "result" : "error")
      block.result = result.result
      block.durationMs = result.durationMs
      // M1: persist the defensively-extracted exit code / stderr on the
      // block so history replay + backfill re-render the bash card with
      // the colored exit-code chip and the stdout/stderr split panels.
      // These are no-ops when undefined (the common case for non-bash
      // tools and for servers that don't ship structured metadata).
      if (typeof result.exitCode === "number") {
        ;(block as Record<string, unknown>).exitCode = result.exitCode
      }
      if (typeof result.stderr === "string") {
        ;(block as Record<string, unknown>).stderr = result.stderr
      }
      if (result.resultTruncated) {
        ;(block as Record<string, unknown>).resultTruncated = true
      }
    }
    return true
  }

  private resetPendingToolGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    if (this.pendingToolGraceTimeouts.has(tabId)) return

    const timeout = setTimeout(() => {
      this.pendingToolGraceTimeouts.delete(tabId)
      void this.markUnresolvedPendingToolCalls(tabId, callbacks)
        .then(() => this.markUnresolvedActiveSubagents(tabId, callbacks))
        .then(() => this.maybeFinalizeStream(tabId, callbacks, "status"))
        .catch(err => log.error("Pending tool grace finalization failed", err))
    }, this.TOOL_FINALIZE_GRACE_MS)
    this.pendingToolGraceTimeouts.set(tabId, timeout)
  }

  private async reconcilePendingToolCallsFromServer(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    try {
      const messages = await this.sessionManager.getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(message => message.info.role === "assistant")
      if (!lastAssistant) return

      const messageInfo = lastAssistant.info as { id?: string }
      for (const part of lastAssistant.parts) {
        if (!this.isRecord(part) || part.type !== "tool") continue
        const state: Record<string, unknown> = this.isRecord(part.state) ? part.state as Record<string, unknown> : {}
        const status = typeof state.status === "string" ? state.status : ""
        if (status !== "completed" && status !== "error") continue

        const resolvedId = this.stableToolPartId(part, messageInfo.id)
        const currentPending = this.activeToolCallIds.get(tabId)
        if (!currentPending || currentPending.size === 0) break

        const fallbackId = currentPending.size === 1 ? currentPending.values().next().value : undefined
        const toolId = resolvedId && currentPending.has(resolvedId) ? resolvedId : fallbackId
        if (!toolId) continue

        const toolName = typeof part.tool === "string" ? part.tool : ""
        const isQuestionTool = toolName.toLowerCase() === "question"
        if (isQuestionTool) {
          const qBlock = tab.blocksBuffer.find(
            b => b.type === "question" && (b.id === toolId || (b as Record<string, unknown>).toolCallId === toolId)
          )
          if (qBlock && !(qBlock as Record<string, unknown>).answered) {
            log.info(`reconcilePendingToolCallsFromServer: keeping question tool ${toolId} pending (not yet answered)`)
            continue
          }
        }

        const result = typeof state.output === "string"
          ? state.output
          : state.output !== undefined
            ? JSON.stringify(state.output)
            : typeof state.error === "string"
              ? state.error
              : ""
        this.postToolEnd(tabId, { id: toolId, ok: status === "completed", result }, callbacks)
      }
    } catch (err) {
      log.warn(`Failed to reconcile pending tools for ${tabId}`, err)
    }
  }

  private stableToolPartId(part: Record<string, unknown>, messageId?: string): string | undefined {
    if (typeof part.id === "string" && part.id) return part.id
    if (typeof part.callID === "string" && part.callID) return part.callID
    const partMessageId = typeof part.messageID === "string" ? part.messageID : messageId
    const tool = typeof part.tool === "string" ? part.tool : "tool"
    return partMessageId ? `${partMessageId}:${tool}` : undefined
  }

  private async markUnresolvedPendingToolCalls(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const pending = this.activeToolCallIds.get(tabId)
    if (!pending || pending.size === 0) return

    const ids = Array.from(pending)
    log.warn(`Marking ${ids.length} pending tool call(s) unresolved for ${tabId} after terminal server status`)
    for (const toolId of ids) {
      const tab = this.tabManager.getTab(tabId)
      // B6: question tools are intentionally kept pending while the agent is
      // suspended waiting for an answer (reconcilePendingToolCallsFromServer
      // `continue`s past them). Flagging them as "unresolved" here would (a)
      // post a stream_tool_unresolved message the webview has no handler for,
      // and (b) record a misleading "unresolved" run-activity entry. The
      // question block in blocksBuffer IS the user-visible state — leave it.
      const isQuestionBlock = tab?.blocksBuffer.some(b => {
        if (b.type !== "question") return false
        const rec = b as Record<string, unknown>
        return b.id === toolId || rec.toolCallId === toolId
      })
      if (isQuestionBlock) {
        log.info(`markUnresolvedPendingToolCalls: skipping question tool ${toolId} (still awaiting answer)`)
        continue
      }
      const block = tab?.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
      this.recordToolRunActivity(tabId, {
        id: toolId,
        name: typeof block?.name === "string" ? block.name : "tool",
        status: "unresolved",
        error: "Tool did not emit a completion event before the server became idle.",
      }, callbacks)
      callbacks.postMessage({
        type: "stream_tool_unresolved",
        sessionId: tabId,
        toolCallId: toolId,
        message: "Tool did not emit a completion event before the server became idle.",
      })
    }
  }

  private markUnresolvedActiveSubagents(tabId: string, callbacks: StreamCallbacks): void {
    const active = this.activityTracker.getSnapshot(tabId)?.activeSubagentCount ?? 0
    if (active === 0) return
    const message = "Subagent did not emit a completion event before the server became idle."
    log.warn(`Marking ${active} active subagent(s) unresolved for ${tabId} after terminal server status`)
    const snapshot = this.activityTracker.markActiveSubagentsUnresolved(tabId, message)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
  }

  async startPrompt(
    tabId: string,
    text: string,
    callbacks: StreamCallbacks,
    variant?: string,
    attachments: Array<{ data: string; mimeType: string }> = [],
    identity: PromptRunIdentity = {},
  ): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) {
      callbacks.postRequestError("Tab not found")
      return
    }

    // Store callbacks for watchdog
    this.stuckStreamHandlers.set(tabId, callbacks)
    this.toolCallCounts.set(tabId, 0)
    this.activeToolCallIds.delete(tabId)
    this.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)

    if (!await this.ensureServerRunningForPrompt(tabId, callbacks)) return

    if (!this.reserveStreamSlotOrReject(tabId, callbacks)) return

    this.initializeRunMetadata(tabId, tab, text, identity)

    try {
      this.refreshContextTokenEstimate(tabId)

      const localTitle = this.sessionStore.get(tabId)?.name?.trim()
      const cliSessionId = await this.sessionManager.ensureSession(tab.cliSessionId, localTitle || undefined)
      this.tabManager.setCliSessionId(tabId, cliSessionId)
      this.sessionStore.updateCliSessionId(tabId, cliSessionId)
      const streamMessageId = this.resolveStreamMessageAndStartActivity(tabId, tab, cliSessionId, callbacks)

      const eventStreamReady = await this.sessionManager.waitForEventStreamReady(5_000)
      if (!eventStreamReady) {
        const status = this.sessionManager.eventStreamStatus
        if (status.state === "failed" || !this.sessionManager.isRunning) {
          throw new Error(`OpenCode event stream is ${status.state}; cannot send a prompt until extension communication is connected.`)
        }
        // Still reconnecting — proceed optimistically. The server processes prompts
        // independently of the event stream. The TTFB timeout detects if events never arrive.
        log.warn(`Event stream not ready (${status.state}) after 5s — proceeding; TTFB timeout active (${this.TTFB_TIMEOUT_MS}ms)`)
      }

      this.emitStreamStartAndArmWatchdogs(tabId, callbacks, streamMessageId)

      const { modelRef, agent } = await this.resolveModelAndAgentForPrompt(tabId, tab)

      const parts = this.buildTextParts(tabId, tab, cliSessionId, text, callbacks, attachments)

      // Materialize each attachment to a temp file. The opencode server
      // (v1.15.x) auto-reads the OS clipboard for FilePartInput URLs, which
      // fails on Linux without wl-clipboard/xclip; pointing the server at
      // a real file on disk skips that path entirely. `data:` URLs are also
      // documented to fail with some MCP/non-vision models (opencode
      // issues #14673, #18437, #10154, #29880).
      //
      // For IMAGES: we send a `data:` URL instead — the webview CANNOT
      // render `file://` URLs (VS Code sandbox restriction). The server
      // returns `file` blocks with `file://` in its response, which would
      // render as a non-loadable chip. By sending `data:`, the local
      // optimistic render (base64 inline) matches what the server returns.
      // Non-image files still materialize to disk.
      const materialized: MaterializedAttachment[] = []
      for (const attachment of attachments) {
        const isImage = attachment.mimeType?.startsWith("image/")
        if (isImage) {
          // Use data: URL for images — webview can render these inline
          parts.push({
            type: "file",
            mime: attachment.mimeType,
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
          })
        } else {
          const result = await this.attachmentStorage.materialize({
            data: attachment.data,
            mimeType: attachment.mimeType,
            filename: (attachment as { filename?: string }).filename,
          })
          materialized.push(result)
          parts.push({
            type: "file",
            mime: result.mimeType,
            url: result.url,
          })
        }
      }
      // Track file:// URLs for cleanup. data: URLs (fallback path) and
      // http(s) URLs are not ours to delete; `storage.cleanup` already
      // ignores them, but we filter here too for clarity.
      const fileUrls = materialized
        .filter((m) => m.url.startsWith("file://"))
        .map((m) => m.url)
      if (fileUrls.length > 0) {
        // If a previous prompt left files behind on this tab, clean them up
        // before overwriting — otherwise the previous batch leaks until
        // tab close.
        const prev = this.pendingAttachmentUrls.get(tabId)
        if (prev && prev.length > 0) {
          void this.attachmentStorage.cleanup(prev)
        }
        this.pendingAttachmentUrls.set(tabId, fileUrls)
      }

      const abortSignal = this.ttfbAbortControllers.get(tabId)?.signal
      if (callbacks.toolCallId) {
        log.info(`startPrompt forwarding question_answer toolCallId=${callbacks.toolCallId} for tab ${tabId}`)
      }
      await this.sessionManager.sendPromptAsync(cliSessionId, parts, {
        model: modelRef,
        agent,
        variant,
        messageID: identity.userMessageId,
        clientRequestId: identity.clientRequestId,
        signal: abortSignal,
      })
      this.armPostAcceptLifecycle(tabId, callbacks, identity, cliSessionId)
    } catch (e) {
      this.handlePromptSendFailure(tabId, tab, callbacks, identity, text, attachments, e)
    }
  }

  private buildPromptFailureContext(
    tabId: string,
    tab: TabState,
    message: string,
    e: unknown,
  ): { snapshot: AgentRunState | undefined; errorContext: RunErrorContext } {
    const snapshot = this.activityTracker.markRunFailed(tabId, {
      kind: message.includes("event stream") || message.includes("communication") ? "transport_disconnected" : "unknown",
      source: message.includes("event stream") || message.includes("communication") ? "event_stream" : "extension_host",
      recoverability: "retryable",
      message,
      technicalDetails: e instanceof Error ? e.stack : undefined,
    })
    const errorContext = mapRunError({
      kind: snapshot?.lastError?.kind ?? "unknown",
      source: snapshot?.lastError?.source ?? "extension_host",
      recoverability: snapshot?.lastError?.recoverability ?? "retryable",
      sessionId: tabId,
      messageId: this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId),
      runId: snapshot?.runId,
      technicalDetails: e instanceof Error ? e.stack : String(e),
    })
    return { snapshot, errorContext }
  }

  private handlePromptSendFailure(
    tabId: string,
    tab: TabState,
    callbacks: StreamCallbacks,
    identity: PromptRunIdentity,
    text: string,
    attachments: Array<{ data: string; mimeType: string }>,
    e: unknown,
  ): void {
    const message = e instanceof Error ? e.message : "Unknown error"
    log.error("Prompt failed", e)
    this.setActiveRunState(tabId, "failed", { finalizeReason: "send_failed", error: message })
    vscode.window.showErrorMessage(`OpenCode request failed: ${message}`)
    const { snapshot, errorContext } = this.buildPromptFailureContext(tabId, tab, message, e)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
    callbacks.postMessage({
      type: "prompt_send_failed",
      sessionId: tabId,
      messageId: identity.userMessageId,
      clientRequestId: identity.clientRequestId,
      text,
      reason: message,
      attachments,
    })
    // Emit stream_end so the webview cleans up the assistant placeholder BEFORE showing the error
    callbacks.postMessage({
      type: "stream_end",
      sessionId: tabId,
      messageId: this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId),
      blocks: [],
      reason: "error",
      seq: this.nextSeq(tabId),
    })
    const userMessage = errorContext.kind === "unknown" ? message : errorContext.userMessage
    callbacks.postRequestError(userMessage, tabId)
    this.cleanupTab(tabId)
  }

  private async refreshModelsIfMissing(tab: TabState): Promise<void> {
    // Lazy model resolution: if neither the tab nor the global model is set,
    // give refreshModels one more chance (with a 3s timeout) before sending.
    // This catches the init-race where the model list hasn't arrived yet by
    // the time the user sends their first prompt.
    if (!tab.model && !this.modelManager.model) {
      try {
        await Promise.race([
          this.modelManager.refreshModels(this.sessionManager.currentPort, this.sessionManager.authHeader),
          new Promise<void>((_, reject) => {
            const id = setTimeout(() => reject(new Error("timeout")), 3_000)
            if (typeof id === "object" && typeof id.unref === "function") id.unref()
          }),
        ])
      } catch {
        log.warn("Lazy model refresh timed out — proceeding without a model; server may reject")
      }
    }
  }

  private async resolveModelAndAgentForPrompt(
    tabId: string,
    tab: TabState,
  ): Promise<{ modelRef: { providerID: string; modelID: string } | undefined; agent: "plan" | "build" }> {
    await this.refreshModelsIfMissing(tab)

    // Resolve the model for this session mode. If the user has configured
    // `opencode.modeModels`, the mode-specific override is used; otherwise
    // falls back to the session's default model. Pattern: Cline per-mode
    // model selector, Copilot per-agent model config.
    const resolvedModel = this.modelManager.getModeModel(tab.mode || "", tab.model)
    const modelRef = resolvedModel ? parseModelRef(resolvedModel) : undefined

    // Pass the corresponding OpenCode primary agent for mode-specific
    // behavior. OpenCode's current config model uses `agent` + permissions;
    // legacy `tools` booleans are deprecated and can over-block Plan's
    // `.opencode/plans/*.md` exception.
    //
    // Plan maps to the built-in `plan` agent. Build and Auto map to
    // `build`; Auto remains the extension's UX mode for fewer local prompts.
    //
    // Docs: plan restricts write/edit/patch/bash, with an exception for
    // `.opencode/plans/*.md`; `edit` permission gates write/edit/apply_patch.
    const agent = modeToAgent(tab.mode)
    const activeRunForMode = this.activeRuns.get(tabId)
    if (activeRunForMode) {
      activeRunForMode.agent = agent
      activeRunForMode.model = resolvedModel
      activeRunForMode.mode = tab.mode
    }
    return { modelRef, agent }
  }

  private armPostAcceptLifecycle(
    tabId: string,
    callbacks: StreamCallbacks,
    identity: PromptRunIdentity,
    cliSessionId: string,
  ): void {
    this.setActiveRunState(tabId, "accepted", { acceptReason: "prompt_async_returned" })
    if (identity.userMessageId) {
      callbacks.postMessage({
        type: "prompt_accepted",
        sessionId: tabId,
        messageId: identity.userMessageId,
        clientRequestId: identity.clientRequestId,
      })
    }
    this.recordRunActivity(tabId, { kind: "prompt_accepted", label: "Waiting for activity" }, callbacks)

    this.startHeartbeat(tabId, callbacks)
    this.subagentHeartbeat.start(tabId, cliSessionId)
    // startWatchdog is the single hard safety net and is driven by server activity.
  }

  private buildTextParts(
    tabId: string,
    tab: TabState,
    cliSessionId: string,
    text: string,
    callbacks: StreamCallbacks,
    attachments: Array<{ data: string; mimeType: string }>,
  ): Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> {
    // Inject per-tab instructions as a prepended text part on the first turn only
    const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []
    if (tab.instructions && !this.injectedInstructionsSessions.has(cliSessionId)) {
      parts.push({ type: "text", text: tab.instructions })
      this.injectedInstructionsSessions.add(cliSessionId)
    }

    // Methodology advice — classify the user's prompt and prepend a short
    // strategy hint. Pure/synchronous; returns null for trivial inputs and
    // slash commands. The selected methodology is also surfaced to the
    // webview so the user can see (and later override) it.
    this.applyMethodologyAdvice(tabId, text, parts, callbacks, attachments.length > 0)

    if (text.trim()) {
      parts.push({ type: "text", text })
    }
    return parts
  }

  private emitStreamStartAndArmWatchdogs(tabId: string, callbacks: StreamCallbacks, streamMessageId: string): void {
    // NOTE: User message is already rendered and stored by the webview.
    // Persisting here caused duplicate rendering (garbled/flash effect).
    callbacks.postMessage({
      type: "stream_start",
      sessionId: tabId,
      messageId: streamMessageId,
      seq: this.nextSeq(tabId),
    })
    this.traceRun(tabId, "stream_start")
    callbacks.clearPromptsInFlight?.()

    this.tabManager.setWaitingForCompletion(tabId, true)
    this.tabManager.clearBuffer(tabId)
    this.startWatchdog()

    this.setupTtfbTimeout(tabId, callbacks)
  }

  private resolveStreamMessageAndStartActivity(
    tabId: string,
    tab: TabState,
    cliSessionId: string,
    callbacks: StreamCallbacks,
  ): string {
    // H2a: When this is a question-answer continuation (toolCallId present),
    // reuse the existing activeMessageId so the resumed assistant text renders
    // in the same bubble that already contains the question block. Otherwise
    // the old bubble is orphaned — it never receives its stream_end.
    const isQuestionContinuation = !!callbacks.toolCallId
    const streamMessageId = isQuestionContinuation
      ? this.ensureStreamMessageId(tabId, cliSessionId)
      : this.createStreamMessageId(tabId, cliSessionId)
    this.activeMessageIds.set(tabId, streamMessageId)
    const activeRun = this.activeRuns.get(tabId)
    if (activeRun) {
      activeRun.cliSessionId = cliSessionId
      activeRun.assistantMessageId = streamMessageId
      activeRun.mode = tab.mode
      activeRun.model = tab.model
    }
    const initialActivity = this.activityTracker.startRun({
      tabId,
      cliSessionId,
      messageId: streamMessageId,
      model: tab.model,
    })
    this.postRunActivitySnapshot(tabId, initialActivity, callbacks)
    return streamMessageId
  }

  private initializeRunMetadata(
    tabId: string,
    tab: TabState,
    text: string,
    identity: PromptRunIdentity,
  ): void {
    // Now set streaming state AFTER atomic reservation
    this.tabManager.setStreaming(tabId, true)
    this.setStreamState(tabId, "sending", { model: tab.model, sessionId: tab.cliSessionId })
    this.activeRuns.set(tabId, {
      tabId,
      cliSessionId: tab.cliSessionId,
      clientRequestId: identity.clientRequestId,
      userMessageId: identity.userMessageId,
      mode: tab.mode,
      model: tab.model,
      startedAt: Date.now(),
      state: "sending",
    })
    this.traceRun(tabId, "run.created", { promptText: text })
    const baselineSession = this.sessionStore.get(tabId)
    this.finalUsageBaselines.set(tabId, {
      total: baselineSession?.tokenUsage?.total ?? 0,
      cost: baselineSession?.cost ?? 0,
    })
  }

  private async ensureServerRunningForPrompt(tabId: string, callbacks: StreamCallbacks): Promise<boolean> {
    if (!this.sessionManager.isRunning) {
      try {
        await this.sessionManager.start()
      } catch (e) {
        const msg = (e as Error).message
        log.error("Failed to start OpenCode server", e)
        vscode.window.showErrorMessage(`Could not start OpenCode. ${msg}`)
        callbacks.postRequestError(msg)
        this.cleanupTab(tabId)
        return false
      }
    }
    return true
  }

  private reserveStreamSlotOrReject(tabId: string, callbacks: StreamCallbacks): boolean {
    // Reserve the streaming slot ATOMICALLY before any `await`
    const canStream = this.tabManager.canStartStreaming()
    if (!canStream.ok) {
      log.warn(`Concurrent stream limit reached: ${canStream.reason}`)
      vscode.window.showWarningMessage(canStream.reason!)
      this.stuckStreamHandlers.delete(tabId)
      // Notify webview so it can reset optimistic streaming state
      callbacks.postMessage({
        type: "prompt_rejected",
        sessionId: tabId,
        reason: canStream.reason || "Concurrent stream limit reached",
      })
      return false
    }
    return true
  }

  private setupTtfbTimeout(tabId: string, callbacks: StreamCallbacks): void {
    // TTFB (time-to-first-byte) timeout — fires if no stream chunk arrives within 30s
    const abortController = new AbortController()
    this.ttfbAbortControllers.set(tabId, abortController)
    const ttfbTimeout = setTimeout(() => {
      const t = this.tabManager.getTab(tabId)
      if (t?.isStreaming && t.waitingForCompletion) {
        if (!this.activityTracker.shouldTriggerStartupTimeout(tabId, this.TTFB_TIMEOUT_MS)) {
          log.info(`Startup timeout skipped for tab ${tabId} because OpenCode activity was observed`)
          this.clearTtfbTimeout(tabId)
          return
        }
        const eventStreamStatus = this.sessionManager.eventStreamStatus
        const eventStreamDisconnected = eventStreamStatus.state !== "connected"
        const reason = eventStreamDisconnected ? "event_stream_disconnected" : "ttfb_timeout"
        log.warn(`TTFB timeout for tab ${tabId} — no chunk received within ${this.TTFB_TIMEOUT_MS}ms (eventStream=${eventStreamStatus.state}, lastRaw=${eventStreamStatus.lastRawEventType || "none"})`)
        const snapshot = eventStreamDisconnected
          ? this.activityTracker.markRunInterrupted(tabId, "OpenCode event stream disconnected before any response events arrived.")
          : this.activityTracker.markRunFailed(tabId, {
            kind: "model_startup_timeout",
            source: "model_provider",
            recoverability: "retryable",
            message: "No OpenCode activity arrived before the startup timeout.",
          })
        const acceptedRun = this.activeRuns.get(tabId)
        const backendMayStillBeRunning = eventStreamDisconnected ||
          acceptedRun?.state === "accepted" ||
          acceptedRun?.state === "streaming" ||
          acceptedRun?.state === "interrupted"
        const errorContext = mapRunError({
          kind: eventStreamDisconnected ? "transport_disconnected" : "model_startup_timeout",
          source: eventStreamDisconnected ? "event_stream" : "model_provider",
          recoverability: eventStreamDisconnected ? "refresh_from_server" : "retryable",
          sessionId: tabId,
          messageId: this.ensureStreamMessageId(tabId, t.cliSessionId),
          runId: snapshot?.runId,
          mayStillBeRunning: backendMayStillBeRunning,
          partialOutputPreserved: false,
          technicalDetails: `stream=${eventStreamStatus.state};last=${eventStreamStatus.lastRawEventType || ""};timeout=${this.TTFB_TIMEOUT_MS};session=${t.cliSessionId}`,
        })
        this.postRunActivitySnapshot(tabId, snapshot, callbacks)
        this.setStreamState(tabId, "timeout", { sessionId: t.cliSessionId, eventStream: eventStreamStatus.state })
        if (acceptedRun?.state === "accepted" || acceptedRun?.state === "streaming" || acceptedRun?.state === "interrupted") {
          this.setActiveRunState(tabId, "interrupted", {
            finalizeReason: reason,
            eventStreamState: eventStreamStatus.state,
            lastRawEventType: eventStreamStatus.lastRawEventType,
          })
          this.clearTtfbTimeout(tabId)
          callbacks.postRequestError(errorContext.userMessage, tabId)
          return
        }
        abortController.abort("ttfb_timeout")
        callbacks.postMessage({
          type: "stream_end",
          sessionId: tabId,
          messageId: this.ensureStreamMessageId(tabId, t.cliSessionId),
          blocks: [],
          reason,
          partial: false,
          retryable: true,
          seq: this.nextSeq(tabId),
        })
        if (eventStreamDisconnected) {
          callbacks.postRequestError(errorContext.userMessage, tabId)
        }
        this.cleanupTab(tabId)
      }
    }, this.TTFB_TIMEOUT_MS)
    this.ttfbTimeouts.set(tabId, ttfbTimeout)
  }

  private async fetchFinalBlocks(
    tabId: string,
    cliSessionId: string | undefined,
    callbacks: StreamCallbacks
  ): Promise<{ blocks: Block[]; sdkTokenTotal: number | undefined }> {
    let blocks: Block[] = []
    let sdkTokenTotal: number | undefined

    if (!cliSessionId) return { blocks, sdkTokenTotal }

    const FINAL_FETCH_TIMEOUT_MS = 10_000
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`getSessionMessages timed out after ${FINAL_FETCH_TIMEOUT_MS}ms`)),
        FINAL_FETCH_TIMEOUT_MS
      )
    })

    try {
      const messages = await Promise.race([
        this.sessionManager.getSessionMessages(cliSessionId),
        timeoutPromise,
      ])
      const lastAssistant = [...messages].reverse().find(message => message.info.role === "assistant")
      if (lastAssistant) {
        blocks = this.partsToBlocks(lastAssistant.parts)
        const info = lastAssistant.info as { cost?: number; tokens?: { total?: number; input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } }
        if (info.tokens) {
          const input = info.tokens.input ?? 0
          const output = info.tokens.output ?? 0
          const reasoning = info.tokens.reasoning ?? 0
          const cacheRead = info.tokens.cache?.read ?? 0
          const cacheWrite = info.tokens.cache?.write ?? 0
          sdkTokenTotal = info.tokens.total ?? input + output + reasoning + cacheRead + cacheWrite
          const usage = {
            prompt: input,
            completion: output,
            total: sdkTokenTotal,
            reasoning,
            cacheRead,
            cacheWrite,
          }
          if (this.recordFinalUsageFallback(tabId, usage, info.cost)) {
            const ledger = this.sessionStore.get(tabId)
            const cumulativeCost = ledger?.cost
            if (typeof cumulativeCost === "number" && Number.isFinite(cumulativeCost) && cumulativeCost > 0) {
              callbacks.postMessage({ type: "cost_update", sessionId: tabId, cost: cumulativeCost, seq: this.nextSeq(tabId) })
            }
            callbacks.postMessage({
              type: "token_usage",
              sessionId: tabId,
              usage,
              // Canonical host totals — lets the webview SET instead of add.
              cumulative: ledger?.tokenUsage,
              cumulativeCost,
            })
          }
          const tab = this.tabManager.getTab(tabId)
          const selectedModel = tab?.model || this.modelManager.model
          const provider = parseModelRef(selectedModel).providerID || parseModelRef(this.modelManager.model).providerID || undefined
          this.rateLimitMonitor.recordTokenUsage(input, output, provider, info.cost)
          // Feed the SDK-reported input token count into ContextMonitor as the
          // authoritative context fill for this turn. tokens.input = system +
          // history + workspace + user message — everything the LLM consumed.
          // This replaces the heuristic estimate from refreshContextTokenEstimate.
          if (input > 0) {
            this.contextEstimateVersions.set(tabId, (this.contextEstimateVersions.get(tabId) ?? 0) + 1)
            this.contextMonitor.updateTokens(input, tabId, undefined, { source: "actual", updatedAt: Date.now() })
          }
        }
      }
    } catch (err) {
      log.warn(`Failed to fetch final session for ${tabId}, falling back to buffer`, err)
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }

    return { blocks, sdkTokenTotal }
  }

  private recordFinalUsageFallback(
    tabId: string,
    usage: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number },
    cost?: number
  ): boolean {
    const baseline = this.finalUsageBaselines.get(tabId)
    const session = this.sessionStore.get(tabId)
    const currentTotal = session?.tokenUsage?.total ?? 0
    const currentCost = session?.cost ?? 0
    const stepFinishAlreadyRecorded = baseline !== undefined
      && (currentTotal > baseline.total || currentCost > baseline.cost)

    if (stepFinishAlreadyRecorded) return false

    this.sessionStore.accumulateTokenUsage(tabId, usage)
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
      this.sessionStore.accumulateCost(tabId, cost)
    }
    return true
  }

  private mergeFinalBlocks(tabId: string, serverBlocks: Block[]): Block[] {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return serverBlocks

    const hasNonTextBlocks = tab.blocksBuffer.some(b => b.type !== "text")
    if (tab.blocksBuffer.length > 0 && (hasNonTextBlocks || serverBlocks.length === 0)) {
      log.info(`finalizeStream: Using live blocksBuffer for ${tabId} (${tab.blocksBuffer.length} blocks, hasNonText: ${hasNonTextBlocks})`)

      const mergedBlocks = [...tab.blocksBuffer]
      for (const serverBlock of serverBlocks) {
        const exists = mergedBlocks.some(b =>
          b.type === serverBlock.type &&
           b.id === serverBlock.id
        )
        if (!exists && serverBlock.type === "text") {
          const existingTextIdx = mergedBlocks.findIndex(b => b.type === "text")
          if (existingTextIdx >= 0) {
            mergedBlocks[existingTextIdx] = serverBlock
          } else {
            mergedBlocks.push(serverBlock)
          }
        }
      }
      return mergedBlocks
    }

    if (serverBlocks.length === 0 && tab.streamingBuffer) {
      const cleanedText = this.stripContextWrapper(tab.streamingBuffer)
      if (cleanedText.trim()) {
        return [{ type: "text", text: cleanedText }]
      }
    }

    return serverBlocks
  }

  private storeAssistantMessage(
    tabId: string,
    streamMessageId: string,
    blocks: Block[],
    sdkTokenTotal: number | undefined
  ): void {
    if (blocks.length === 0) return

    // Stamp the active mode on each assistant message so session history
    // can show per-turn mode badges (like Copilot Session Insights).
    const tab = this.tabManager.getTab(tabId)

    const assistantMsg: ChatMessage = {
      id: streamMessageId,
      role: "assistant",
      blocks,
      timestamp: Date.now(),
      sessionId: tabId,
      tokenCount: sdkTokenTotal,
      mode: tab?.mode,
    }
    this.sessionStore.appendMessage(tabId, assistantMsg)
  }

  async finalizeStream(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    this.drainDeferredChunk(tabId, true)
    this.setActiveRunState(tabId, "finalizing", { finalizeReason: "normal" })
    await this.finalizerService.finalizeStream(tabId, callbacks)
    const snapshot = this.activityTracker.markRunComplete(tabId)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
    this.activityTracker.clear(tabId)
    this.setActiveRunState(tabId, "completed", { finalizeReason: "normal" })
    this.activeRuns.delete(tabId)

    // Drain host-side prompt queue after stream finalization
    // (the old "append" mode is gone — queued follow-ups are the single path).
    if (this.onQueueDrain) {
      try {
        this.onQueueDrain(tabId, "completed")
      } catch (err) {
        log.error(`Queue drain callback failed for ${tabId}`, err)
      }
    }
  }

  async maybeFinalizeStream(tabId: string, callbacks: StreamCallbacks, trigger: "message_complete" | "status"): Promise<boolean> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return false

    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const deferReason = this.getFinalizeDeferReason(tabId, tab.blocksBuffer, trigger)
    if (deferReason) {
      const now = Date.now()
      const lastLog = this.lastDeferralLogTs.get(tabId) ?? 0
      if (now - lastLog > 5000) {
        log.info(`maybeFinalizeStream: deferred for ${tabId} on ${trigger}: ${deferReason}`)
        this.lastDeferralLogTs.set(tabId, now)
      }
      if (deferReason.includes("tool") || deferReason.includes("subagent")) {
        this.resetPendingToolGraceTimeout(tabId, callbacks)
      }
      return false
    }

    await this.finalizeStream(tabId, callbacks)
    return true
  }

  private getFinalizeDeferReason(tabId: string, blocks: Block[], trigger: "message_complete" | "status"): string | null {
    const pending = this.activeToolCallIds.get(tabId)
    if (pending && pending.size > 0) return `${pending.size} tool call(s) still running`

    const hasUnansweredQuestion = blocks.some(b => b.type === "question" && !(b as Record<string, unknown>).answered)
    if (hasUnansweredQuestion) return "unanswered question block pending"

    const activityReason = this.activityTracker.getFinalizeDeferReason(tabId)
    if (activityReason) return activityReason

    if (trigger !== "message_complete") return null

    const lastToolIndex = [...blocks].reverse().findIndex((block) => block.type === "tool-call" || block.type === "tool_call" || block.type === "tool" || block.type === "question")
    if (lastToolIndex < 0) return null

    const absoluteToolIndex = blocks.length - 1 - lastToolIndex
    const hasTextAfterTool = blocks.slice(absoluteToolIndex + 1).some((block) => {
      return block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0
    })

    return hasTextAfterTool ? null : "assistant message only contains tool blocks"
  }

  /**
   * Abort a streaming session.
   * - Calls abort() on the underlying fetch controller
   * - Emits stream:end with { reason: 'aborted' }
   * - Always cleans up the tab state
   *
   * Coordinates with finalizeStream via `abortedTabs` so that if a server
   * `message_complete` event arrives mid-abort (or finalize is already in
   * flight), only one stream_end is delivered to the webview — the abort one.
   */
  /**
   * True while the late server `MessageAbortedError` for a recently, intentionally
   * aborted tab should be suppressed (see `intentionalAbortUntil`). Self-expiring:
   * a stale entry is dropped on read.
   */
  wasIntentionallyAborted(tabId: string): boolean {
    const until = this.intentionalAbortUntil.get(tabId)
    if (until === undefined) return false
    if (Date.now() >= until) {
      this.intentionalAbortUntil.delete(tabId)
      return false
    }
    return true
  }

  async abort(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.cliSessionId || !this.sessionManager.isRunning) return
    this.stopAllToolPartialPolling(tabId)

    // Mark first so any in-flight finalizeStream that resumes after our await
    // sees the flag and skips emitting its own stream_end.
    this.abortedTabs.add(tabId)
    // Open the intentional-abort window so the late server MessageAbortedError is
    // swallowed rather than shown as a "The request was cancelled." error card.
    this.intentionalAbortUntil.set(tabId, Date.now() + this.ABORT_ERROR_SUPPRESS_MS)
    this.setActiveRunState(tabId, "aborted", { finalizeReason: "user_abort" })

    try {
      const streamMessageId = this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)
      await this.sessionManager.abortSession(tab.cliSessionId)
      const snapshot = this.activityTracker.markRunCancelled(tabId, "User cancelled the run")
      this.postRunActivitySnapshot(tabId, snapshot, callbacks)
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: streamMessageId,
        blocks: [],
        reason: "aborted",
        seq: this.nextSeq(tabId),
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.warn(`Abort failed for tab ${tabId}: ${message}`, e)
      const snapshot = this.activityTracker.markRunCancelled(tabId, message)
      this.postRunActivitySnapshot(tabId, snapshot, callbacks)
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId),
        blocks: [],
        reason: "aborted",
        seq: this.nextSeq(tabId),
      })
    } finally {
      this.cleanupTab(tabId)
      // Drain host-side prompt queue after abort — queue.drainAfterAbort controls behavior
      if (this.onQueueDrain) {
        try {
          this.onQueueDrain(tabId, "aborted")
        } catch (err) {
          log.error(`Queue drain callback failed for ${tabId} after abort`, err)
        }
      }
      // Keep abortedTabs entry for one tick so a finalize already past its
      // guard but not yet at postMessage still sees the flag, then drop it.
      setTimeout(() => this.abortedTabs.delete(tabId), 0)
    }
  }

  private startHeartbeat(tabId: string, callbacks: StreamCallbacks): void {
    this.stopHeartbeat(tabId)
    this.heartbeatSeqs.set(tabId, 0)
    this.heartbeatAckedSeqs.set(tabId, 0)
    const timer = setInterval(() => {
      const tab = this.tabManager.getTab(tabId)
      if (!tab?.isStreaming) {
        this.stopHeartbeat(tabId)
        return
      }
      const seq = (this.heartbeatSeqs.get(tabId) || 0) + 1
      this.heartbeatSeqs.set(tabId, seq)
      callbacks.postMessage({
        type: "stream_ping",
        sessionId: tabId,
        seq,
      })
      const ackedSeq = this.heartbeatAckedSeqs.get(tabId) || 0
      // Only send force_rerender once per "missed-ack window" — re-arm when acks catch up.
      // Previously this would fire every 5s indefinitely if the webview ever stopped acking,
      // saturating the message channel and worsening recovery.
      const lastRerenderSeq = this.lastForceRerenderSeqs.get(tabId) || 0
      if (seq - ackedSeq > 2 && seq > lastRerenderSeq) {
        // Only log the first missed ping to avoid spamming the output
        if (seq - ackedSeq === 3) {
          log.warn(`Heartbeat: tab ${tabId} missed ${seq - ackedSeq} pings, sending force_rerender (seq=${seq})`)
        }
        const fullText = tab.streamingBuffer || ""
        callbacks.postMessage({
          type: "force_rerender",
          sessionId: tabId,
          text: fullText,
        })
        this.lastForceRerenderSeqs.set(tabId, seq)
      } else if (seq - ackedSeq <= 2) {
        this.lastForceRerenderSeqs.set(tabId, 0)
      }
    }, 5000)
    this.heartbeatTimers.set(tabId, timer)
  }

  private stopHeartbeat(tabId: string): void {
    const timer = this.heartbeatTimers.get(tabId)
    if (timer) {
      clearInterval(timer)
      this.heartbeatTimers.delete(tabId)
    }
    this.heartbeatSeqs.delete(tabId)
    this.heartbeatAckedSeqs.delete(tabId)
    this.heartbeatAckedChunkSeqs.delete(tabId)
    this.lastForceRerenderSeqs.delete(tabId)
  }

  handleStreamAck(tabId: string, seq: number, lastRenderedChunkSeq?: number): void {
    if (seq > 0) this.heartbeatAckedSeqs.set(tabId, seq)
    if (lastRenderedChunkSeq !== undefined) {
      this.heartbeatAckedChunkSeqs.set(tabId, lastRenderedChunkSeq)
    }
    this.drainDeferredChunk(tabId)
  }

  private unackedStreamChunkCount(tabId: string): number {
    const posted = this.postedChunkSeqs.get(tabId) || 0
    const rendered = this.heartbeatAckedChunkSeqs.get(tabId) || 0
    return Math.max(0, posted - rendered)
  }

  private shouldDeferStreamChunk(tabId: string): boolean {
    return this.unackedStreamChunkCount(tabId) >= this.MAX_UNACKED_STREAM_CHUNKS
  }

  private postChunkToWebview(tabId: string, text: string, callbacks: StreamCallbacks, messageId?: string): void {
    callbacks.postMessage({
      type: "stream_chunk",
      sessionId: tabId,
      text,
      messageId,
      seq: this.nextChunkSeq(tabId),
    })
  }

  private postOrDeferChunk(tabId: string, text: string, callbacks: StreamCallbacks, messageId?: string): void {
    if (!this.shouldDeferStreamChunk(tabId)) {
      this.postChunkToWebview(tabId, text, callbacks, messageId)
      return
    }

    const existing = this.deferredChunks.get(tabId)
    if (existing) {
      existing.text += text
      existing.callbacks = callbacks
      existing.messageId = messageId ?? existing.messageId
      return
    }

    const timer = setTimeout(() => this.drainDeferredChunk(tabId, true), this.MAX_STREAM_DEFER_MS)
    this.deferredChunks.set(tabId, { text, messageId, callbacks, timer })
  }

  private drainDeferredChunk(tabId: string, force = false): void {
    const deferred = this.deferredChunks.get(tabId)
    if (!deferred) return
    if (!force && this.shouldDeferStreamChunk(tabId)) return

    clearTimeout(deferred.timer)
    this.deferredChunks.delete(tabId)
    this.postChunkToWebview(tabId, deferred.text, deferred.callbacks, deferred.messageId)
  }

  private clearDeferredChunk(tabId: string): void {
    const deferred = this.deferredChunks.get(tabId)
    if (deferred) {
      clearTimeout(deferred.timer)
      this.deferredChunks.delete(tabId)
    }
  }

  replayLiveStreamToWebview(tabId: string, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.isStreaming) return

    const messageId = this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)
    log.info(`replayLiveStreamToWebview: replaying live state for ${tabId} (${tab.streamingBuffer.length} chars, ${tab.blocksBuffer.length} blocks)`)

    this.stuckStreamHandlers.set(tabId, callbacks)
    callbacks.postMessage({
      type: "stream_start",
      sessionId: tabId,
      messageId,
      resumed: {
        existingText: tab.streamingBuffer,
        existingBlocks: [...tab.blocksBuffer],
        messageId,
      },
      seq: this.nextSeq(tabId),
    })
  }

  async reconcileAfterReconnect(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId, reason: "reconnecting" })

    try {
      await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

      const messages = await this.sessionManager.getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(m => m.info.role === "assistant")
      if (lastAssistant) {
        const blocks = this.partsToBlocks(lastAssistant.parts)
        this.tabManager.clearBlocksBuffer(tabId)
        this.tabManager.clearBuffer(tabId)
        for (const block of blocks) {
          this.tabManager.appendToBlocksBuffer(tabId, block)
        }
        const text = this.blocksToText(blocks)
        if (text) this.tabManager.appendToBuffer(tabId, text)

        const info = lastAssistant.info as { id?: string }
        if (info.id && !this.activeMessageIds.has(tabId)) this.activeMessageIds.set(tabId, info.id)
        this.replayLiveStreamToWebview(tabId, callbacks)
      }
    } catch (err) {
      log.warn(`reconcileAfterReconnect failed for ${tabId}`, err)
    }
  }

  async retryFromHere(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    const lastMessages = this.sessionStore.get(tabId)
    const lastAssistant = [...(lastMessages?.messages || [])].reverse().find(m => m.role === "assistant")
    const lastUser = [...(lastMessages?.messages || [])].reverse().find(m => m.role === "user")

    // Detect TTFB timeout: the stream state was "timeout" and no assistant output was produced.
    const prevState = this.streamStates.get(tabId)
    const wasTimeout = prevState === "timeout"
    const hasAssistantOutput = lastAssistant?.blocks?.some(b => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0)

    if (wasTimeout && !hasAssistantOutput && lastUser) {
      log.info(`retryFromHere: TTFB timeout detected for tab ${tabId} — re-sending original user prompt`)
      await this.startPrompt(tabId, lastUser.blocks.map(b => b.type === "text" ? b.text : "").join(" ").trim() || "Please retry the last request.", callbacks)
      return
    }

    const snippet = lastAssistant?.blocks
      ?.filter(b => b.type === "text")
      ?.map(b => b.text || "")
      ?.join(" ")
      ?.slice(0, 200) || ""

    const retryPrompt = lastUser
      ? `Continue from where you left off. Last assistant output began: "${snippet}${snippet.length >= 200 ? "..." : ""}". Please complete the task.`
      : "Please retry the last request."

    const cliSessionId = tab.cliSessionId
    if (!cliSessionId) return

    log.info(`retryFromHere: retrying for tab ${tabId}`)
    await this.startPrompt(tabId, retryPrompt, callbacks)
  }

  appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void {
    // Clear TTFB timeout on first chunk — the model has started responding
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first chunk received for tab ${tabId}`)
    }

    this.tabManager.appendToBuffer(tabId, text)
    this.recordRunActivity(tabId, { kind: "text", label: "Streaming" }, callbacks)

    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    const lastBlock = tab.blocksBuffer[tab.blocksBuffer.length - 1]
    if (lastBlock && lastBlock.type === "text") {
      lastBlock.text += text
    } else {
      tab.blocksBuffer.push({ type: "text", text })
    }

    // Keep the webview anchored to one UI message id for the whole turn. OpenCode
    // can emit multiple assistant message ids for text → tool → text phases, and
    // a bare resp-${sessionId} id is reused across turns. Either case makes DOM
    // queries hit the wrong bubble.
    const cbs = callbacks || this.stuckStreamHandlers.get(tabId)
    if (messageId) {
      const uiMessageId = this.activeMessageIds.get(tabId)
      if (!uiMessageId) {
        this.activeMessageIds.set(tabId, messageId)
      } else if (uiMessageId !== messageId) {
        let logged = this.loggedBubbleMismatches.get(tabId)
        if (!logged) {
          logged = new Set<string>()
          this.loggedBubbleMismatches.set(tabId, logged)
        }
        if (!logged.has(messageId)) {
          logged.add(messageId)
          log.info(`appendChunk: server messageId ${messageId} for tab ${tabId} renders in active bubble ${uiMessageId}`)
        }
      }
    }
    const uiMessageId = this.activeMessageIds.get(tabId) ?? messageId

    if (tab.isStreaming) {
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    if (cbs) {
      this.postOrDeferChunk(tabId, text, cbs, uiMessageId)
    }
  }

  appendToolStart(tabId: string, toolCall: { id?: string; name: string; class?: string; args?: unknown; state?: string }, callbacks: StreamCallbacks): void {
    this.drainDeferredChunk(tabId, true)
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first tool call received for tab ${tabId}`)
    }

    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    if (tab.isStreaming) {
      if (!tab.waitingForCompletion) return
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    const stableId = toolCall.id || this.getStableToolId(tabId)
    this.recordToolRunActivity(tabId, {
      id: stableId,
      name: toolCall.name,
      status: toolCall.state === "pending" ? "pending" : "running",
      input: toolCall.args,
    }, callbacks)
    const isQuestion = (toolCall.name || "").toLowerCase() === "question"
    const pending = this.getOrCreatePendingToolIds(tabId)
    const existingBlock = tab.blocksBuffer.find(
      b => (b.type === "tool-call" || b.type === "question") && b.id === stableId
    )
    if (pending.has(stableId) || existingBlock) {
      log.info(`appendToolStart: duplicate start for ${stableId} on ${tabId}; updating existing tool call`)
      this.trackToolActivity(tabId, stableId)
      this.armToolPartialPolling(tabId, stableId, toolCall, callbacks)
      callbacks.postMessage({
        type: "stream_tool_update",
        sessionId: tabId,
        toolCall: { ...toolCall, id: stableId },
        seq: this.nextSeq(tabId),
      })
      if (existingBlock) {
        if (existingBlock.type === "question") {
          // Keep the persisted question current as its input finishes streaming.
          this.applyQuestionArgs(existingBlock, toolCall.args)
        } else {
          if (toolCall.args !== undefined) existingBlock.args = toolCall.args
          if (toolCall.class) existingBlock.class = toolCall.class
          if (toolCall.name) existingBlock.name = toolCall.name
          // B7: promote a stale tool-call block to a question block when the
          // tool name resolves to "question" on a re-entrant start. Without
          // this, the duplicate-start branch would only update args/class/name
          // and never surface the question — the bar would never populate and
          // the user could not answer. Mutate the persisted block in place
          // AND post question_asked so the webview's bar handler fires.
          if (isQuestion) {
            const promoted: Block = {
              type: "question",
              id: stableId,
              toolCallId: stableId,
              groups: [],
              text: "",
              options: [],
              allowFreeText: true,
            }
            this.applyQuestionArgs(promoted, toolCall.args)
            // Replace tool-call-only fields with question fields (the
            // index-sighed Block bag carries both shapes safely).
            const existingRec = existingBlock as Record<string, unknown>
            Object.keys(existingRec).forEach((k) => {
              if (!(k in (promoted as Record<string, unknown>))) delete existingRec[k]
            })
            Object.assign(existingRec, promoted)
            log.info(`appendToolStart: promoted stale tool-call block ${stableId} to question`)
            callbacks.postMessage({
              type: "question_asked",
              sessionId: tabId,
              block: existingBlock,
              messageId: undefined,
            })
          }
        }
      }
      return
    }

    pending.add(stableId)
    this.trackToolActivity(tabId, stableId)
    const args = toolCall.args
    const workingDir =
      args && typeof args === "object"
        ? ((args as Record<string, unknown>)["cwd"] ??
           (args as Record<string, unknown>)["working_dir"] ??
           (args as Record<string, unknown>)["dir"] ??
           undefined)
        : undefined
    callbacks.postMessage({
      type: "stream_tool_start",
      sessionId: tabId,
      toolCall: {
        ...toolCall,
        id: stableId,
        startedAt: Date.now(),
        workingDir: typeof workingDir === "string" ? workingDir : undefined,
      },
    })
    this.armToolPartialPolling(tabId, stableId, toolCall, callbacks)

    // Persist the block. Question tools persist as an interactive `question`
    // block (not a generic tool card) so stream_end / backfill re-render the
    // question UI rather than a tool args panel.
    if (isQuestion) {
      const qBlock: Block = {
        type: "question",
        id: stableId,
        toolCallId: stableId,
        groups: [],
        text: "",
        options: [],
        allowFreeText: true,
      }
      this.applyQuestionArgs(qBlock, toolCall.args)
      tab.blocksBuffer.push(qBlock)
    } else {
      tab.blocksBuffer.push({
        type: "tool-call",
        id: stableId,
        name: toolCall.name,
        class: toolCall.class || this.toolClass(toolCall.name),
        state: toolCall.state === "pending" ? "pending" : "running",
        args: toolCall.args,
      })
    }
  }

  /** Re-parse question-tool args into a persisted question block (in place). */
  private applyQuestionArgs(block: Block, args: unknown): void {
    const groups = parseQuestionArgs(args)
    if (groups.length === 0) return // partial/empty input — keep what we have
    block.groups = groups
    block.text = groups[0]!.question
    block.options = groups[0]!.options
    block.allowFreeText = parseAllowFreeText(args)
  }

  appendSkill(tabId: string, skillName: string, callbacks: StreamCallbacks): void {
    this.drainDeferredChunk(tabId, true)
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.recordRunActivity(tabId, { kind: "agent", label: `Loading skill: ${skillName}` }, callbacks)

    // Skills are indicators that something is happening.
    // They are rendered as badges in the stream.
    tab.blocksBuffer.push({ type: "skill_badge", skillName })

    callbacks.postMessage({
      type: "skill_indicator",
      sessionId: tabId,
      skillName,
      seq: this.nextSeq(tabId),
    })
  }

  appendToolUpdate(tabId: string, toolCall: { id?: string; name: string; class?: string; args?: unknown; state?: string }, callbacks: StreamCallbacks): void {
    this.drainDeferredChunk(tabId, true)
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    const toolId = toolCall.id || this.getLastPendingToolId(tabId)
    if (!toolId) return

    this.recordToolRunActivity(tabId, {
      id: toolId,
      name: toolCall.name,
      status: toolCall.state === "pending" ? "pending" : "running",
      input: toolCall.args,
    }, callbacks)
    this.trackToolActivity(tabId, toolId)
    callbacks.postMessage({
      type: "stream_tool_update",
      sessionId: tabId,
      toolCall: { ...toolCall, id: toolId },
    })

    // Update persisted tool block
    const block = tab.blocksBuffer.find(
      b => (b.type === "tool-call" || b.type === "question") && b.id === toolId
    )
    if (block) {
      if (block.type === "question") {
        this.applyQuestionArgs(block, toolCall.args)
      } else {
        if (toolCall.args) block.args = toolCall.args
        if (toolCall.class) block.class = toolCall.class
        if (toolCall.state === "pending" || toolCall.state === "running") block.state = toolCall.state
      }
    }
  }

  appendToolPartial(tabId: string, partial: ToolPartialInput, callbacks: StreamCallbacks, source: "sse" | "poll" = "sse"): void {
    this.drainDeferredChunk(tabId, true)
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    const pending = this.activeToolCallIds.get(tabId)
    const toolId = partial.id || this.getLastPendingToolId(tabId)
    if (!toolId) return
    const block = tab.blocksBuffer.find(
      b => (b.type === "tool-call" || b.type === "question") && b.id === toolId
    )
    const blockState = typeof block?.state === "string" ? block.state : undefined
    const isTerminalBlock = blockState === "result" || blockState === "completed" || blockState === "error" || blockState === "stale" || blockState === "unresolved" || blockState === "cancelled" || blockState === "timed_out"
    if (isTerminalBlock && !pending?.has(toolId)) return

    if (source === "sse") {
      const key = this.toolPartialKey(tabId, toolId)
      const fallback = this.toolPartialFallbackTimers.get(key)
      if (fallback) clearTimeout(fallback)
      this.toolPartialFallbackTimers.delete(key)
      const poll = this.toolPartialPollTimers.get(key)
      if (poll) clearInterval(poll)
      this.toolPartialPollTimers.delete(key)
    }

    const key = this.toolPartialKey(tabId, toolId)
    const previous = this.toolPartialOffsets.get(key)
    if (previous && partial.token <= previous.token) return

    let replace = partial.replace === true
    const prevStdoutLength = previous?.stdoutLength ?? 0
    const prevStderrLength = previous?.stderrLength ?? 0
    if (partial.stdoutLength < prevStdoutLength || partial.stderrLength < prevStderrLength) replace = true

    const stdoutDelta = partial.stdoutDelta ?? (
      partial.stdout !== undefined ? (replace ? partial.stdout : partial.stdout.slice(prevStdoutLength)) : ""
    )
    const stderrDelta = partial.stderrDelta ?? (
      partial.stderr !== undefined ? (replace ? partial.stderr : partial.stderr.slice(prevStderrLength)) : ""
    )

    this.toolPartialOffsets.set(key, {
      token: partial.token,
      stdoutLength: partial.stdoutLength,
      stderrLength: partial.stderrLength,
    })
    this.trackToolActivity(tabId, toolId)

    const blockName = typeof block?.name === "string" ? block.name : partial.tool ?? "tool"
    const blockClass = typeof block?.class === "string" ? block.class : this.toolClass(blockName)
    callbacks.postMessage({
      type: "stream_tool_partial",
      sessionId: tabId,
      toolCall: {
        id: toolId,
        name: blockName,
        class: blockClass,
        state: "running",
        partialStdout: stdoutDelta,
        partialStderr: stderrDelta,
        ...(replace && partial.stdout !== undefined ? { stdout: partial.stdout } : {}),
        ...(replace && partial.stderr !== undefined ? { stderr: partial.stderr } : {}),
        token: partial.token,
        stdoutLength: partial.stdoutLength,
        stderrLength: partial.stderrLength,
        stdoutLineCount: partial.stdoutLineCount,
        stderrLineCount: partial.stderrLineCount,
        replace,
        durationMs: partial.durationMs,
        exitCode: partial.exitCode,
      },
      seq: this.nextSeq(tabId),
    })

    if (partial.terminal) {
      this.postToolEnd(tabId, {
        id: toolId,
        ok: partial.ok ?? partial.exitCode === 0,
        result: partial.result ?? partial.stdout ?? "",
        stderr: partial.stderr,
        durationMs: partial.durationMs,
        exitCode: partial.exitCode,
      }, callbacks)
    }
  }

  async cancelToolFromCard(
    tabId: string,
    payload: { toolId?: string; stdout?: string; stderr?: string; durationMs?: number },
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const toolId = payload.toolId || this.getLastPendingToolId(tabId)
    if (toolId) {
      this.stopToolPartialPolling(tabId, toolId)
      this.postToolEnd(tabId, {
        id: toolId,
        ok: false,
        result: payload.stdout || "Tool cancelled",
        stderr: payload.stderr,
        durationMs: payload.durationMs,
        state: "cancelled",
      }, callbacks)
    }
    await this.abort(tabId, callbacks)
  }

  private getStableToolId(tabId: string): string {
    const count = (this.toolCallCounts.get(tabId) || 0) + 1
    this.toolCallCounts.set(tabId, count)
    return `tool-${count}`
  }

  appendToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): void {
    this.drainDeferredChunk(tabId, true)
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    this.postToolEnd(tabId, result, callbacks)
  }

  /** Register a delegate that replays child-session events from the pending buffer. */
  setChildSessionReplayer(replayer: (tabId: string, childSessionId: string) => void): void {
    this.childSessionReplayer = replayer
  }

cleanupTab(tabId: string): void {
    this.clearTtfbTimeout(tabId)
    this.stopAllToolPartialPolling(tabId)
    this.ttfbAbortControllers.delete(tabId)
    this.tabManager.setStreaming(tabId, false)
    this.stopWatchdogIfNoStreams()
    this.tabManager.setWaitingForCompletion(tabId, false)
    this.tabManager.clearCompletionTimeout(tabId)
    this.tabManager.clearBuffer(tabId)
    this.stuckStreamHandlers.delete(tabId)
    this.toolCallCounts.delete(tabId)
    this.activeToolCallIds.delete(tabId)
    this.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)
    this.activeMessageIds.delete(tabId)
    this.activeRuns.delete(tabId)
    this.loggedBubbleMismatches.delete(tabId)
    this.stopHeartbeat(tabId)
    this.subagentHeartbeat.stop(tabId)
    const cliSessionId = this.tabManager.getTab(tabId)?.cliSessionId
    if (cliSessionId) this.injectedInstructionsSessions.delete(cliSessionId)
    this.msgSeqs.delete(tabId)
    this.postedChunkSeqs.delete(tabId)
    this.clearDeferredChunk(tabId)
    this.finalUsageBaselines.delete(tabId)
    this.contextEstimateVersions.delete(tabId)
    this.lastDeferralLogTs.delete(tabId)
    this.activityTracker.clear(tabId)
    // Clean up any materialized attachment files for this tab.
    const urls = this.pendingAttachmentUrls.get(tabId)
    if (urls && urls.length > 0) {
      void this.attachmentStorage.cleanup(urls)
      this.pendingAttachmentUrls.delete(tabId)
    }
  }

  /**
   * Dispose of all resources held by this coordinator. Called by the host
   * (ChatProvider) when the extension deactivates. vscode's Disposable
   * contract is sync, so attachment cleanup (which involves unlink +
   * rmdir) is fire-and-forget. The temp dir is rooted under os.tmpdir()
   * so the OS sweeps it on reboot regardless.
   */
  private refreshContextTokenEstimate(tabId: string): void {
    const session = this.sessionStore.get(tabId)
    const historyTokens = session ? session.messages.reduce((acc, msg) => acc + this.estimateMessageTokens(msg), 0) : 0
    const systemTokens = 500 // Arbitrary or estimated base for system prompt
    const version = (this.contextEstimateVersions.get(tabId) ?? 0) + 1
    const requestedAt = Date.now()
    this.contextEstimateVersions.set(tabId, version)

    void this.contextEngine.gatherContext()
      .then(ctxPkg => {
        if (this.contextEstimateVersions.get(tabId) !== version) {
          log.debug(`Skipping stale context token estimate for ${tabId}`)
          return
        }
        const workspaceTokens = estimateContextTokens(ctxPkg)
        const total = historyTokens + systemTokens + workspaceTokens
        this.contextMonitor.updateTokens(total, tabId, {
          system: systemTokens,
          history: historyTokens,
          workspace: workspaceTokens
        }, { source: "estimated", updatedAt: requestedAt })
      })
      .catch(err => log.warn("Failed to refresh context token estimate", err))
  }

  private estimateMessageTokens(msg: ChatMessage): number {
    let total = 0
    for (const block of msg.blocks) {
      if (block.type === "text" && block.text) {
        total += estimateTokens(block.text as string)
      } else if (block.type === "image" && block.data) {
        total += 1000 // Arbitrary estimate for image tokens
      } else if (block.type === "tool-call") {
        total += estimateTokens(JSON.stringify(block.args || {}))
        if (block.result) total += estimateTokens(block.result as string)
      }
    }
    return total
  }

  /**
   * Reconstruct blocks from a server-side parts snapshot. Delegates to the
   * canonical converter so reconnect / replay produces the same shape as
   * historical-load and live-stream paths. Spec ADR-008 §5.2.
   *
   * Skill/skill_badge parts are not part of the SDK's `Part` union — the
   * server emits them as a parallel synthesised event. They're handled
   * post-conversion here to keep the canonical converter free of
   * non-SDK shapes.
   */
  private partsToBlocks(parts: readonly unknown[]): Block[] {
    const canonical = sdkConvertPartsToBlocks(parts as Part[])
    const out: Block[] = []
    for (const block of canonical) out.push(block as Block)
    // Synthetic skill_badge parts: server-only, not in SDK Part union.
    for (const part of parts) {
      if (!this.isRecord(part)) continue
      if (part.type !== "skill" && part.type !== "skill_badge") continue
      const skillName =
        typeof part.skillName === "string"
          ? part.skillName
          : typeof part.skill === "string"
            ? (part.skill as string)
            : "skill"
      out.push({ type: "skill_badge", skillName })
    }
    return out
  }

  private blocksToText(blocks: readonly Block[]): string {
    return blocks
      .filter((block): block is Block & { type: "text"; text: string } => block.type === "text" && typeof (block as { text?: unknown }).text === "string")
      .map(block => block.text)
      .join("")
  }

  private toolClass(toolName: string): "read" | "write" | "exec" | "meta" {
    return classifyTool(toolName)
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  /**
   * Strip context wrapper from response text.
   * The AI may echo back the context block, which we don't want to display.
   * Uses non-greedy matching to avoid over-stripping valid content.
   */
  private stripContextWrapper(text: string): string {
    // Only remove complete <context>...</context> blocks (non-greedy match)
    // This avoids stripping valid content that might contain angle brackets
    const contextRegex = /<context>[\s\S]*?<\/context>/gi
    let cleaned = text.replace(contextRegex, "").trim()

    // Log warning if partial context tags remain (unexpected AI behavior)
    if (cleaned.includes("<context>") || cleaned.includes("</context>")) {
      log.warn("Response contains partial context tags - this is unexpected")
    }

    return cleaned
  }

  dispose(): void {
    this.tabCloseDisposable?.dispose()
    this.tabCloseDisposable = null
    if (this.streamWatchdog) {
      clearInterval(this.streamWatchdog)
      this.streamWatchdog = null
    }
    this.stuckStreamHandlers.clear()
    for (const timer of this.ttfbTimeouts.values()) {
      clearTimeout(timer)
    }
    this.ttfbTimeouts.clear()
    this.ttfbAbortControllers.clear()
    for (const timer of this.pendingToolGraceTimeouts.values()) {
      clearTimeout(timer)
    }
    this.pendingToolGraceTimeouts.clear()
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer)
    }
    this.heartbeatTimers.clear()
    this.subagentHeartbeat.stopAll()
    this.finalizingTabs.clear()
    this.abortedTabs.clear()
    this.intentionalAbortUntil.clear()
    this.streamStates.clear()
    this.activeMessageIds.clear()
    this.activeRuns.clear()
    this.toolCallCounts.clear()
    this.activeToolCallIds.clear()
    this.toolActivityAt.clear()
    for (const timer of this.toolPartialFallbackTimers.values()) {
      clearTimeout(timer)
    }
    this.toolPartialFallbackTimers.clear()
    for (const timer of this.toolPartialPollTimers.values()) {
      clearInterval(timer)
    }
    this.toolPartialPollTimers.clear()
    this.toolPartialOffsets.clear()
    this.toolPartialWarnedSessions.clear()
    this.heartbeatSeqs.clear()
    this.heartbeatAckedSeqs.clear()
    this.heartbeatAckedChunkSeqs.clear()
    this.lastForceRerenderSeqs.clear()
    this.msgSeqs.clear()
    this.postedChunkSeqs.clear()
    for (const deferred of this.deferredChunks.values()) {
      clearTimeout(deferred.timer)
    }
    this.deferredChunks.clear()
    // Clean up any remaining attachment files across all tabs. Fire-and-
    // forget: vscode's Disposable contract is sync and the temp dir will
    // be swept by the OS on reboot regardless.
    const allUrls = Array.from(this.pendingAttachmentUrls.values()).flat()
    if (allUrls.length > 0) {
      void this.attachmentStorage.cleanup(allUrls).then(() =>
        this.attachmentStorage.dispose(),
      )
    } else {
      void this.attachmentStorage.dispose()
    }
    this.pendingAttachmentUrls.clear()
  }
}
