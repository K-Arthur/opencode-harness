import type { TabManager } from "../TabManager"
import type { StreamCallbacks, StreamLifecycleState } from "./StreamCoordinatorTypes"
import type { SessionManager } from "../../session/SessionManager"
import type { RunActivityTracker } from "./RunActivityTracker"
import type { AgentRunState } from "./runActivityTypes"
import type { IntentionalAbortRegistry } from "./intentionalAbortRegistry"
import type { StreamingLogSink } from "./StreamingLog"
import { log } from "../../utils/outputChannel"
import { emit } from "./StreamingLog"
import { mapRunError } from "./runErrorMapper"
import * as vscode from "vscode"

type ActiveRunState = "sending" | "accepted" | "streaming" | "finalizing" | "completed" | "failed" | "aborted" | "timeout" | "interrupted"

/** Active run tracking entry (shared shape with StreamCoordinator). */
export interface ActiveRunEntry {
  tabId: string
  cliSessionId?: string
  clientRequestId?: string
  userMessageId?: string
  assistantMessageId?: string
  serverMessageId?: string
  mode?: string
  model?: string
  startedAt: number
  state: string
}

/** Dependencies shared by reference from StreamCoordinator. */
export interface StreamTimeoutManagerDeps {
  tabManager: TabManager
  sessionManager: SessionManager
  activityTracker: RunActivityTracker
  abortRegistry: IntentionalAbortRegistry
  streamingLog: StreamingLogSink
  streamWatchdog: { current: ReturnType<typeof setInterval> | null }
  ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>>
  ttfbAbortControllers: Map<string, AbortController>
  expiredRecoveryTimeouts: Map<string, ReturnType<typeof setTimeout>>
  stuckStreamHandlers: Map<string, StreamCallbacks>
  activeRuns: Map<string, ActiveRunEntry>
  activeMessageIds: Map<string, string>
  streamStates: Map<string, string>
  readonly STREAM_STUCK_MS: number
  readonly TTFB_TIMEOUT_MS_DEFAULT: number
  readonly TTFB_TIMEOUT_FLOOR_MS: number
  readonly TTFB_TIMEOUT_CEILING_MS: number
  readonly EXPIRED_RECOVERY_TIMEOUT_MS: number
  ttfbTimeoutMs: number | null
  /** Resolve the session manager for a tab (ADR-010 per-tab routing). */
  getSm: (tabId?: string) => SessionManager
  /** Ensure a stream message ID exists — delegated to StreamCoordinator. */
  ensureStreamMessageId: (tabId: string, cliSessionId: string) => string
  /** Next message sequence — delegated to StreamCoordinator. */
  nextSeq: (tabId: string) => number
  /** Cleanup tab — delegated to StreamCoordinator. */
  cleanupTab: (tabId: string) => void
  /** Abort a stream — delegated to StreamCoordinator. */
  abort: (tabId: string, callbacks: StreamCallbacks) => Promise<void>
  /** Set stream state — delegated to StreamCoordinator. */
  setStreamState: (tabId: string, state: StreamLifecycleState, ctx?: Record<string, unknown>) => void
  /** Set active run state — delegated to StreamCoordinator. */
  setActiveRunState: (tabId: string, state: ActiveRunState, ctx?: Record<string, unknown>) => void
  /** Post run activity snapshot — delegated to StreamCoordinator. */
  postRunActivitySnapshot: (tabId: string, snapshot: AgentRunState | undefined, callbacks?: StreamCallbacks) => void
}

/**
 * Manages stream watchdog, TTFB (time-to-first-byte) timeouts, expired
 * question recovery timeouts, and active-run probing with retry. Extracted
 * from StreamCoordinator to isolate timeout lifecycle management from
 * stream content assembly.
 */
export class StreamTimeoutManager {
  static readonly PROBE_MAX_ATTEMPTS = 3
  static readonly PROBE_BACKOFF_BASE_MS = 1_000

  constructor(private readonly deps: StreamTimeoutManagerDeps) {}

