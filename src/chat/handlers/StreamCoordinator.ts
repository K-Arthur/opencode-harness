import * as vscode from "vscode"
import { DiffApplier } from "../../diff/DiffApplier"
import { DiffHandler } from "./DiffHandler"
import { TabManager } from "../TabManager"
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
import { StreamFinalizerService } from "./StreamFinalizerService"
import { MethodologyAdvisor, type MethodologyAdvice } from "../../methodology/MethodologyAdvisor"
import { classifyTool } from "./toolClassifier"
import type { AdvisoryOrchestrationResult } from "../../methodology/MethodologyOrchestrator"
import { updateMethodologyStatus, getMethodologyOrchestrator } from "../../extension"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
}

export type ToolEndResult = { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }

/** Explicit lifecycle states for a streaming session */
export type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout"

export class StreamCoordinator {
  private diffHandler: DiffHandler
  private finalizerService: StreamFinalizerService
  /** Watchdog interval for streams with no server activity across all channels. */
  private readonly STREAM_STUCK_MS = 600000
  /** Time-to-first-byte timeout: no chunk received within 45s */
  readonly TTFB_TIMEOUT_MS = 45000
  /** Short grace window for terminal status to be followed by late tool_end events */
  readonly TOOL_FINALIZE_GRACE_MS = 30000
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()
  private ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Tabs currently in the process of finalizing — guards against double-finalize */
  private finalizingTabs = new Set<string>()
  /** Tabs whose stream was explicitly aborted — finalizeStream must not emit its own stream_end */
  private abortedTabs = new Set<string>()
  /** Per-tab stream lifecycle state for observability */
  private streamStates = new Map<string, StreamLifecycleState>()
  /** Per-tab active message ID — detects when the server starts a new assistant message mid-stream */
  private activeMessageIds = new Map<string, string>()
  /** Per-tab tool call counter for stable deterministic IDs when server IDs are missing */
  private toolCallCounts = new Map<string, number>()
  /** Per-tab pending tool call IDs. Set insertion order gives FIFO fallback for missing IDs. */
  private activeToolCallIds = new Map<string, Set<string>>()
  /** Last activity per pending tool, used when reconciling stale terminal states. */
  private toolActivityAt = new Map<string, Map<string, number>>()
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
  /** Per-tab append callbacks for steer prompts — executed after stream_end */
  private appendCallbacks = new Map<string, (() => Promise<void>)[]>()
  /** Per-tab message sequence counter — monotonically increasing, attached to every streaming message */
  private msgSeqs = new Map<string, number>()
  private tabCloseDisposable: vscode.Disposable | null = null
  /** Methodology classifier/selector — pluggable so tests can stub it */
  private readonly methodologyAdvisor: MethodologyAdvisor

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly modelManager: ModelManager,
    private readonly tabManager: TabManager,
    private readonly rateLimitMonitor: RateLimitMonitor,
    diffApplier: DiffApplier,
    methodologyAdvisor?: MethodologyAdvisor
  ) {
    this.methodologyAdvisor = methodologyAdvisor ?? new MethodologyAdvisor()
    this.diffHandler = new DiffHandler(diffApplier)
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

  /**
   * Classify the outgoing prompt, prepend a methodology hint to `parts`, and
   * notify the webview via `methodology_selected`. Returns the advice (or
   * null when the advisor declined). Never throws — methodology guidance
   * must never block the user's prompt.
   */
  private applyMethodologyAdvice(
    tabId: string,
    text: string,
    parts: Array<{ type: "text"; text: string }>,
    _callbacks: StreamCallbacks
  ): MethodologyAdvice | null {
    if (!this.methodologyAdvisor.isEnabled()) return null
    try {
      const tab = this.tabManager.getTab(tabId)
      // Per-tab opt-out: if the tab carries `methodologyDisabled`, skip.
      const tabDisabled = (tab as unknown as { methodologyDisabled?: boolean } | undefined)?.methodologyDisabled === true
      if (tabDisabled) return null

      const advice = this.methodologyAdvisor.advise(text, {
        // We don't currently know if an image is attached at this layer.
        // The advisor remains conservative without it.
        hasImageAttachment: false,
      })
      if (!advice) return null

      parts.push({ type: "text", text: advice.promptAddendum })
      log.info(`[methodology] tab=${tabId.slice(0, 8)} ${advice.signature} (conf=${advice.selection.confidence.toFixed(2)})`)

      // Update status bar via orchestrator advisory if available
      try {
        const orchestrator = getMethodologyOrchestrator()
        if (orchestrator && orchestrator.getConfig().enabled) {
          const result = orchestrator.advise(text, { hasImageAttachment: false })
          updateMethodologyStatus(result)
        }
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
    this.streamStates.set(tabId, state)
    const ctxStr = context ? ` ${JSON.stringify(context)}` : ""
    log.info(`[stream:${tabId}] ${previous} → ${state}${ctxStr}`)
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

  private postToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): boolean {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return false

    const pending = this.activeToolCallIds.get(tabId)
    let toolId = result.id && result.id !== "unknown" ? result.id : undefined
    if (!toolId || (pending && !pending.has(toolId))) {
      toolId = pending?.values().next().value
    }
    if (!toolId) return false

    if (pending) {
      pending.delete(toolId)
      if (pending.size === 0) {
        this.activeToolCallIds.delete(tabId)
        this.clearPendingToolGraceTimeout(tabId)
      }
    }
    this.toolActivityAt.get(tabId)?.delete(toolId)

    callbacks.postMessage({
      type: "stream_tool_end",
      sessionId: tabId,
      toolId,
      result: { ...result, id: toolId },
    })

    const block = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
    if (block) {
      block.state = result.stale ? "stale" : result.ok ? "result" : "error"
      block.result = result.result
      block.durationMs = result.durationMs
    }
    return true
  }

  private resetPendingToolGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    if (this.pendingToolGraceTimeouts.has(tabId)) return

    const timeout = setTimeout(() => {
      this.pendingToolGraceTimeouts.delete(tabId)
      void this.markUnresolvedPendingToolCalls(tabId, callbacks)
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
        if (!currentPending || currentPending.size === 0) return

        const fallbackId = currentPending.size === 1 ? currentPending.values().next().value : undefined
        const toolId = resolvedId && currentPending.has(resolvedId) ? resolvedId : fallbackId
        if (!toolId) continue

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
      callbacks.postMessage({
        type: "stream_tool_unresolved",
        sessionId: tabId,
        toolCallId: toolId,
        message: "Tool did not emit a completion event before the server became idle.",
      })
    }
  }

  async startPrompt(tabId: string, text: string, callbacks: StreamCallbacks, variant?: string): Promise<void> {
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

    if (!this.sessionManager.isRunning) {
      try {
        await this.sessionManager.start()
      } catch (e) {
        const msg = (e as Error).message
        log.error("Failed to start OpenCode server", e)
        vscode.window.showErrorMessage(`Could not start OpenCode. ${msg}`)
        callbacks.postRequestError(msg)
        this.cleanupTab(tabId)
        return
      }
    }

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
      return
    }

    // Now set streaming state AFTER atomic reservation
    this.tabManager.setStreaming(tabId, true)
    this.setStreamState(tabId, "sending", { model: tab.model, sessionId: tab.cliSessionId })

    try {
      this.refreshContextTokenEstimate(tabId)

      const cliSessionId = await this.sessionManager.ensureSession(tab.cliSessionId, `Tab ${tabId.slice(0, 8)}`)
      this.tabManager.setCliSessionId(tabId, cliSessionId)
      this.sessionStore.updateCliSessionId(tabId, cliSessionId)
      const streamMessageId = this.createStreamMessageId(tabId, cliSessionId)
      this.activeMessageIds.set(tabId, streamMessageId)

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

      // NOTE: User message is already rendered and stored by the webview.
      // Persisting here caused duplicate rendering (garbled/flash effect).
      callbacks.postMessage({
        type: "stream_start",
        sessionId: tabId,
        messageId: streamMessageId,
        seq: this.nextSeq(tabId),
      })

      this.tabManager.setWaitingForCompletion(tabId, true)
      this.tabManager.clearBuffer(tabId)
      this.startWatchdog()

      // TTFB (time-to-first-byte) timeout — fires if no stream chunk arrives within 30s
      const ttfbTimeout = setTimeout(() => {
        const t = this.tabManager.getTab(tabId)
        if (t?.isStreaming && t.waitingForCompletion) {
          const eventStreamStatus = this.sessionManager.eventStreamStatus
          const eventStreamDisconnected = eventStreamStatus.state !== "connected"
          const reason = eventStreamDisconnected ? "event_stream_disconnected" : "ttfb_timeout"
          log.warn(`TTFB timeout for tab ${tabId} — no chunk received within ${this.TTFB_TIMEOUT_MS}ms (eventStream=${eventStreamStatus.state}, lastRaw=${eventStreamStatus.lastRawEventType || "none"})`)
          this.setStreamState(tabId, "timeout", { sessionId: t.cliSessionId, eventStream: eventStreamStatus.state })
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
            callbacks.postRequestError("OpenCode event stream disconnected before any response events arrived.", tabId)
          }
          this.cleanupTab(tabId)
        }
      }, this.TTFB_TIMEOUT_MS)
      this.ttfbTimeouts.set(tabId, ttfbTimeout)

      const modelRef = tab.model ? parseModelRef(tab.model) : undefined

      // Pass tools configuration to server based on mode.
      //
      // Plan mode disables EVERY write-capable tool so the agent can only
      // read/analyze and propose changes (rendered as PLAN diffs the user
      // approves). Canonical opencode tool names per
      //   https://opencode.ai/docs/tools/
      //   edit         — modify existing files
      //   write        — create/overwrite files
      //   apply_patch  — apply patches
      //   bash         — execute shell commands
      //
      // Build/Auto modes pass undefined → server enables all tools by default.
      //
      // The previous code passed an unknown tool key that the server
      // ignored, and `write`/`apply_patch` were never restricted at all,
      // so plan mode silently allowed file mutations.
      const tools = tab.mode === "plan"
        ? { edit: false, write: false, apply_patch: false, bash: false }
        : undefined

      // Inject per-tab instructions as a prepended text part on the first turn only
      const parts: Array<{ type: "text"; text: string }> = []
      if (tab.instructions && !this.injectedInstructionsSessions.has(cliSessionId)) {
        parts.push({ type: "text", text: tab.instructions })
        this.injectedInstructionsSessions.add(cliSessionId)
      }

      // Methodology advice — classify the user's prompt and prepend a short
      // strategy hint. Pure/synchronous; returns null for trivial inputs and
      // slash commands. The selected methodology is also surfaced to the
      // webview so the user can see (and later override) it.
      this.applyMethodologyAdvice(tabId, text, parts, callbacks)

      parts.push({ type: "text", text })

      await this.sessionManager.sendPromptAsync(cliSessionId, parts, { model: modelRef, tools, variant })

      this.startHeartbeat(tabId, callbacks)
      // startWatchdog is the single hard safety net and is driven by server activity.
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Prompt failed", e)
      vscode.window.showErrorMessage(`OpenCode request failed: ${message}`)
      // Emit stream_end so the webview cleans up the assistant placeholder BEFORE showing the error
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId),
        blocks: [],
        reason: "error",
        seq: this.nextSeq(tabId),
      })
      callbacks.postRequestError(message)
      this.cleanupTab(tabId)
    }
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
        if (typeof info.cost === "number") {
          this.sessionStore.updateCost(tabId, info.cost)
          callbacks.postMessage({ type: "cost_update", sessionId: tabId, cost: info.cost, seq: this.nextSeq(tabId) })
        }
        if (info.tokens) {
          const input = info.tokens.input ?? 0
          const output = info.tokens.output ?? 0
          const reasoning = info.tokens.reasoning ?? 0
          const cacheRead = info.tokens.cache?.read ?? 0
          const cacheWrite = info.tokens.cache?.write ?? 0
          sdkTokenTotal = info.tokens.total ?? input + output + reasoning + cacheRead + cacheWrite
          this.sessionStore.updateTokenUsage(tabId, {
            prompt: input,
            completion: output,
            total: sdkTokenTotal,
            reasoning,
            cacheRead,
            cacheWrite,
          })
          callbacks.postMessage({
            type: "token_usage",
            sessionId: tabId,
            usage: { prompt: input, completion: output, total: sdkTokenTotal, reasoning, cacheRead, cacheWrite },
          })
          const tab = this.tabManager.getTab(tabId)
          const selectedModel = tab?.model || this.modelManager.model
          const provider = parseModelRef(selectedModel).providerID || parseModelRef(this.modelManager.model).providerID || undefined
          this.rateLimitMonitor.recordTokenUsage(input, output, provider, info.cost)
        }
      }
    } catch (err) {
      log.warn(`Failed to fetch final session for ${tabId}, falling back to buffer`, err)
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }

    return { blocks, sdkTokenTotal }
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

    const assistantMsg: ChatMessage = {
      id: streamMessageId,
      role: "assistant",
      blocks,
      timestamp: Date.now(),
      sessionId: tabId,
      tokenCount: sdkTokenTotal,
    }
    this.sessionStore.appendMessage(tabId, assistantMsg)
  }

  async finalizeStream(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.finalizerService.finalizeStream(tabId, callbacks)
    
    // Execute append callbacks after stream finalization
    const callbacksToExecute = this.appendCallbacks.get(tabId)
    if (callbacksToExecute && callbacksToExecute.length > 0) {
      log.info(`Executing ${callbacksToExecute.length} append callback(s) for ${tabId}`)
      for (const callback of callbacksToExecute) {
        try {
          await callback()
        } catch (err) {
          log.error(`Append callback failed for ${tabId}`, err)
        }
      }
      this.appendCallbacks.delete(tabId)
    }
  }

  /**
   * Register a callback to execute after the current stream completes.
   * Used by steer prompts in "append" mode.
   */
  registerAppendCallback(tabId: string, callback: () => Promise<void>): void {
    const existing = this.appendCallbacks.get(tabId) || []
    existing.push(callback)
    this.appendCallbacks.set(tabId, existing)
    log.info(`Registered append callback for ${tabId} (total: ${existing.length})`)
  }

  async maybeFinalizeStream(tabId: string, callbacks: StreamCallbacks, trigger: "message_complete" | "status"): Promise<boolean> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return false

    await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

    const deferReason = this.getFinalizeDeferReason(tabId, tab.blocksBuffer, trigger)
    if (deferReason) {
      log.info(`maybeFinalizeStream: deferred for ${tabId} on ${trigger}: ${deferReason}`)
      if (deferReason.includes("tool call")) {
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

    if (trigger !== "message_complete") return null

    const lastToolIndex = [...blocks].reverse().findIndex((block) => block.type === "tool-call" || block.type === "tool_call" || block.type === "tool")
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
  async abort(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.cliSessionId || !this.sessionManager.isRunning) return

    // Mark first so any in-flight finalizeStream that resumes after our await
    // sees the flag and skips emitting its own stream_end.
    this.abortedTabs.add(tabId)

    try {
      const streamMessageId = this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)
      await this.sessionManager.abortSession(tab.cliSessionId)
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
    this.heartbeatAckedSeqs.set(tabId, seq)
    if (lastRenderedChunkSeq !== undefined) {
      this.heartbeatAckedChunkSeqs.set(tabId, lastRenderedChunkSeq)
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
    this.tabManager.touchActivity(tabId)

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
        log.info(`appendChunk: server messageId ${messageId} for tab ${tabId} renders in active bubble ${uiMessageId}`)
      }
    }
    const uiMessageId = this.activeMessageIds.get(tabId) ?? messageId

    if (tab.isStreaming) {
      this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId })
    }

    if (cbs) {
      cbs.postMessage({ type: "stream_chunk", sessionId: tabId, text, messageId: uiMessageId, seq: this.nextSeq(tabId) })
    }
  }

  appendToolStart(tabId: string, toolCall: { id?: string; name: string; class?: string; args?: unknown; state?: string }, callbacks: StreamCallbacks): void {
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
    const pending = this.getOrCreatePendingToolIds(tabId)
    const existingBlock = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === stableId)
    if (pending.has(stableId) || existingBlock) {
      log.info(`appendToolStart: duplicate start for ${stableId} on ${tabId}; updating existing tool call`)
      this.trackToolActivity(tabId, stableId)
      callbacks.postMessage({
        type: "stream_tool_update",
        sessionId: tabId,
        toolCall: { ...toolCall, id: stableId },
        seq: this.nextSeq(tabId),
      })
      if (existingBlock) {
        if (toolCall.args !== undefined) existingBlock.args = toolCall.args
         if (toolCall.class) existingBlock.class = toolCall.class
        if (toolCall.name) existingBlock.name = toolCall.name
      }
      return
    }

    pending.add(stableId)
    this.trackToolActivity(tabId, stableId)
    callbacks.postMessage({
      type: "stream_tool_start",
      sessionId: tabId,
      toolCall: { ...toolCall, id: stableId },
    })

    // Persist tool block
    tab.blocksBuffer.push({
      type: "tool-call",
      id: stableId,
      name: toolCall.name,
       class: toolCall.class || this.toolClass(toolCall.name),
      state: toolCall.state === "pending" ? "pending" : "running",
      args: toolCall.args,
    })
  }

  appendSkill(tabId: string, skillName: string, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

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
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    const toolId = toolCall.id || this.getLastPendingToolId(tabId)
    if (!toolId) return

    this.trackToolActivity(tabId, toolId)
    callbacks.postMessage({
      type: "stream_tool_update",
      sessionId: tabId,
      toolCall: { ...toolCall, id: toolId },
    })

    // Update persisted tool block
    const block = tab.blocksBuffer.find(b => b.type === "tool-call" && b.id === toolId)
    if (block) {
      if (toolCall.args) block.args = toolCall.args
       if (toolCall.class) block.class = toolCall.class
      if (toolCall.state === "pending" || toolCall.state === "running") block.state = toolCall.state
    }
  }

  private getStableToolId(tabId: string): string {
    const count = (this.toolCallCounts.get(tabId) || 0) + 1
    this.toolCallCounts.set(tabId, count)
    return `tool-${count}`
  }

  appendToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return
    this.tabManager.touchActivity(tabId)

    this.postToolEnd(tabId, result, callbacks)
  }

  getDiffHandler(): DiffHandler {
    return this.diffHandler
  }

