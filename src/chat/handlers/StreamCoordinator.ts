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
import type { Part } from "@opencode-ai/sdk/v2"
import { partsToBlocks as sdkConvertPartsToBlocks } from "../../session/sdkMessageConverter"
import { isLocalPlaceholderSessionId } from "../../session/sessionUtils"
import type { LiveToolOutputSnapshot } from "../../session/liveToolOutput"
import { StreamFinalizerService } from "./StreamFinalizerService"
import { pickLatestAssistant } from "./finalMessagePicker"
import { MethodologyAdvisor, type MethodologyAdvice } from "../../methodology/MethodologyAdvisor"
import { classifyTool, isSubagentToolName, parseSubagentInvocation } from "./toolClassifier"
import { parseQuestionArgs, parseAllowFreeText } from "../../session/questionModel"
import { updateMethodologyStatus } from "../../methodology/registry"
import { createAttachmentStorage, type MaterializedAttachment } from "./attachmentStorage"
import { RunActivityTracker } from "./RunActivityTracker"
import { IntentionalAbortRegistry } from "./intentionalAbortRegistry"
import type { AgentRunState, RunProgressEvent, SubagentActivityInput, SubagentRunState, ToolActivityInput } from "./runActivityTypes"
import { SubagentHeartbeat } from "./SubagentHeartbeat"
import { mapRunError, type RunErrorContext } from "./runErrorMapper"
import { logStreamTrace } from "../../session/streamTrace"
import { modeToAgent } from "../modePolicy"
import { createStreamingLog, type StreamingLogSink } from "./StreamingLog"

import type { StreamCallbacks, ToolEndResult, ToolPartialInput, StreamLifecycleState, ActiveRunMetrics } from "./StreamCoordinatorTypes"
export type { StreamCallbacks, ToolEndResult, ToolPartialInput, StreamLifecycleState, ActiveRunMetrics }
import type { SessionManagerRegistry } from "../../session/SessionManagerRegistry"
import { HeartbeatService, type DeferredChunkEntry } from "./HeartbeatService"
import { ToolPartialPoller } from "./ToolPartialPoller"
import { ToolCallTracker } from "./ToolCallTracker"
import { StreamTimeoutManager } from "./StreamTimeoutManager"

/** Context object grouping all StreamCoordinator dependencies to reduce constructor parameter count. */
export interface StreamDeps {
  sessionManager: SessionManager
  sessionStore: SessionStore
  contextEngine: ContextEngine
  contextMonitor: ContextMonitor
  modelManager: ModelManager
  tabManager: TabManager
  rateLimitMonitor: RateLimitMonitor
  diffApplier: DiffApplier
  methodologyAdvisor?: MethodologyAdvisor
  attachmentStorage?: ReturnType<typeof createAttachmentStorage>
}

