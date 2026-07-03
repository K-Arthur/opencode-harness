import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { TabManager } from "./TabManager"
import { log } from "../utils/outputChannel"

export interface CompactorCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (msg: string) => void
}

/**
 * Parse a tab's `model` field (formatted as `"provider/modelId"`) into the
 * ModelRef shape the SDK summarize call expects. The slash split tolerates
 * model IDs that themselves contain slashes (e.g. opencode/some/nested).
 * Returns null when the input is empty or shapeless — callers fall back to
 * the SDK's currentModel.
 */
export function toModelRef(model: string | undefined): { providerID: string; modelID: string } | null {
  if (!model || typeof model !== "string") return null
  const idx = model.indexOf("/")
  if (idx <= 0 || idx === model.length - 1) return null
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) }
}

/**
 * Optional context for `tryCompactIfNeeded` — when the trigger came from a
 * `context_usage` event we know which tab fired it, so we can refuse to act
 * if the firing tab isn't the active one. This prevents the previous bug
 * where a background tab crossing 80% would cause us to compact the
 * (possibly empty) active tab instead.
 */
export interface CompactTriggerContext {
  /** sessionId from the context_usage event that triggered the check. */
  sessionId?: string | undefined
}

export class AutoCompactor {
  private snoozeUntil = 0
  private snoozeTokens = 0
  /** Per-tab in-flight set. Prevents stacking duplicate SDK summarize calls
   * when multiple ≥80% updates arrive while a previous one is still running. */
  private readonly inFlight = new Set<string>()
  private readonly lastAutoCompact = new Map<string, { at: number; tokens: number; messageCount: number }>()
  private readonly minAutoCompactIntervalMs = 5 * 60 * 1000
  private readonly minTokenDeltaRatio = 0.08
  private readonly minMessageDelta = 6

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionStore: SessionStore,
    private readonly contextMonitor: ContextMonitor,
    private readonly tabManager: TabManager,
  ) {}

  tryCompactIfNeeded(callbacks: CompactorCallbacks, ctx?: CompactTriggerContext): void {
    if (!this.sessionManager.isRunning) return
    const activeTab = this.tabManager.getActiveTab()
    if (!activeTab || activeTab.isStreaming) return
    if (!activeTab.cliSessionId) return

    // Cross-tab safety: when invoked from a context_usage event, only act if
    // the firing tab is the active one. Otherwise we'd target a tab that
    // hasn't actually crossed the threshold.
    if (ctx?.sessionId && ctx.sessionId !== activeTab.id) return

    // In-flight guard: a slow summarize round-trip can take seconds;
    // during that window more ≥80% events will keep arriving. Drop them.
    if (this.inFlight.has(activeTab.id)) return

    const session = this.sessionStore.get(activeTab.id)
    if (!session || session.messages.length < 10) return

    const autoCompact = this.contextMonitor.getAutoCompactSetting()
    if (autoCompact === "off") return

    // Per-tab usage: the monitor's sessionless percent/tokensUsed/limit
    // getters hold whichever session updated last, so gating on them let a
    // busy background tab trigger (or mask) compaction of the active tab.
    // Read the active tab's own snapshot; without one we cannot know its
    // real fill, so do nothing.
    const usage = this.contextMonitor.getCurrentUsage(activeTab.id)
    if (!usage) return

    // Threshold check — done HERE rather than in ChatProvider so it can be
    // customised per-model. ChatProvider still does a coarse >=80% pre-gate
    // to avoid invoking this hot path for low-usage events; the authoritative
    // check is the model-aware one below.
    const threshold = this.contextMonitor.getAutoCompactThreshold(activeTab.model)
    if (usage.percent < threshold) return

    const now = Date.now()
    if (now < this.snoozeUntil) return
    const currentTokens = usage.tokens
    // If snoozeTokens was set (user clicked "remind me later" earlier), only
    // re-trigger once usage has grown materially (5%) past that point.
    if (this.snoozeTokens > 0 && currentTokens < this.snoozeTokens * 1.05) return

    const tabId = activeTab.id
    const cliSessionId = activeTab.cliSessionId
    const tokenDensity = currentTokens / Math.max(1, session.messages.length)
    if (session.messages.length < 20 && tokenDensity < 1000) return
    const recent = this.lastAutoCompact.get(tabId)
    if (recent && now - recent.at < this.minAutoCompactIntervalMs) {
      const tokenDelta = currentTokens - recent.tokens
      const messageDelta = session.messages.length - recent.messageCount
      if (tokenDelta < recent.tokens * this.minTokenDeltaRatio && messageDelta < this.minMessageDelta) return
    }
    // Multi-tab safety: each tab has its own model (Claude in tab A, GPT in
    // tab B). The SDK's session.summarize accepts an explicit model arg so
    // the server-side summarizer uses the model the user actually expects.
    // Previously we passed no model and the SDK fell back to its global
    // currentModel — could be wrong if the user had just switched tabs.
    const modelRef = toModelRef(activeTab.model)

    const doCompact = () => {
      this.inFlight.add(tabId)
      log.info(`Auto-compacting session ${tabId} (context >= ${threshold}%, ${session.messages.length} messages, model=${activeTab.model || "default"})`)
      callbacks.postMessage({ type: "compaction_started", sessionId: tabId })
      void this.sessionManager.compactSession(cliSessionId, modelRef ?? undefined).then(() => {
        log.info(`Auto-compaction completed for session ${tabId}`)
        this.lastAutoCompact.set(tabId, { at: Date.now(), tokens: currentTokens, messageCount: session.messages.length })
        callbacks.postMessage({
          type: "message",
          sessionId: tabId,
          message: {
            role: "system",
            blocks: [{ type: "task_banner", status: "success", text: "Session auto-compacted (context was >= 80%)" }],
            timestamp: Date.now(),
            sessionId: tabId,
          },
        })
        callbacks.postMessage({ type: "session_compacted", sessionId: tabId })
      }).catch((err) => {
        log.warn("Auto-compaction failed", err)
        callbacks.postRequestError("Auto-compaction failed")
      }).finally(() => {
        this.inFlight.delete(tabId)
      })
    }

    if (autoCompact === "auto") {
      doCompact()
    } else {
      // Banner payload uses the active tab's own window (usage.maxTokens),
      // guarded against limit === 0 so an unresolved context window can't
      // surface NaN/Infinity in the banner percent.
      const limit = usage.maxTokens
      const safeLimit = limit > 0 ? limit : 1
      const pct = Math.min(100, Math.max(0, Math.round((currentTokens / safeLimit) * 100)))
      callbacks.postMessage({
        type: "compact_banner",
        sessionId: tabId,
        percent: pct,
        tokens: currentTokens,
        maxTokens: limit,
        actions: ["compact_now", "remind_later"],
      })
    }
  }

  async handleBannerAction(sessionId: string | undefined, action: string, callbacks: CompactorCallbacks): Promise<void> {
    if (!sessionId) return
    if (action === "compact_now") {
      await this.compactNow(sessionId, callbacks)
      // Reset BOTH snooze fields. Leaving snoozeTokens stale (the pre-fix
      // behaviour) could suppress a legitimate future banner because the
      // 1.05× guard above would still gate on the old value.
      this.snoozeUntil = 0
      this.snoozeTokens = 0
    } else if (action === "remind_later") {
      this.snoozeUntil = Date.now() + 10 * 60 * 1000
      // Snooze against the dismissing session's own count — the sessionless
      // tokensUsed getter may hold a different (busier) tab's figure, which
      // would inflate the 1.05× regrowth gate and suppress future banners.
      this.snoozeTokens = this.contextMonitor.getCurrentUsage(sessionId)?.tokens ?? 0
      callbacks.postMessage({ type: "compact_banner_dismissed", sessionId })
    }
  }

  async compactNow(sessionId: string, callbacks: CompactorCallbacks): Promise<void> {
    const tab = this.tabManager.getTab(sessionId)
    if (!tab?.cliSessionId || !this.sessionManager.isRunning) {
      callbacks.postRequestError("Cannot compact: server not running or session not linked")
      return
    }
    if (tab.isStreaming) {
      callbacks.postRequestError("Cannot compact while a response is streaming. Wait for it to finish or cancel the stream.")
      return
    }
    if (this.inFlight.has(sessionId)) {
      callbacks.postRequestError("Compaction is already running for this session.")
      return
    }

    this.inFlight.add(sessionId)
    try {
      callbacks.postMessage({ type: "compaction_started", sessionId })
      // Pass the tab's own model so the SDK summarises with the right
      // provider/model rather than whichever was last set globally.
      const modelRef = toModelRef(tab.model)
      await this.sessionManager.compactSession(tab.cliSessionId, modelRef ?? undefined)
      log.info(`Session compacted: ${sessionId} (cli: ${tab.cliSessionId}, model=${tab.model || "default"})`)
      callbacks.postMessage({ type: "session_compacted", sessionId })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Compaction failed"
      log.error("Compaction failed", err)
      callbacks.postRequestError(message)
    } finally {
      this.inFlight.delete(sessionId)
    }
  }

  /** Test/inspection helper: returns true when a compaction is in flight. */
  isCompacting(sessionId: string): boolean {
    return this.inFlight.has(sessionId)
  }

  dispose(): void {
    this.inFlight.clear()
    this.lastAutoCompact.clear()
  }
}