  startWatchdog(): void {
    if (this.deps.streamWatchdog.current) return
    this.deps.streamWatchdog.current = setInterval(() => {
      const allTabs = this.deps.tabManager.getAllTabs()
      const anyStreaming = allTabs.some(t => t.isStreaming)
      if (!anyStreaming) {
        this.stopWatchdog()
        return
      }
      for (const tab of allTabs) {
        if (tab.isStreaming && tab.lastActivityTime) {
          const stuckMs = Date.now() - tab.lastActivityTime
          if (stuckMs > this.deps.STREAM_STUCK_MS) {
            log.warn(`Watchdog: Stream for tab ${tab.id} stuck for ${Math.round(stuckMs / 1000)}s, ending as hard_timeout`)
            const callbacks = this.deps.stuckStreamHandlers.get(tab.id)
            if (callbacks) {
              callbacks.postMessage({
                type: "stream_end",
                sessionId: tab.id,
                messageId: this.deps.ensureStreamMessageId(tab.id, tab.cliSessionId ?? tab.id),
                blocks: [...tab.blocksBuffer],
                reason: "hard_timeout",
                partial: true,
                retryable: true,
                seq: this.deps.nextSeq(tab.id),
              })
              this.deps.cleanupTab(tab.id)
            } else {
              log.warn(`No callbacks for stuck tab ${tab.id}, running full cleanup`)
              this.deps.cleanupTab(tab.id)
            }
          }
        }
      }
    }, 15000)
  }

  stopWatchdog(): void {
    if (this.deps.streamWatchdog.current) {
      clearInterval(this.deps.streamWatchdog.current)
      this.deps.streamWatchdog.current = null
    }
  }

  stopWatchdogIfNoStreams(): void {
    const allTabs = this.deps.tabManager.getAllTabs()
    if (!allTabs.some(t => t.isStreaming)) {
      this.stopWatchdog()
    }
  }