private cleanupTab(tabId: string): void {
    this.clearTtfbTimeout(tabId)
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
    this.stopHeartbeat(tabId)
    const cliSessionId = this.tabManager.getTab(tabId)?.cliSessionId
    if (cliSessionId) this.injectedInstructionsSessions.delete(cliSessionId)
    this.msgSeqs.delete(tabId)
  }

  private refreshContextTokenEstimate(tabId: string): void {
    const session = this.sessionStore.get(tabId)
    const historyTokens = session ? session.messages.reduce((acc, msg) => acc + this.estimateMessageTokens(msg), 0) : 0
    const systemTokens = 500 // Arbitrary or estimated base for system prompt

    void this.contextEngine.gatherContext()
      .then(ctxPkg => {
        const workspaceTokens = estimateContextTokens(ctxPkg)
        const total = historyTokens + systemTokens + workspaceTokens
        this.contextMonitor.updateTokens(total, tabId, {
          system: systemTokens,
          history: historyTokens,
          workspace: workspaceTokens
        })
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
    for (const timer of this.pendingToolGraceTimeouts.values()) {
      clearTimeout(timer)
    }
    this.pendingToolGraceTimeouts.clear()
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer)
    }
    this.heartbeatTimers.clear()
    this.finalizingTabs.clear()
    this.abortedTabs.clear()
    this.streamStates.clear()
    this.activeMessageIds.clear()
    this.toolCallCounts.clear()
    this.activeToolCallIds.clear()
    this.toolActivityAt.clear()
    this.heartbeatSeqs.clear()
    this.heartbeatAckedSeqs.clear()
    this.heartbeatAckedChunkSeqs.clear()
    this.lastForceRerenderSeqs.clear()
    this.msgSeqs.clear()
    this.diffHandler.dispose()
  }
}