/** Configuration object for startPrompt to reduce parameter count. */
export interface StartPromptConfig {
  tabId: string
  text: string
  callbacks: StreamCallbacks
  variant?: string
  attachments?: Array<{ data: string; mimeType: string }>
  identity?: PromptRunIdentity
}

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
  /** Synthetic `resp-…` id used to anchor the webview bubble for the whole turn. */
  assistantMessageId?: string
  /** Server `msg_…` id observed during streaming. Used to correlate the late
   *  MessageAbortedError to an intentional abort (distinct from assistantMessageId). */
  serverMessageId?: string
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
  /** Time-to-first-byte timeout: no chunk received within TTFB_TIMEOUT_MS.
   *  Configurable via `opencode.streaming.ttfbTimeoutMs` (default 180_000).
   *  Research shows reasoning models (GLM-5.x, Kimi, DeepSeek-R1, Qwen-QwQ)
   *  routinely take 60–180s to first token; the 90s default shipped in
   *  earlier builds was too short for many third-party providers. The value
   *  is resolved at runtime via {@link resolveTtfbTimeoutMs} so per-workspace
   *  overrides take effect without a code change. */
  readonly TTFB_TIMEOUT_MS_DEFAULT = 180_000
  /** Resolved at construction time from workspace config; mutable so tests
   *  can override after instantiation. The TTFB watchdog reads this via
   *  {@link resolveTtfbTimeoutMs} rather than a `readonly` field directly so
   *  test stubs and future per-provider overrides have one injection point. */
  private ttfbTimeoutMs: number
  /** Backwards-compat: existing structural tests assert a public field
   *  `TTFB_TIMEOUT_MS = <number>` exists. Exposing the resolved value here
   *  keeps those tests green while the actual watchdog reads the runtime
   *  value through {@link resolveTtfbTimeoutMs}. */
  get TTFB_TIMEOUT_MS(): number { return this.ttfbTimeoutMs }
  /** Hard floor for the configured TTFB. Anything below this silently
   *  returns the floor — a too-short TTFB is exactly the bug that makes
   *  the Send button revert mid-thinking. */
  static readonly TTFB_TIMEOUT_FLOOR_MS = 60_000
  /** Hard ceiling: keeps a misconfigured workspace from making the watchdog
   *  effectively never fire. 10 minutes matches the longest observed
   *  reasoning budget (DeepSeek-R1 on cold providers). */
  static readonly TTFB_TIMEOUT_CEILING_MS = 600_000
  /** B10-recovery: Hard timeout for the expired-question fallback startPrompt.
   *  Fires UNCONDITIONALLY after 20s — not gated by shouldTriggerStartupTimeout,
   *  which can be silently disabled by stray activity events leaving the user
   *  stuck "generating" indefinitely. Set at 20s to give most models a
   *  realistic chance at TTFB before falling back; the answer text is
   *  preserved for auto-resend regardless. */
  readonly EXPIRED_RECOVERY_TIMEOUT_MS = 20_000
  /** Short grace window for terminal status to be followed by late tool_end events */
  readonly TOOL_FINALIZE_GRACE_MS = 30000
  /** Issue 3: Grace window before force-finalizing a stream after a server disconnect.
   *  If the event stream reconnects within this window, reconcileAfterReconnect
   *  takes over and properly finalizes. If not, the stream is force-finalized
   *  with unresolved tools/subagents so the UI doesn't stay stuck. */
  readonly DISCONNECT_GRACE_MS = 60_000
  /** G5: quiet period required before a status-triggered finalize is allowed
   *  to run. The server can emit transient `session.idle` events between
   *  tool calls, during provider retries, or right before the next message
   *  part arrives. Without this guard, the stream gets finalized prematurely
   *  and the webview send button reverts to "Send" while the model is still
   *  working. If we observe any activity (chunk/tool/permission) during the
   *  quiet window, we cancel the pending finalize. */
  readonly STATUS_FINALIZE_QUIET_MS = 1500
  private readonly MAX_UNACKED_STREAM_CHUNKS = 8
  private readonly MAX_STREAM_DEFER_MS = 250
  private heartbeatService: HeartbeatService
  private toolPartialPoller: ToolPartialPoller
  private toolCallTracker: ToolCallTracker
  private streamTimeoutManager: StreamTimeoutManager
  /** Tracks last deferral log time per tab to suppress duplicate logging during long subagent waits. */
  private lastDeferralLogTs = new Map<string, number>()
  private streamWatchdog: ReturnType<typeof setInterval> | null = null
  private stuckStreamHandlers: Map<string, StreamCallbacks> = new Map()
  private ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private ttfbAbortControllers: Map<string, AbortController> = new Map()
  private pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Issue 3: Per-tab disconnect grace timers — if the event stream doesn't
   *  reconnect within DISCONNECT_GRACE_MS, the stream is force-finalized. */
  private disconnectGraceTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** B10-recovery: Hard, unconditional timeouts for the expired-question
   *  fallback startPrompt. Distinct from ttfbTimeouts because these fire
   *  regardless of activity-tracker state. */
  private expiredRecoveryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  /** Tabs currently in the process of finalizing — guards against double-finalize */
  private finalizingTabs = new Set<string>()
  /** Per-tab in-flight maybeFinalizeStream promise — collapses concurrent calls
   *  so multiple status/question-answered events for the same transition share
   *  one finalize attempt instead of producing duplicate "deferred"/"skipped" logs. */
  private finalizePromises = new Map<string, Promise<boolean>>()
  /** Per-tab last replayed stream message id — suppresses redundant live-stream
   *  replays when the webview is already showing the same stream (e.g. panel
   *  visibility toggles). Cleared when the stream ends or when the webview reloads. */
  private replayedMessageIds = new Map<string, string>()
  /** G5: pending status-triggered finalizes, deferred until a quiet period
   *  confirms the run really ended. Cleared by any activity (chunk/tool/etc)
   *  via cancelPendingStatusFinalize, and on cleanupTab. */
  private pendingStatusFinalizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Resolvers for the in-flight deferred status-finalize promises. Settling
   *  on cancel is MANDATORY: the deferred promise is held in finalizePromises,
   *  and an unsettled promise never runs its .finally cleanup — every future
   *  finalize trigger for the tab would chain onto the dead promise and the
   *  stream could never complete. */
  private pendingStatusFinalizeResolvers = new Map<string, (finalized: boolean) => void>()
  /**
   * Fix 1 — Activity-sequence guard: per-tab monotonically-increasing counter.
   * Bumped on every chunk / tool_start / permission / subagent event. The
   * status-triggered finalize records the sequence at the moment session.idle
   * arrives; the microtask re-checks whether the sequence has changed before
   * proceeding. If it has (i.e. a new activity arrived between idle and the
   * microtask), the finalize is cancelled without relying on a 1500ms timer
   * that can be raced by a tool arriving at 1501ms.
   *
   * Coexists with pendingStatusFinalizeTimers — the timer provides a fallback
   * for sessions where no further activity ever arrives (e.g. truly idle).
   */
  private activitySeqs = new Map<string, number>()
  /** Tabs whose stream was explicitly aborted — finalizeStream must not emit its own stream_end */
  private abortedTabs = new Set<string>()
  /**
   * Decides whether an expected `MessageAbortedError` (emitted by the server a beat
   * after we call `abortSession`) should be swallowed by the `server_error` handler
   * instead of surfacing a spurious "The request was cancelled." card (and tearing
   * down a replacement run started by interrupt-and-send). Correlates by server
   * message id (timing-independent) with a per-tab window fallback. Distinct from
   * the one-tick `abortedTabs` set, which only coordinates finalize/abort stream_end
   * de-duplication.
   */
  private readonly abortRegistry = new IntentionalAbortRegistry({ windowMs: this.ABORT_ERROR_SUPPRESS_MS })
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
  /** Per-tab last posted run-activity snapshot fingerprint — skips redundant
   *  posts when the slim snapshot hasn't changed, preventing the HostMessageBatcher's
   *  dedup guard from firing on every heartbeat/tool/subagent event. */
  private lastActivityFingerprint = new Map<string, string>()
  /** Per-tab chunk sequence counter — used for rendered-chunk ACK backpressure. */
  private postedChunkSeqs = new Map<string, number>()
  private deferredChunks = new Map<string, DeferredChunkEntry>()
  /** Per-tab token/cost totals at prompt start, used to dedupe final SDK usage fallback */
  private finalUsageBaselines = new Map<string, { total: number; cost: number }>()
  /** Per-tab async context estimate version; incremented by estimates and final actual usage. */
  private contextEstimateVersions = new Map<string, number>()
  private tabCloseDisposable: vscode.Disposable | null = null
  /** Core dependencies injected via StreamDeps */
  private readonly sessionManager: SessionManager
  private readonly sessionStore: SessionStore
  private readonly contextEngine: ContextEngine
  private readonly contextMonitor: ContextMonitor
  private readonly modelManager: ModelManager
  private readonly tabManager: TabManager
  private readonly rateLimitMonitor: RateLimitMonitor
  private readonly diffApplier: DiffApplier
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
  /** Per-tab stream latency metrics for performance instrumentation. */
  private activeRunMetrics = new Map<string, ActiveRunMetrics>()
  /** Optional delegate: called by SubagentHeartbeat when a new child session is discovered,
   *  so the host can drain the pending event buffer and replay events through the parent tab. */
  private childSessionReplayer: ((tabId: string, childSessionId: string) => void) | null = null
  /** ADR-010: per-tab session manager routing. In shared mode always returns this.sessionManager. */
  private sessionManagerRegistry: SessionManagerRegistry | null = null
  /** Streaming-lifecycle log sink. Mirrors opencode CLI's `--print-logs`
   *  discipline: every state transition (send → ttfb → probe → stream_end)
   *  is funneled here so users debugging a "stuck streaming" report see
   *  the same narrative the CLI would have printed. Constructed lazily; the
   *  first call replaces the no-op sink with one wired to the webview. */
  private streamingLog: StreamingLogSink = {
    log: () => { /* no-op until wireStreamingLog() is called */ },
  }

  constructor(deps: StreamDeps) {
    this.sessionManager = deps.sessionManager
    this.sessionStore = deps.sessionStore
    this.contextEngine = deps.contextEngine
    this.contextMonitor = deps.contextMonitor
    this.modelManager = deps.modelManager
    this.tabManager = deps.tabManager
    this.rateLimitMonitor = deps.rateLimitMonitor
    this.diffApplier = deps.diffApplier
    this.methodologyAdvisor = deps.methodologyAdvisor ?? new MethodologyAdvisor()
    this.attachmentStorage = deps.attachmentStorage ?? createAttachmentStorage()
    const capturedThis = this
    this.streamTimeoutManager = new StreamTimeoutManager({
      tabManager: this.tabManager,
      sessionManager: this.sessionManager,
      activityTracker: this.activityTracker,
      abortRegistry: this.abortRegistry,
      streamingLog: this.streamingLog,
      streamWatchdog: { get current() { return capturedThis.streamWatchdog }, set current(v) { capturedThis.streamWatchdog = v } },
      ttfbTimeouts: this.ttfbTimeouts,
      ttfbAbortControllers: this.ttfbAbortControllers,
      expiredRecoveryTimeouts: this.expiredRecoveryTimeouts,
      stuckStreamHandlers: this.stuckStreamHandlers,
      activeRuns: this.activeRuns,
      activeMessageIds: this.activeMessageIds,
      streamStates: this.streamStates,
      STREAM_STUCK_MS: this.STREAM_STUCK_MS,
      TTFB_TIMEOUT_MS_DEFAULT: this.TTFB_TIMEOUT_MS_DEFAULT,
      TTFB_TIMEOUT_FLOOR_MS: StreamCoordinator.TTFB_TIMEOUT_FLOOR_MS,
      TTFB_TIMEOUT_CEILING_MS: StreamCoordinator.TTFB_TIMEOUT_CEILING_MS,
      EXPIRED_RECOVERY_TIMEOUT_MS: this.EXPIRED_RECOVERY_TIMEOUT_MS,
      ttfbTimeoutMs: () => this.ttfbTimeoutMs,
      getSm: (tabId) => this.getSm(tabId),
      ensureStreamMessageId: (tabId, cliSessionId) => this.ensureStreamMessageId(tabId, cliSessionId),
      nextSeq: (tabId) => this.nextSeq(tabId),
      cleanupTab: (tabId) => this.cleanupTab(tabId),
      abort: (tabId, cbs) => this.abort(tabId, cbs),
      setStreamState: (tabId, state, ctx) => this.setStreamState(tabId, state, ctx),
      setActiveRunState: (tabId, state, ctx) => this.setActiveRunState(tabId, state, ctx),
      postRunActivitySnapshot: (tabId, snapshot, cbs) => this.postRunActivitySnapshot(tabId, snapshot, cbs),
    })
    // Resolve the TTFB timeout from workspace config (one injection point;
    // tests can override post-construction via `setTtfbTimeoutForTests`).
    this.ttfbTimeoutMs = this.resolveTtfbTimeoutMs()
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
    this.heartbeatService = new HeartbeatService({
      tabManager: this.tabManager,
      heartbeatSeqs: this.heartbeatSeqs,
      heartbeatAckedSeqs: this.heartbeatAckedSeqs,
      heartbeatAckedChunkSeqs: this.heartbeatAckedChunkSeqs,
      heartbeatTimers: this.heartbeatTimers,
      lastForceRerenderSeqs: this.lastForceRerenderSeqs,
      postedChunkSeqs: this.postedChunkSeqs,
      deferredChunks: this.deferredChunks,
      MAX_UNACKED_STREAM_CHUNKS: this.MAX_UNACKED_STREAM_CHUNKS,
      MAX_STREAM_DEFER_MS: this.MAX_STREAM_DEFER_MS,
    })
    this.toolPartialPoller = new ToolPartialPoller({
      tabManager: this.tabManager,
      toolPartialFallbackTimers: this.toolPartialFallbackTimers,
      toolPartialPollTimers: this.toolPartialPollTimers,
      toolPartialOffsets: this.toolPartialOffsets,
      toolPartialWarnedSessions: this.toolPartialWarnedSessions,
      TOOL_PARTIAL_FALLBACK_DELAY_MS: this.TOOL_PARTIAL_FALLBACK_DELAY_MS,
      TOOL_PARTIAL_POLL_INTERVAL_MS: this.TOOL_PARTIAL_POLL_INTERVAL_MS,
      getSm: (tabId) => this.getSm(tabId),
      isToolPending: (tabId, toolId) => this.activeToolCallIds.get(tabId)?.has(toolId) ?? false,
      appendToolPartial: (tabId, partial, cbs, source) => this.appendToolPartial(tabId, partial, cbs, source),
    })
    this.toolCallTracker = new ToolCallTracker({
      tabManager: this.tabManager,
      activityTracker: this.activityTracker,
      activeToolCallIds: this.activeToolCallIds,
      toolCallCounts: this.toolCallCounts,
      toolActivityAt: this.toolActivityAt,
      pendingToolGraceTimeouts: this.pendingToolGraceTimeouts,
      TOOL_FINALIZE_GRACE_MS: this.TOOL_FINALIZE_GRACE_MS,
      getSm: (tabId) => this.getSm(tabId),
      stopToolPartialPolling: (tabId, toolId) => this.stopToolPartialPolling(tabId, toolId),
      recordToolRunActivity: (tabId, activity, cbs) => this.recordToolRunActivity(tabId, activity, cbs),
      postRunActivitySnapshot: (tabId, snapshot, cbs) => this.postRunActivitySnapshot(tabId, snapshot, cbs),
      maybeFinalizeStream: (tabId, cbs, trigger) => this.maybeFinalizeStream(tabId, cbs, trigger),
    })
    this.tabCloseDisposable = this.tabManager.onTabClosed((tabId) => {
      this.cleanupTab(tabId)
    })
  }

  /** ADR-010: Set the session manager registry for per-tab process routing. */
  setSessionManagerRegistry(registry: SessionManagerRegistry): void {
    this.sessionManagerRegistry = registry
  }

  /** ADR-010: Resolve the session manager for a specific tab. Falls back to the default
   *  shared session manager when the registry is not configured or strategy is "shared". */
  private getSm(tabId?: string): SessionManager {
    if (!this.sessionManagerRegistry) return this.sessionManager
    return this.sessionManagerRegistry.getSessionManager(tabId)
  }

  private nextSeq(tabId: string): number {
    const seq = (this.msgSeqs.get(tabId) || 0) + 1
    this.msgSeqs.set(tabId, seq)
    return seq
  }

  // nextChunkSeq moved to HeartbeatService — postedChunkSeqs is owned by the service.

  /**
   * Fix 1: Bump the per-tab activity sequence counter.
   * Called from every activity path (chunk, tool, permission, subagent) so
   * the status-triggered finalize microtask can detect that new work arrived
   * between session.idle and the scheduled microtask, making the timer-based
   * quiet period race-free.
   */
  private bumpActivitySeq(tabId: string): void {
    this.activitySeqs.set(tabId, (this.activitySeqs.get(tabId) ?? 0) + 1)
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
    this.streamTimeoutManager.startWatchdog()
  }

  private stopWatchdog(): void {
    this.streamTimeoutManager.stopWatchdog()
  }

  /** Stop the watchdog if no tabs are currently streaming (prevents unnecessary polling) */
  private stopWatchdogIfNoStreams(): void {
    this.streamTimeoutManager.stopWatchdogIfNoStreams()
  }

  private clearTtfbTimeout(tabId: string): void {
    this.streamTimeoutManager.clearTtfbTimeout(tabId)
  }

  private clearTtfbTimeoutIfPending(tabId: string): boolean {
    return this.streamTimeoutManager.clearTtfbTimeoutIfPending(tabId)
  }

  private postRunActivitySnapshot(tabId: string, snapshot: AgentRunState | undefined, callbacks?: StreamCallbacks): void {
    if (!snapshot) return
    const cbs = callbacks || this.stuckStreamHandlers.get(tabId)
    if (!cbs) return
    // Strip large fields the webview never reads: tool.input, tool.result
    // (full bash/file output, can be 500KB+), and subagent.inputPrompt
    // (full subagent prompt text). Without this, the payload exceeds the
    // HostMessageBatcher's 256KB maxPayloadBytes and is silently dropped,
    // so the webview never sees any run activity updates at all.
    const slim = {
      ...snapshot,
      tools: snapshot.tools.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        startedAt: t.startedAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
        error: t.error,
      })),
      subagents: snapshot.subagents.map((s) => ({
        id: s.id,
        agentName: s.agentName,
        status: s.status,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        completedAt: s.completedAt,
        currentActivity: s.currentActivity,
        childSessionId: s.childSessionId,
        toolCount: s.toolCount,
        unreadActivityCount: s.unreadActivityCount,
        error: s.error,
      })),
    }
    // Dirty-check: skip posting if the slim snapshot content hasn't changed.
    // Uses an incremental field-level fingerprint (id:status:updatedAt per entry)
    // instead of JSON.stringify(slim) to avoid O(n) serialization cost on the hot
    // heartbeat/tool/subagent path — JSON.stringify on a 20-tool snapshot costs
    // ~50µs per call and triggers GC on every tick.
    const fingerprint = [
      slim.runId ?? "",
      slim.tools.map(t => `${t.id}:${t.status}:${t.updatedAt ?? 0}`).join("|"),
      slim.subagents.map(s => `${s.id}:${s.status}:${s.updatedAt ?? 0}`).join("|"),
    ].join("§")
    if (fingerprint === this.lastActivityFingerprint.get(tabId)) return
    this.lastActivityFingerprint.set(tabId, fingerprint)
    cbs.postMessage({
      type: "run_activity_update",
      sessionId: tabId,
      activity: slim,
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
   *
   * B10: The tool_start event assigns id=prt_*, but the question.asked event
   * assigns toolCallId=call_* and requestID=que_*. These are DIFFERENT IDs
   * for the same question. This method resolves the mismatch by falling back
   * to requestID matching and single-unanswered-question heuristic.
   *
   * B10: Also triggers maybeFinalizeStream after clearing, because clearing
   * activeToolCallIds without re-checking finalization leaves the stream
   * deferred forever.
   */
  markQuestionAnswered(tabId: string, toolCallId: string): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return

    // Try exact match first (b.id or b.toolCallId === toolCallId)
    let qBlock = tab.blocksBuffer.find(
      b => b.type === "question" && (b.id === toolCallId || (b as Record<string, unknown>).toolCallId === toolCallId)
    )

    // Fallback 1: match by requestID (question.asked carries requestID=que_*)
    if (!qBlock) {
      qBlock = tab.blocksBuffer.find(
        b => b.type === "question" && (b as Record<string, unknown>).requestID === toolCallId
      )
    }

    // Fallback 2: if there's exactly one unanswered question, it must be this one
    // (handles the prt_* vs call_* ID mismatch from tool_start vs question.asked)
    if (!qBlock) {
      const unanswered = tab.blocksBuffer.filter(
        b => b.type === "question" && !(b as Record<string, unknown>).answered
      )
      if (unanswered.length === 1) {
        qBlock = unanswered[0]
        log.info(`markQuestionAnswered: ID mismatch fallback — matched unanswered question ${(qBlock as Record<string, unknown>).id} for input ${toolCallId}`)
      }
    }

    // Resolve the actual ID stored in activeToolCallIds
    let resolvedId = toolCallId
    if (qBlock) {
      ;(qBlock as Record<string, unknown>).answered = true
      const blockId = (qBlock as Record<string, unknown>).id as string
      const blockToolCallId = (qBlock as Record<string, unknown>).toolCallId as string
      resolvedId = blockId || blockToolCallId || toolCallId
      log.info(`markQuestionAnswered: marked question ${resolvedId} as answered in blocksBuffer for ${tabId}`)
    }

    const pending = this.activeToolCallIds.get(tabId)
    if (pending) {
      // Try the original toolCallId first, then the resolved ID
      if (pending.has(toolCallId)) {
        pending.delete(toolCallId)
        log.info(`markQuestionAnswered: removed ${toolCallId} from activeToolCallIds for ${tabId}`)
      } else if (resolvedId !== toolCallId && pending.has(resolvedId)) {
        pending.delete(resolvedId)
        log.info(`markQuestionAnswered: removed ${resolvedId} from activeToolCallIds for ${tabId} (ID resolution fallback)`)
      } else {
        // Last resort: clear any question-type tool IDs whose blocks are now answered
        for (const id of Array.from(pending)) {
          const block = tab.blocksBuffer.find(
            b => (b.id === id || (b as Record<string, unknown>).toolCallId === id) && b.type === "question"
          )
          if (block && (block as Record<string, unknown>).answered === true) {
            pending.delete(id)
            log.info(`markQuestionAnswered: removed answered question ${id} from activeToolCallIds for ${tabId} (block scan)`)
          }
        }
      }
      if (pending.size === 0) {
        this.activeToolCallIds.delete(tabId)
      }
    }

    // B10: Trigger finalization — clearing the question state without
    // re-checking finalization leaves the stream deferred forever.
    const callbacks = this.stuckStreamHandlers.get(tabId)
    if (callbacks && tab.waitingForCompletion) {
      log.info(`markQuestionAnswered: triggering maybeFinalizeStream for ${tabId}`)
      void this.maybeFinalizeStream(tabId, callbacks, "status").catch(err =>
        log.error("markQuestionAnswered: finalize failed", err)
      )
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

    // B10: Same ID resolution as markQuestionAnswered — tool_start uses prt_*,
    // question.asked uses call_*, and the caller may pass either.
    let qBlock = tab.blocksBuffer.find(
      b => b.type === "question" && (b.id === toolCallId || (b as Record<string, unknown>).toolCallId === toolCallId)
    )
    if (!qBlock) {
      qBlock = tab.blocksBuffer.find(
        b => b.type === "question" && (b as Record<string, unknown>).requestID === toolCallId
      )
    }
    if (!qBlock) {
      const answered = tab.blocksBuffer.filter(
        b => b.type === "question" && (b as Record<string, unknown>).answered === true
      )
      if (answered.length === 1) {
        qBlock = answered[0]
      }
    }

    let resolvedId = toolCallId
    if (qBlock) {
      const rec = qBlock as Record<string, unknown>
      delete rec.answered
      delete rec.answer
      delete rec.answerSource
      resolvedId = (rec.id as string) || (rec.toolCallId as string) || toolCallId
      log.info(`unmarkQuestionAnswered: reverted question ${resolvedId} to pending in blocksBuffer for ${tabId}`)
    }

    const pending = this.getOrCreatePendingToolIds(tabId)
    const idToAdd = resolvedId || toolCallId
    if (!pending.has(idToAdd)) {
      pending.add(idToAdd)
      this.trackToolActivity(tabId, idToAdd)
      log.info(`unmarkQuestionAnswered: re-added ${idToAdd} to activeToolCallIds for ${tabId}`)
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
    this.toolCallTracker.clearPendingToolGraceTimeout(tabId)
  }

  private getOrCreatePendingToolIds(tabId: string): Set<string> {
    return this.toolCallTracker.getOrCreatePendingToolIds(tabId)
  }

  private getLastPendingToolId(tabId: string): string | undefined {
    return this.toolCallTracker.getLastPendingToolId(tabId)
  }

  private trackToolActivity(tabId: string, toolId: string): void {
    this.toolCallTracker.trackToolActivity(tabId, toolId)
  }

  private toolPartialKey(tabId: string, toolId: string): string {
    return this.toolPartialPoller.toolPartialKey(tabId, toolId)
  }

  private isToolPartialPollable(toolCall: { name?: string; class?: string; args?: unknown }): boolean {
    // Delegated to ToolPartialPoller — kept as a private method for structural test compatibility.
    const name = (toolCall.name || "").toLowerCase()
    const cls = (toolCall.class || this.toolClass(toolCall.name || "")).toLowerCase()
    if (cls === "exec") return true
    if (/(bash|shell|command|terminal|zsh|sh|exec)/i.test(name)) return true
    const args = toolCall.args && typeof toolCall.args === "object" ? toolCall.args as Record<string, unknown> : undefined
    return typeof args?.command === "string" || typeof args?.cmd === "string"
  }

  private stopToolPartialPolling(tabId: string, toolId: string): void {
    this.toolPartialPoller.stopToolPartialPolling(tabId, toolId)
  }

  private stopAllToolPartialPolling(tabId: string): void {
    this.toolPartialPoller.stopAllToolPartialPolling(tabId)
  }

  private armToolPartialPolling(
    tabId: string,
    toolId: string,
    toolCall: { name?: string; class?: string; args?: unknown },
    callbacks: StreamCallbacks,
  ): void {
    this.toolPartialPoller.armToolPartialPolling(tabId, toolId, toolCall, callbacks)
  }

  private warnNoLiveOutputOnce(tabId: string): void {
    // Delegated to ToolPartialPoller — inline kept for structural test compatibility.
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
    await this.toolPartialPoller.pollToolPartialOutput(tabId, toolId, callbacks)
  }

  private postToolEnd(tabId: string, result: ToolEndResult, callbacks: StreamCallbacks): boolean {
    return this.toolCallTracker.postToolEnd(tabId, result, callbacks)
  }

  private resetPendingToolGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    this.toolCallTracker.resetPendingToolGraceTimeout(tabId, callbacks)
  }

  private async reconcilePendingToolCallsFromServer(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.toolCallTracker.reconcilePendingToolCallsFromServer(tabId, callbacks)
  }

  private stableToolPartId(part: Record<string, unknown>, messageId?: string): string | undefined {
    return this.toolCallTracker.stableToolPartId(part, messageId)
  }

  private async markUnresolvedPendingToolCalls(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.toolCallTracker.markUnresolvedPendingToolCalls(tabId, callbacks)
  }

  private markUnresolvedActiveSubagents(tabId: string, callbacks: StreamCallbacks): void {
    this.toolCallTracker.markUnresolvedActiveSubagents(tabId, callbacks)
  }

  async startPrompt(config: StartPromptConfig): Promise<void> {
    const { tabId, text, callbacks, variant, attachments = [], identity = {} } = config
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

    // ADR-010: In per-tab mode, auto-spawn a dedicated process for this tab
    // if it doesn't already have one. The spawned SessionManager is registered
    // in the registry so getSm(tabId) routes subsequent calls to it.
    if (this.sessionManagerRegistry?.processStrategy === "per-tab") {
      const existing = this.sessionManagerRegistry.getProcessForTab(tabId)
      if (!existing) {
        log.info(`[per-tab] Auto-spawning process for tab ${tabId}`)
        try {
          await this.sessionManagerRegistry.spawnAndRegisterSession(undefined, tabId)
        } catch (err) {
          log.error(`[per-tab] Failed to spawn process for tab ${tabId}`, err)
          callbacks.postRequestError("Failed to start per-tab AI session. Falling back to shared server.")
        }
      }
    }

    this.initializeRunMetadata(tabId, tab, text, identity)

    try {
      this.refreshContextTokenEstimate(tabId)

      const localTitle = this.sessionStore.get(tabId)?.name?.trim()
      // B10: Skip ensureSession HTTP roundtrip when tab already has a real
      // server session ID (not a local placeholder). The session ID is stable
      // and re-verifying on every prompt adds unnecessary latency.
      const existingCliId = tab.cliSessionId
      let cliSessionId: string
      if (existingCliId && !isLocalPlaceholderSessionId(existingCliId)) {
        cliSessionId = existingCliId
      } else {
        cliSessionId = await this.getSm(tabId).ensureSession(existingCliId, localTitle || undefined)
        this.tabManager.setCliSessionId(tabId, cliSessionId)
        this.sessionStore.updateCliSessionId(tabId, cliSessionId)
      }
      // B10-recovery: clear stale state so the recovery gets a fresh bubble.
      if (callbacks.recoveryFromExpiredQuestion) {
        log.info(`startPrompt recovery mode for tab ${tabId}: fresh stream state`)
        this.activeMessageIds.delete(tabId)
        this.activeRuns.delete(tabId)
        this.activeRunMetrics.delete(tabId)
      }
      const streamMessageId = this.resolveStreamMessageAndStartActivity(tabId, tab, cliSessionId, callbacks)
      const eventStreamReady = await this.getSm(tabId).waitForEventStreamReady(5_000)
      if (!eventStreamReady) {
        const status = this.getSm(tabId).eventStreamStatus
        if (status.state === "failed" || !this.getSm(tabId).isRunning) {
          throw new Error(`OpenCode event stream is ${status.state}; cannot send a prompt until extension communication is connected.`)
        }
        // Still reconnecting — proceed optimistically. The server processes prompts
        // independently of the event stream. The TTFB timeout detects if events never arrive.
        log.warn(`Event stream not ready (${status.state}) after 5s — proceeding; TTFB timeout active (${this.TTFB_TIMEOUT_MS}ms)`)
      }

      this.emitStreamStartAndArmWatchdogs(tabId, callbacks, streamMessageId)

      const { modelRef, agent } = await this.resolveModelAndAgentForPrompt(tabId, tab)

      // Inject per-tab instructions as a prepended text part on the first turn
      // only. injectedInstructionsSessions tracks which CLI sessions have
      // already received the tab's instructions to prevent re-injection on
      // follow-up turns. Must be prepended before methodology advice + user text.
      const instructionParts: Array<{ type: "text"; text: string }> = []
      if (tab.instructions && !this.injectedInstructionsSessions.has(cliSessionId)) {
        instructionParts.push({ type: "text", text: tab.instructions })
        this.injectedInstructionsSessions.add(cliSessionId)
      }

      const parts = [
        ...instructionParts,
        ...this.buildTextParts(tabId, tab, cliSessionId, text, callbacks, attachments),
      ]

      // Materialize each attachment to a temp file and send a `file://` URL
      // to the server. The opencode server (v1.15.x) auto-reads the OS
      // clipboard for FilePartInput URLs, which fails on Linux without
      // wl-clipboard/xclip; pointing the server at a real file on disk
      // skips that path entirely. `data:` URLs are also documented to fail
      // with some MCP/non-vision models (opencode issues #14673, #18437,
      // #10154, #29880).
      //
      // Images are ALSO materialized to disk — same rationale as above.
      // The webview chip preview uses an independent `data:` URL stored in
      // the attachment manager's local state, so the server payload can use
      // `file://` regardless of the sandbox restriction.
      const materialized: MaterializedAttachment[] = []
      for (const attachment of attachments) {
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
      // B10-recovery instrumentation: log every piece of state just before
      // sendPromptAsync so we can pinpoint where the recovery stalls. The
      // "Sending async prompt" log inside SessionClient is the next thing
      // we expect to see; if it doesn't appear, the gap between these logs
      // and SessionClient is where the silent failure lives.
      if (callbacks.recoveryFromExpiredQuestion) {
        log.info(
          `startPrompt recovery pre-send: tabId=${tabId} cliSessionId=${cliSessionId} parts=${parts.length} ` +
            `modelRef=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"} agent=${agent} ` +
            `eventStream=${this.getSm(tabId).eventStreamStatus.state} isRunning=${this.getSm(tabId).isRunning} ` +
            `activeMessageId=${this.activeMessageIds.get(tabId) ?? "none"}`,
        )
      }
      await this.getSm(tabId).sendPromptAsync(cliSessionId, parts, {
        model: modelRef,
        agent,
        variant,
        messageID: identity.userMessageId,
        clientRequestId: identity.clientRequestId,
        signal: abortSignal,
      })
      if (callbacks.recoveryFromExpiredQuestion) {
        log.info(`startPrompt recovery sendPromptAsync returned without throwing for tab ${tabId}`)
      }
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
    // If the tab was intentionally aborted (e.g. by the expired-question
    // recovery watchdog), suppress the error — the abort owns cleanup and
    // the user will be guided to retry via the recovery-failed message.
    if (this.abortedTabs.has(tabId)) {
      log.info(`handlePromptSendFailure suppressed for ${tabId} — tab was intentionally aborted`)
      return
    }
    const message = e instanceof Error ? e.message : "Unknown error"
    log.error("Prompt failed", e)
    this.setActiveRunState(tabId, "failed", { finalizeReason: "send_failed", error: message })
    vscode.window.showErrorMessage(`OpenCode: Request failed — ${message}. Check the output channel for details.`)
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
    // Per-tab instruction injection is handled by the caller (startPrompt) so
    // it is prepended before methodology advice and tracked against re-injection.
    const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []

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
    
    // Stream boundary trigger: refresh context usage immediately at stream start
    const tab = this.tabManager.getTab(tabId)
    if (tab) {
      this.contextMonitor.emitImmediate({
        percent: this.contextMonitor.percent,
        tokens: this.contextMonitor.tokensUsed,
        maxTokens: this.contextMonitor.limit,
        sessionId: tabId,
        source: "estimated",
        updatedAt: Date.now(),
      })
    }
    callbacks.clearPromptsInFlight?.()

    this.tabManager.setWaitingForCompletion(tabId, true)
    this.tabManager.clearBuffer(tabId)
    this.startWatchdog()

    this.setupTtfbTimeout(tabId, callbacks)

    // B10-recovery: Arm the hard unconditional watchdog for expired-question
    // fallbacks. This fires regardless of stray activity events; the regular
    // TTFB watchdog above is gated by shouldTriggerStartupTimeout, which can
    // be silently disabled when firstActivityAt is flipped by a late/stale
    // tool_start, leaving the user stuck "generating" indefinitely.
    if (callbacks.recoveryFromExpiredQuestion) {
      this.setupExpiredRecoveryTimeout(tabId, callbacks)
    }
  }

  /**
   * B10-recovery: Hard, unconditional watchdog for the expired-question
   * fallback startPrompt. Fires after EXPIRED_RECOVERY_TIMEOUT_MS regardless
   * of activity. On fire: aborts the run, posts stream_end + a
   * `expired_question_recovery_failed` message containing the original
   * answer text so the webview can pre-fill the prompt input for manual
   * resend, then cleanupTab. This guarantees the user is never stuck
   * "generating" with no recovery path. */
  private setupExpiredRecoveryTimeout(tabId: string, callbacks: StreamCallbacks): void {
    this.streamTimeoutManager.setupExpiredRecoveryTimeout(tabId, callbacks)
  }

  private clearExpiredRecoveryTimeout(tabId: string): void {
    this.streamTimeoutManager.clearExpiredRecoveryTimeout(tabId)
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
    this.activeRunMetrics.set(tabId, { sendTime: performance.now(), messageCount: 0 })
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
        vscode.window.showErrorMessage(`OpenCode: Could not start the server — ${msg}. Try restarting VS Code.`)
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
    this.streamTimeoutManager.setupTtfbTimeout(tabId, callbacks)
  }

  /**
   * Resolve the TTFB timeout from workspace configuration.
   *
   * Reads `opencode.streaming.ttfbTimeoutMs` (number; ms). Returns the
   * configured value clamped to `[TTFB_TIMEOUT_FLOOR_MS, TTFB_TIMEOUT_CEILING_MS]`.
   * Missing/non-numeric/out-of-range values fall back to the default. The
   * read is lazy so changes via `WorkspaceConfiguration.update` take effect
   * on the next stream — no extension reload required.
   *
   * Exposed as a method (not a property) so tests can override via
   * `setTtfbTimeoutForTests` and so future per-provider overrides can
   * thread model/provider context through here without touching call sites.
   */
  private resolveTtfbTimeoutMs(): number {
    return this.streamTimeoutManager.resolveTtfbTimeoutMs()
  }

  /** Test-only override of the resolved TTFB. Production code should never
   *  call this; it exists so unit tests can pin the value without spinning
   *  up a VS Code workspace configuration. */
  setTtfbTimeoutForTests(ms: number): void {
    this.ttfbTimeoutMs = ms
  }

  /** Wire the streaming-lifecycle log sink to the webview + OutputChannel.
   *  Called once by ChatProvider once the webview is ready. Before this is
   *  called, the sink is a no-op so unit tests don't need to provide a
   *  postMessage stub. */
  wireStreamingLog(postMessage: (msg: Record<string, unknown>) => void): void {
    this.streamingLog = createStreamingLog({ postMessage, channel: log })
  }

  /** Number of probe retries before we give up and fall through to the
   *  pre-existing abort+stream_end path. Research (WHATWG SSE §9.2.3 + the
   *  harness's own SSE-reconnect bug history) shows a single probe failure
   *  is a common transient blip — never an authoritative signal that the
   *  run is dead. 3 retries with 1s/2s/4s backoff gives ~7s of slack for
   *  a transient network drop without locking the UI for too long. */
  static readonly PROBE_MAX_ATTEMPTS = 3
  static readonly PROBE_BACKOFF_BASE_MS = 1_000

  /**
   * Probe the server for the active run's liveness, retrying transient
   * failures with exponential backoff. Only after {@link PROBE_MAX_ATTEMPTS}
   * consecutive failures do we re-throw to the caller — at which point the
   * caller falls back to its existing dead-run path.
   *
   * This replaces the old pattern of `.catch(err => log.warn(...))` which
   * silently swallowed probe errors AND the "single probe then stream_end"
   * branch which unilaterally finalized the run when a single probe blipped
   * — the exact cause of "Send reverted while still generating" on flaky
   * networks.
   */
  private async probeActiveRunWithRetry(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    await this.streamTimeoutManager.probeActiveRunWithRetry(tabId, callbacks)
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
        () => reject(new Error(`getMessages(limit) timed out after ${FINAL_FETCH_TIMEOUT_MS}ms`)),
        FINAL_FETCH_TIMEOUT_MS
      )
    })

    try {
      // Fix 5: fetch only the last few messages (limit=5 to cover assistant + any
      // immediately preceding tool messages) instead of the full session history.
      // This is O(1) network I/O regardless of session length, eliminating the
      // blocking full-history fetch that caused visible lag at stream completion.
      const messages = await Promise.race([
        this.getSm(tabId).getMessages(cliSessionId, 5),
        timeoutPromise,
      ])
      // The server returns NEWEST-first with `limit` but OLDEST-first without —
      // pickLatestAssistant selects by time.created/id, independent of order.
      // (Position-based reverse().find() picked the previous turn's message.)
      const lastAssistant = pickLatestAssistant(messages)
      if (lastAssistant) {
        blocks = this.partsToBlocks(lastAssistant.parts)
        const info = lastAssistant.info as { role?: string; cost?: number; tokens?: { total?: number; input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } }
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
    const metrics = this.activeRunMetrics.get(tabId)
    if (metrics) metrics.completeTime = performance.now()
    this.setActiveRunState(tabId, "finalizing", { finalizeReason: "normal" })
    await this.finalizerService.finalizeStream(tabId, callbacks)
    this.replayedMessageIds.delete(tabId)
    if (metrics) {
      metrics.finalizeTime = performance.now()
      const firstMs = metrics.firstResponseTime != null ? (metrics.firstResponseTime - metrics.sendTime).toFixed(0) : "n/a"
      const totalMs = metrics.completeTime != null ? (metrics.completeTime - metrics.sendTime).toFixed(0) : "n/a"
      const finalizeMs = metrics.completeTime != null ? (metrics.finalizeTime - metrics.completeTime).toFixed(0) : "n/a"
      log.info(`stream latency: first_chunk=${firstMs}ms, total=${totalMs}ms, finalize=${finalizeMs}ms, messages=${metrics.messageCount}`)
      logStreamTrace("stream.latency", {
        tabId,
        firstChunkMs: firstMs,
        totalMs,
        finalizeMs,
        messageCount: metrics.messageCount,
      })
    }
    const snapshot = this.activityTracker.markRunComplete(tabId)
    this.postRunActivitySnapshot(tabId, snapshot, callbacks)
    this.activityTracker.clear(tabId)
    this.setActiveRunState(tabId, "completed", { finalizeReason: "normal" })
    this.activeRuns.delete(tabId)
    this.activeRunMetrics.delete(tabId)

    // Stream boundary trigger: refresh context usage immediately at stream end
    this.contextMonitor.emitImmediate({
      percent: this.contextMonitor.percent,
      tokens: this.contextMonitor.tokensUsed,
      maxTokens: this.contextMonitor.limit,
      sessionId: tabId,
      source: "estimated",
      updatedAt: Date.now(),
    })

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
    const existing = this.finalizePromises.get(tabId)
    if (existing) {
      // Fix 3: Don't swallow the second trigger by returning the same in-flight promise.
      // If the first attempt deferred (returned false), the second trigger may represent
      // state that resolves the defer (e.g. markQuestionAnswered unblocked the stream).
      // Chain a re-check after the current attempt settles so the unblock isn't lost.
      return existing.then(finalized => {
        if (finalized) return true // first attempt already finalized — done
        return this.runMaybeFinalizeStream(tabId, callbacks, trigger)
      })
    }

    const promise = this.runMaybeFinalizeStream(tabId, callbacks, trigger)
      .finally(() => this.finalizePromises.delete(tabId))
    this.finalizePromises.set(tabId, promise)
    return promise
  }

  private async runMaybeFinalizeStream(tabId: string, callbacks: StreamCallbacks, trigger: "message_complete" | "status"): Promise<boolean> {
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

    // G5 + Fix 1: status-triggered finalizes (from session.idle / server_status
    // non-busy) must guard against transient idles emitted between tool calls,
    // during provider retries, or right before the next message part arrives.
    //
    // Two-layer guard:
    //   Layer A (sequence): Record the activity sequence at idle-receipt time.
    //   A microtask checks if any new activity bumped the sequence before
    //   committing to finalization. This is race-free within a JS event loop
    //   turn — activity arriving before the microtask is visible.
    //   Layer B (timer fallback): The existing 1500ms timer continues to serve
    //   as the "no-further-activity" backstop for sessions where nothing else
    //   arrives after the idle — guaranteeing eventual finalization.
    if (trigger === "status") {
      const existing = this.pendingStatusFinalizeTimers.get(tabId)
      if (existing) {
        // Already pending — let the existing timer handle it; treat as deferred.
        return false
      }

      // Layer A: activity-sequence microtask check
      const seqAtIdle = this.activitySeqs.get(tabId) ?? 0
      const sequenceResult = await new Promise<"proceed" | "cancel">((resolve) => {
        queueMicrotask(() => {
          const seqNow = this.activitySeqs.get(tabId) ?? 0
          if (seqNow !== seqAtIdle) {
            log.info(`maybeFinalizeStream: activity-sequence guard cancelled status finalize for ${tabId} (seq ${seqAtIdle} → ${seqNow})`)
            resolve("cancel")
          } else {
            resolve("proceed")
          }
        })
      })
      if (sequenceResult === "cancel") return false

      // Layer B: timer fallback for the quiet-period guard
      const lastActivity = this.activityTracker.getSnapshot(tabId)?.lastActivityAt ?? Date.now()
      const elapsed = Date.now() - lastActivity
      if (elapsed < this.STATUS_FINALIZE_QUIET_MS) {
        const armFor = this.STATUS_FINALIZE_QUIET_MS - elapsed
        log.info(`maybeFinalizeStream: deferring status finalize for ${tabId} by ${armFor}ms (last activity ${elapsed}ms ago, seq=${seqAtIdle})`)
        return new Promise<boolean>((resolve) => {
          // The settle function is registered so cancelPendingStatusFinalize can
          // resolve this promise when activity cancels the timer. Leaving it
          // unsettled would keep the entry in finalizePromises alive forever
          // (its .finally never runs), blocking every future finalize.
          const settle = (finalized: boolean) => {
            this.pendingStatusFinalizeResolvers.delete(tabId)
            resolve(finalized)
          }
          this.pendingStatusFinalizeResolvers.set(tabId, settle)
          const timer = setTimeout(() => {
            this.pendingStatusFinalizeTimers.delete(tabId)
            // Re-enter the pipeline; if new activity arrived during the wait,
            // cancelPendingStatusFinalize already deleted this timer and we
            // never get here. If we do get here, the quiet period held.
            //
            // DEADLOCK GUARD: this must call runMaybeFinalizeStream (internal),
            // NOT the public maybeFinalizeStream. The public wrapper would find
            // THIS call's own still-pending promise in finalizePromises and
            // chain onto it — a circular wait where the outer promise waits on
            // this timer and this timer waits on the outer promise. The stream
            // then never finalizes and every later trigger chains onto the dead
            // promise ("deferring status finalize …" then silence forever).
            this.runMaybeFinalizeStream(tabId, callbacks, "status")
              .then(settle)
              .catch((err) => {
                log.error(`Deferred status finalize failed for ${tabId}`, err)
                settle(false)
              })
          }, armFor)
          this.pendingStatusFinalizeTimers.set(tabId, timer)
        })
      }
    }

    // Log here (not in the caller) so duplicate status events for the same
    // transition don't produce duplicate log lines — the pendingStatusFinalizeTimers
    // guard above ensures only one call reaches this point.
    if (trigger === "status") {
      log.info(`maybeFinalizeStream: proceeding with status-triggered finalization for ${tabId}`)
    }

    await this.finalizeStream(tabId, callbacks)
    return true
  }

  /** G5 + Fix 1: cancel any pending status-triggered finalize and bump the
   *  activity sequence so the sequence-guard microtask sees the change.
   *  Called from every activity path (chunk, tool, permission, subagent). */
  private cancelPendingStatusFinalize(tabId: string): void {
    this.bumpActivitySeq(tabId)
    const timer = this.pendingStatusFinalizeTimers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.pendingStatusFinalizeTimers.delete(tabId)
    }
    // Settle the deferred promise (as "not finalized") so its .finally clears
    // the finalizePromises entry — a cancelled-but-unsettled defer would block
    // every future finalize for this tab.
    const settle = this.pendingStatusFinalizeResolvers.get(tabId)
    if (settle) settle(false)
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
   * True when the late server `MessageAbortedError` for an intentionally aborted run
   * should be suppressed. Prefers correlation by the server `serverMessageId` (carried
   * on the `server_error` event) so suppression is timing-independent; falls back to a
   * self-expiring per-tab window when the error carries no correlatable id.
   */
  wasIntentionallyAborted(tabId: string, serverMessageId?: string): boolean {
    return this.abortRegistry.wasIntentional(tabId, serverMessageId, Date.now())
  }

  /**
   * Build partial assistant blocks from the tab's live buffers at abort time.
   * Mirrors mergeFinalBlocks logic but without server blocks.
   */
  private buildAbortBlocks(tabId: string): Block[] {
    const tab = this.tabManager.getTab(tabId)
    if (!tab) return []
    const blocks: Block[] = []

    if (tab.blocksBuffer && tab.blocksBuffer.length > 0) {
      blocks.push(...tab.blocksBuffer)
    } else if (tab.streamingBuffer) {
      const cleanedText = this.stripContextWrapper(tab.streamingBuffer)
      if (cleanedText.trim()) {
        blocks.push({ type: "text", text: cleanedText })
      }
    }

    // Append interruption marker if there was any partial content
    if (blocks.length > 0) {
      blocks.push({ type: "text", text: "\n\n*[Response interrupted by user]*" })
    }

    return blocks
  }

  async abort(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.cliSessionId || !this.getSm(tabId).isRunning) return
    this.stopAllToolPartialPolling(tabId)

    // Mark first so any in-flight finalizeStream that resumes after our await
    // sees the flag and skips emitting its own stream_end.
    this.abortedTabs.add(tabId)
    // Register the intentional abort so the late server MessageAbortedError is
    // swallowed rather than shown as a "The request was cancelled." error card.
    // Correlate by the run's server message id when known (timing-independent);
    // the registry also opens a per-tab window fallback for id-less late errors.
    this.abortRegistry.recordAbort(tabId, this.activeRuns.get(tabId)?.serverMessageId, Date.now())
    this.setActiveRunState(tabId, "aborted", { finalizeReason: "user_abort" })

    try {
      const streamMessageId = this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)
      await this.getSm(tabId).abortSession(tab.cliSessionId)

      // Capture partial assistant content from live buffers and persist it
      // before posting stream_end. This ensures the partial text/tool blocks
      // survive in SessionStore (and are rendered by the webview) instead of
      // being dropped as they were before.
      const abortBlocks = this.buildAbortBlocks(tabId)
      if (abortBlocks.length > 0) {
        this.storeAssistantMessage(tabId, streamMessageId, abortBlocks, undefined)
      }

      const snapshot = this.activityTracker.markRunCancelled(tabId, "User cancelled the run")
      this.postRunActivitySnapshot(tabId, snapshot, callbacks)
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: streamMessageId,
        blocks: abortBlocks,
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
    this.heartbeatService.startHeartbeat(tabId, callbacks)
  }

  private stopHeartbeat(tabId: string): void {
    this.heartbeatService.stopHeartbeat(tabId)
  }

  handleStreamAck(tabId: string, seq: number, lastRenderedChunkSeq?: number): void {
    this.heartbeatService.handleStreamAck(tabId, seq, lastRenderedChunkSeq)
  }

  private postOrDeferChunk(tabId: string, text: string, callbacks: StreamCallbacks, messageId?: string): void {
    this.heartbeatService.postOrDeferChunk(tabId, text, callbacks, messageId)
  }

  private drainDeferredChunk(tabId: string, force = false): void {
    this.heartbeatService.drainDeferredChunk(tabId, force)
  }

  private clearDeferredChunk(tabId: string): void {
    this.heartbeatService.clearDeferredChunk(tabId)
  }

  replayLiveStreamToWebview(tabId: string, callbacks: StreamCallbacks): void {
    const tab = this.tabManager.getTab(tabId)
    if (!tab || !tab.isStreaming) return

    const messageId = this.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)
    if (this.replayedMessageIds.get(tabId) === messageId) {
      log.info(`replayLiveStreamToWebview: skipping duplicate replay for ${tabId} (msgId=${messageId})`)
      return
    }
    this.replayedMessageIds.set(tabId, messageId)

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

  clearReplayDedup(): void {
    this.replayedMessageIds.clear()
  }

  async reconcileAfterReconnect(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(tabId)
    if (!tab?.cliSessionId) return

    this.cancelDisconnectGraceTimeout(tabId)
    this.setStreamState(tabId, "streaming", { sessionId: tab.cliSessionId, reason: "reconnecting" })

    try {
      await this.reconcilePendingToolCallsFromServer(tabId, callbacks)

      // limit=5 keeps this O(1) for long sessions; pickLatestAssistant is
      // order-independent (the server's limit path returns newest-first).
      const messages = await this.getSm(tabId).getMessages(tab.cliSessionId, 5)
      const lastAssistant = pickLatestAssistant(messages)
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
        // Reconnect may have lost SSE events; force the replay so the webview
        // catches up even if the same messageId was already replayed.
        this.replayedMessageIds.delete(tabId)
        this.replayLiveStreamToWebview(tabId, callbacks)

        // Gap G6: if the run already completed during the outage, the server
        // saw the terminal events but we never did (they were lost on the
        // dead SSE). Detect via time.completed on the last assistant and
        // emit the dropped stream_end so the webview can clear its streaming
        // affordances instead of waiting up to 45min for the watchdog.
        const completedAt = (lastAssistant.info as { time?: { completed?: number } }).time?.completed
        if (typeof completedAt === "number" && completedAt > 0) {
          log.info(`reconcileAfterReconnect: tab ${tabId} last assistant completed at ${completedAt} — emitting dropped stream_end`)
          // Mark the run as already-finished: skip the normal finalize path
          // (which would re-fetch), and emit a terminal stream_end directly.
          this.abortedTabs.add(tabId) // reuse the dedup gate so finalizeStream is a no-op
          this.activeRuns.delete(tabId)
          this.tabManager.setStreaming(tabId, false, { source: "reconnect", cliSessionId: tab.cliSessionId })
          this.tabManager.setWaitingForCompletion(tabId, false)
          this.clearTtfbTimeout(tabId)
          this.stopHeartbeat(tabId)
          callbacks.postMessage({
            type: "stream_end",
            sessionId: tabId,
            reason: "reconnect_completed",
            blocks,
            partial: false,
            source: "reconcile",
          })
          // Push a server_status so the webview's per-tab status badge is correct.
          callbacks.postMessage({
            type: "server_status",
            sessionId: tabId,
            status: "idle",
          })
        } else {
          // Run is still active — push a busy status so the webview shows
          // "thinking" instead of a stale idle/ready badge from before the outage.
          callbacks.postMessage({
            type: "server_status",
            sessionId: tabId,
            status: "thinking",
          })
        }
      }
    } catch (err) {
      log.warn(`reconcileAfterReconnect failed for ${tabId}`, err)
    }
  }

  /**
   * Host-authoritative probe: is the run for `tabId` still active on the
   * server? Used by the webview to correct stale optimistic flags. Always
   * replies via `run_status_result`, even on server failure (so the webview
   * never hangs waiting).
   *
   * Decision procedure:
   *   1. If we have no active run in our local `activeRuns` map AND no
   *      cliSessionId to query, reply active=false (we know there's no run).
   *   2. Otherwise, query the server for the last assistant message. If
   *      time.completed is set, the run is finished → active=false.
   *   3. If the server is unreachable, reply active=false with
   *      serverReachable=false so the webview knows not to trust either
   *      answer blindly (and can retry shortly).
   *   4. If the last assistant is mid-stream (no time.completed) AND we
   *      believe the run is live, reply active=true with the messageId/runId
   *      so the webview can re-anchor.
   */
  async probeActiveRun(
    tabId: string,
    callbacks: { postMessage: (m: Record<string, unknown>) => void },
  ): Promise<void> {
    await this.streamTimeoutManager.probeActiveRun(tabId, callbacks)
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
      await this.startPrompt({
        tabId,
        text: lastUser.blocks.map(b => b.type === "text" ? b.text : "").join(" ").trim() || "Please retry the last request.",
        callbacks,
      })
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
    await this.startPrompt({
      tabId,
      text: retryPrompt,
      callbacks,
    })
  }

  appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void {
    // G5: any chunk cancels a pending status-triggered finalize — the model
    // is clearly still working.
    this.cancelPendingStatusFinalize(tabId)
    // Clear TTFB timeout on first chunk — the model has started responding
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first chunk received for tab ${tabId}`)
      const metrics = this.activeRunMetrics.get(tabId)
      if (metrics && !metrics.firstResponseTime) {
        metrics.firstResponseTime = performance.now()
      }
    }

    const metrics = this.activeRunMetrics.get(tabId)
    if (metrics) metrics.messageCount++
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
      // Remember the server `msg_…` id so an intentional abort can be correlated
      // to its late MessageAbortedError regardless of timing (see abort()).
      const runForMsgId = this.activeRuns.get(tabId)
      if (runForMsgId) runForMsgId.serverMessageId = messageId
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
    // G5: any tool activity cancels a pending status-triggered finalize.
    this.cancelPendingStatusFinalize(tabId)
    this.drainDeferredChunk(tabId, true)
    if (this.ttfbTimeouts.has(tabId)) {
      this.clearTtfbTimeout(tabId)
      log.info(`TTFB: first tool call received for tab ${tabId}`)
      const metrics = this.activeRunMetrics.get(tabId)
      if (metrics && !metrics.firstResponseTime) {
        metrics.firstResponseTime = performance.now()
      }
    }

    const metrics = this.activeRunMetrics.get(tabId)
    if (metrics) metrics.messageCount++
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
      this.toolPartialPoller.clearSsePolling(tabId, toolId)
    }

    const key = this.toolPartialKey(tabId, toolId)
    const previous = this.toolPartialPoller.getOffset(key)
    if (previous && partial.token <= previous.token) return

    let replace = partial.replace === true
    const prevStdoutLength = previous?.stdoutLength ?? 0
    const prevStderrLength = previous?.stderrLength ?? 0
    if (partial.stdoutLength < prevStdoutLength || partial.stderrLength < prevStderrLength) replace = true

    const stdoutDelta = partial.stdoutDelta ?? (
      partial.stdout !== undefined
        ? (replace ? partial.stdout : partial.stdout.slice(prevStdoutLength))
        : ""
    )
    const stderrDelta = partial.stderrDelta ?? (
      partial.stderr !== undefined
        ? (replace ? partial.stderr : partial.stderr.slice(prevStderrLength))
        : ""
    )

    this.toolPartialPoller.setOffset(key, {
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
      const resultText = partial.result ?? partial.stdout ?? ""
      this.postToolEnd(tabId, {
        id: toolId,
        ok: partial.ok ?? partial.exitCode === 0,
        result: resultText,
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
    return this.toolCallTracker.getStableToolId(tabId)
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

  /**
   * Issue 3: Arm a disconnect grace timeout for a streaming tab. If the event
   * stream doesn't reconnect within DISCONNECT_GRACE_MS, force-finalize the
   * stream so the UI doesn't stay stuck with a live cursor and spinning tools.
   *
   * The timeout is cancelled by {@link cancelDisconnectGraceTimeout} when the
   * event stream reconnects (via reconcileAfterReconnect) or when the tab is
   * cleaned up.
   */
  armDisconnectGraceTimeout(tabId: string, callbacks: StreamCallbacks): void {
    this.cancelDisconnectGraceTimeout(tabId)
    const timer = setTimeout(() => {
      this.disconnectGraceTimeouts.delete(tabId)
      const tab = this.tabManager.getTab(tabId)
      if (!tab || !tab.isStreaming) return
      log.warn(`Disconnect grace timeout fired for ${tabId} — force-finalizing after ${this.DISCONNECT_GRACE_MS}ms without reconnect`)
      void this.toolCallTracker.markUnresolvedPendingToolCalls(tabId, callbacks)
        .then(() => this.toolCallTracker.markUnresolvedActiveSubagents(tabId, callbacks))
        .then(() => this.finalizeStream(tabId, callbacks))
        .catch(err => log.error(`Disconnect grace finalization failed for ${tabId}`, err))
    }, this.DISCONNECT_GRACE_MS)
    this.disconnectGraceTimeouts.set(tabId, timer)
  }

  /**
   * Issue 3: Cancel a pending disconnect grace timeout. Called when the event
   * stream reconnects (reconcileAfterReconnect takes over) or on cleanupTab.
   */
  cancelDisconnectGraceTimeout(tabId: string): void {
    const timer = this.disconnectGraceTimeouts.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.disconnectGraceTimeouts.delete(tabId)
    }
  }

  cleanupTab(tabId: string): void {
    this.clearTtfbTimeout(tabId)
    this.clearExpiredRecoveryTimeout(tabId)
    this.cancelDisconnectGraceTimeout(tabId)
    // G5: clear any pending status-finalize timer so it can't fire after cleanup.
    this.cancelPendingStatusFinalize(tabId)
    this.stopAllToolPartialPolling(tabId)
    this.ttfbAbortControllers.delete(tabId)
    this.tabManager.setStreaming(tabId, false)
    this.stopWatchdogIfNoStreams()
    this.tabManager.setWaitingForCompletion(tabId, false)
    this.tabManager.clearCompletionTimeout(tabId)
    this.tabManager.clearBuffer(tabId)
    this.tabManager.clearBlocksBuffer(tabId)
    this.stuckStreamHandlers.delete(tabId)
    this.toolCallCounts.delete(tabId)
    this.activeToolCallIds.delete(tabId)
    this.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)
    this.activeMessageIds.delete(tabId)
    this.activeRuns.delete(tabId)
    this.activeRunMetrics.delete(tabId)
    this.finalizePromises.delete(tabId)
    this.replayedMessageIds.delete(tabId)
    // ADR-010: notify registry that this tab is no longer associated with its process
    if (this.sessionManagerRegistry) {
      this.sessionManagerRegistry.unassignTab(tabId)
    }
    this.loggedBubbleMismatches.delete(tabId)
    this.stopHeartbeat(tabId)
    this.subagentHeartbeat.stop(tabId)
    const cliSessionId = this.tabManager.getTab(tabId)?.cliSessionId
    if (cliSessionId) this.injectedInstructionsSessions.delete(cliSessionId)
    this.msgSeqs.delete(tabId)
    this.lastActivityFingerprint.delete(tabId)
    this.postedChunkSeqs.delete(tabId)
    this.clearDeferredChunk(tabId)
    this.finalUsageBaselines.delete(tabId)
    this.contextEstimateVersions.delete(tabId)
    this.lastDeferralLogTs.delete(tabId)
    this.activitySeqs.delete(tabId)
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
    this.stuckStreamHandlers.clear()
    // G5: clear pending status-finalize timers on dispose.
    for (const timer of this.pendingStatusFinalizeTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingStatusFinalizeTimers.clear()
    // Settle any deferred finalize promises so awaiting callers don't hang.
    for (const settle of [...this.pendingStatusFinalizeResolvers.values()]) {
      settle(false)
    }
    this.pendingStatusFinalizeResolvers.clear()
    for (const timer of this.pendingToolGraceTimeouts.values()) {
      clearTimeout(timer)
    }
    this.pendingToolGraceTimeouts.clear()
    for (const timer of this.disconnectGraceTimeouts.values()) {
      clearTimeout(timer)
    }
    this.disconnectGraceTimeouts.clear()
    this.subagentHeartbeat.stopAll()
    this.finalizingTabs.clear()
    this.finalizePromises.clear()
    this.replayedMessageIds.clear()
    this.abortedTabs.clear()
    this.abortRegistry.clear()
    this.streamStates.clear()
    this.activeMessageIds.clear()
    this.activeRuns.clear()
    this.activeRunMetrics.clear()
    this.msgSeqs.clear()
    this.heartbeatService.dispose()
    this.toolPartialPoller.dispose()
    this.toolCallTracker.dispose()
    this.streamTimeoutManager.dispose()
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