  clearTtfbTimeout(tabId: string): void {
    const timer = this.deps.ttfbTimeouts.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.deps.ttfbTimeouts.delete(tabId)
    }
  }

  clearTtfbTimeoutIfPending(tabId: string): boolean {
    if (!this.deps.ttfbTimeouts.has(tabId)) return false
    this.clearTtfbTimeout(tabId)
    return true
  }

  resolveTtfbTimeoutMs(): number {
    const fallback = this.deps.TTFB_TIMEOUT_MS_DEFAULT
    try {
      const raw = vscode.workspace.getConfiguration("opencode").get<number>("streaming.ttfbTimeoutMs")
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return fallback
      const floor = this.deps.TTFB_TIMEOUT_FLOOR_MS
      const ceiling = this.deps.TTFB_TIMEOUT_CEILING_MS
      return Math.min(ceiling, Math.max(floor, Math.round(raw)))
    } catch {
      return fallback
    }
  }

  setupTtfbTimeout(tabId: string, callbacks: StreamCallbacks): void {
    const ttfbMs = this.deps.ttfbTimeoutMs ?? this.resolveTtfbTimeoutMs()
    const abortController = new AbortController()
    this.deps.ttfbAbortControllers.set(tabId, abortController)
    const ttfbTimeout = setTimeout(() => {
      const t = this.deps.tabManager.getTab(tabId)
      if (t?.isStreaming && t.waitingForCompletion) {
        if (!this.deps.activityTracker.shouldTriggerStartupTimeout(tabId, ttfbMs)) {
          log.info(`Startup timeout skipped for tab ${tabId} because OpenCode activity was observed`)
          this.clearTtfbTimeout(tabId)
          return
        }
        const eventStreamStatus = this.deps.sessionManager.eventStreamStatus
        const eventStreamDisconnected = eventStreamStatus.state !== "connected"
        const reason = eventStreamDisconnected ? "event_stream_disconnected" : "ttfb_timeout"
        log.warn(`TTFB timeout for tab ${tabId} — no chunk received within ${ttfbMs}ms (eventStream=${eventStreamStatus.state}, lastRaw=${eventStreamStatus.lastRawEventType || "none"})`)
        emit(
          this.deps.streamingLog,
          "ttfb_timeout",
          tabId,
          `TTFB fired after ${ttfbMs}ms with no chunks (eventStream=${eventStreamStatus.state})`,
          { cliSessionId: t.cliSessionId, context: { reason, ttfbMs } },
        )
        const snapshot = eventStreamDisconnected
          ? this.deps.activityTracker.markRunInterrupted(tabId, "OpenCode event stream disconnected before any response events arrived.")
          : this.deps.activityTracker.markRunFailed(tabId, {
            kind: "model_startup_timeout",
            source: "model_provider",
            recoverability: "retryable",
            message: "No OpenCode activity arrived before the startup timeout.",
          })
        const acceptedRun = this.deps.activeRuns.get(tabId)
        const backendMayStillBeRunning = eventStreamDisconnected ||
          acceptedRun?.state === "accepted" ||
          acceptedRun?.state === "streaming" ||
          acceptedRun?.state === "interrupted"
        const errorContext = mapRunError({
          kind: eventStreamDisconnected ? "transport_disconnected" : "model_startup_timeout",
          source: eventStreamDisconnected ? "event_stream" : "model_provider",
          recoverability: eventStreamDisconnected ? "refresh_from_server" : "retryable",
          sessionId: tabId,
          messageId: this.deps.ensureStreamMessageId(tabId, t.cliSessionId ?? tabId),
          runId: snapshot?.runId,
          mayStillBeRunning: backendMayStillBeRunning,
          partialOutputPreserved: false,
          technicalDetails: `stream=${eventStreamStatus.state};last=${eventStreamStatus.lastRawEventType || ""};timeout=${ttfbMs};session=${t.cliSessionId}`,
        })
        this.deps.postRunActivitySnapshot(tabId, snapshot, callbacks)
        this.deps.setStreamState(tabId, "timeout", { sessionId: t.cliSessionId, eventStream: eventStreamStatus.state })
        if (acceptedRun?.state === "accepted" || acceptedRun?.state === "streaming" || acceptedRun?.state === "interrupted") {
          this.deps.setActiveRunState(tabId, "interrupted", {
            finalizeReason: reason,
            eventStreamState: eventStreamStatus.state,
            lastRawEventType: eventStreamStatus.lastRawEventType,
          })
          this.clearTtfbTimeout(tabId)
          if (t.cliSessionId && eventStreamStatus.state === "connected") {
            void this.probeActiveRunWithRetry(tabId, callbacks).catch(err =>
              log.warn(`TTFB probe failed for ${tabId}`, err),
            )
          } else {
            callbacks.postRequestError(errorContext.userMessage, tabId)
          }
          return
        }
        if (t.cliSessionId && eventStreamStatus.state === "connected") {
          void this.probeActiveRunWithRetry(tabId, callbacks)
            .then(() => {
              const stillActive = this.deps.activeRuns.has(tabId)
              if (stillActive) {
                log.info(`TTFB for ${tabId}: probe says run still active — suppressing stream_end`)
                this.clearTtfbTimeout(tabId)
                return
              }
              log.info(`TTFB for ${tabId}: probe confirmed run gone — finalizing`)
              abortController.abort("ttfb_timeout")
              callbacks.postMessage({
                type: "stream_end",
                sessionId: tabId,
                messageId: this.deps.ensureStreamMessageId(tabId, t.cliSessionId ?? tabId),
                blocks: [],
                reason,
                partial: false,
                retryable: true,
                seq: this.deps.nextSeq(tabId),
                source: "ttfb",
              })
              this.deps.cleanupTab(tabId)
            })
            .catch(err => log.warn(`TTFB probe failed for ${tabId}`, err))
          return
        }
        abortController.abort("ttfb_timeout")
        callbacks.postMessage({
          type: "stream_end",
          sessionId: tabId,
          messageId: this.deps.ensureStreamMessageId(tabId, t.cliSessionId ?? tabId),
          blocks: [],
          reason,
          partial: false,
          retryable: true,
          seq: this.deps.nextSeq(tabId),
          source: "ttfb",
        })
        if (eventStreamDisconnected) {
          callbacks.postRequestError(errorContext.userMessage, tabId)
        }
        this.deps.cleanupTab(tabId)
      }
    }, ttfbMs)
    this.deps.ttfbTimeouts.set(tabId, ttfbTimeout)
  }

  setupExpiredRecoveryTimeout(tabId: string, callbacks: StreamCallbacks): void {
    const answerText = callbacks.expiredRecoveryAnswerText ?? ""
    const timeout = setTimeout(async () => {
      const tab = this.deps.tabManager.getTab(tabId)
      const isActive = tab?.isStreaming && tab.waitingForCompletion
      log.warn(
        `expired_question_recovery hard timeout fired for tab ${tabId} ` +
          `(isActive=${isActive}) — aborting recovery run and auto-forwarding answer`,
      )
      const streamMessageId = this.deps.activeMessageIds.get(tabId) ?? tab?.cliSessionId ?? tabId
      callbacks.clearPromptsInFlight?.()
      const cliSessionId = tab?.cliSessionId
      if (cliSessionId && this.deps.getSm(tabId).isRunning) {
        try {
          await this.deps.abort(tabId, callbacks)
        } catch (err) {
          log.error(`expired_question_recovery abort failed for tab ${tabId}`, err)
        }
      } else {
        this.deps.abortRegistry.recordAbort(tabId, this.deps.activeRuns.get(tabId)?.serverMessageId, Date.now())
        callbacks.postMessage({
          type: "stream_end",
          sessionId: tabId,
          messageId: streamMessageId,
          blocks: [],
          reason: "expired_recovery_timeout",
          partial: false,
          retryable: true,
          seq: this.deps.nextSeq(tabId),
        })
        this.deps.cleanupTab(tabId)
      }
      callbacks.postMessage({
        type: "expired_question_recovery_failed",
        sessionId: tabId,
        messageId: streamMessageId,
        answerText,
        reason: "no_response",
        seq: this.deps.nextSeq(tabId),
      })
    }, this.deps.EXPIRED_RECOVERY_TIMEOUT_MS)
    if (typeof timeout === "object" && typeof timeout.unref === "function") timeout.unref()
    this.deps.expiredRecoveryTimeouts.set(tabId, timeout)
  }

  clearExpiredRecoveryTimeout(tabId: string): void {
    const t = this.deps.expiredRecoveryTimeouts.get(tabId)
    if (t) {
      clearTimeout(t)
      this.deps.expiredRecoveryTimeouts.delete(tabId)
    }
  }

  async probeActiveRunWithRetry(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const maxAttempts = StreamTimeoutManager.PROBE_MAX_ATTEMPTS
    const base = StreamTimeoutManager.PROBE_BACKOFF_BASE_MS
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.probeActiveRun(tabId, callbacks)
        if (attempt > 1) {
          log.info(`Probe for ${tabId} succeeded on attempt ${attempt}/${maxAttempts}`)
          emit(
            this.deps.streamingLog,
            "probe_result",
            tabId,
            `Probe succeeded on attempt ${attempt}/${maxAttempts}`,
          )
        }
        return
      } catch (err) {
        lastErr = err
        if (attempt === maxAttempts) break
        const backoff = base * Math.pow(2, attempt - 1)
        log.warn(
          `Probe for ${tabId} failed on attempt ${attempt}/${maxAttempts}; retrying in ${backoff}ms`,
          err,
        )
        emit(
          this.deps.streamingLog,
          "probe_retry",
          tabId,
          `Probe attempt ${attempt}/${maxAttempts} failed; retrying in ${backoff}ms`,
          { context: { error: err instanceof Error ? err.message : String(err) } },
        )
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, backoff)
          ;(timer as unknown as { unref?: () => void }).unref?.()
        })
      }
    }
    log.warn(`Probe for ${tabId} exhausted ${maxAttempts} attempts — giving up`, lastErr)
    emit(
      this.deps.streamingLog,
      "probe_exhausted",
      tabId,
      `All ${maxAttempts} probe attempts failed — falling back to dead-run path`,
    )
    throw lastErr
  }

  async probeActiveRun(
    tabId: string,
    callbacks: { postMessage: (m: Record<string, unknown>) => void },
  ): Promise<void> {
    const tab = this.deps.tabManager.getTab(tabId)
    const localRun = this.deps.activeRuns.get(tabId)
    const now = Date.now()
    const reply = (active: boolean, serverReachable: boolean, opts?: { messageId?: string; runId?: string }) => {
      callbacks.postMessage({
        type: "run_status_result",
        sessionId: tabId,
        cliSessionId: tab?.cliSessionId,
        active,
        runId: opts?.runId,
        messageId: opts?.messageId,
        probedAt: now,
        serverReachable,
      })
    }

    if (!localRun && !tab?.cliSessionId) {
      reply(false, true)
      return
    }

    if (!tab?.cliSessionId) {
      reply(false, false)
      return
    }

    try {
      const messages = await this.deps.getSm(tabId).getSessionMessages(tab.cliSessionId)
      const lastAssistant = [...messages].reverse().find(m => m.info.role === "assistant")
      if (!lastAssistant) {
        reply(false, true)
        return
      }
      const info = lastAssistant.info as { id?: string; time?: { completed?: number } }
      const completedAt = info.time?.completed
      if (typeof completedAt === "number" && completedAt > 0) {
        if (localRun) {
          this.deps.activeRuns.delete(tabId)
          this.deps.tabManager.setStreaming(tabId, false, { source: "probe", cliSessionId: tab.cliSessionId })
        }
        reply(false, true, { messageId: info.id })
        return
      }
      const active = Boolean(localRun) || tab.isStreaming
      reply(active, true, { messageId: info.id, runId: localRun?.assistantMessageId })
    } catch (err) {
      log.warn(`probeActiveRun: server query failed for ${tabId}`, err)
      reply(Boolean(localRun) || Boolean(tab?.isStreaming), false)
    }
  }

  /** Clear all timers and state — called from StreamCoordinator.dispose. */
  dispose(): void {
    if (this.deps.streamWatchdog.current) {
      clearInterval(this.deps.streamWatchdog.current)
      this.deps.streamWatchdog.current = null
    }
    for (const timer of this.deps.ttfbTimeouts.values()) {
      clearTimeout(timer)
    }
    this.deps.ttfbTimeouts.clear()
    this.deps.ttfbAbortControllers.clear()
    for (const timer of this.deps.expiredRecoveryTimeouts.values()) {
      clearTimeout(timer)
    }
    this.deps.expiredRecoveryTimeouts.clear()
  }
}
