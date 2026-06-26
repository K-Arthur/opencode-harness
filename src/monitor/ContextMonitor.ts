import { ContextUsageThrottler } from "../chat/ContextUsageThrottler.js"
import type { ContextUsageData } from "../chat/ContextUsageThrottler.js"

export interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  sessionId?: string
  breakdown?: {
    system: number
    history: number
    workspace: number
    queued: number
    steer: number
  }
  projected?: {
    withQueue: number
    overflow: boolean
  }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
}

export interface ContextUsageUpdateOptions {
  source?: "estimated" | "actual"
  updatedAt?: number
  immediate?: boolean
}

export interface ContextUsageHistory {
  sessionId: string
  timestamp: number
  tokens: number
  maxTokens: number
  modelId?: string
  breakdown: {
    system: number
    history: number
    workspace: number
    queued: number
    steer: number
  }
  cost: number
}

export interface UsageStatistics {
  totalTokens: number
  totalCost: number
  sessionCount: number
  averageTokensPerSession: number
  averageCostPerSession: number
  dailyBreakdown: Array<{ date: string; tokens: number; cost: number }>
  topSessions: Array<{ sessionId: string; tokens: number; cost: number }>
}

export interface ProviderPricing {
  inputPricePerMillion: number
  outputPricePerMillion: number
}

type EventListener<T> = (event: T) => void

class SimpleEventEmitter<T> {
  private listeners = new Set<EventListener<T>>()

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(event: T): void {
    for (const listener of this.listeners) listener(event)
  }

  dispose(): void {
    this.listeners.clear()
  }
}

function getVsCodeApi(): typeof import("vscode") | undefined {
  try {
    return typeof require === "function" ? require("vscode") : undefined
  } catch {
    return undefined
  }
}

export class ContextMonitor {
private currentTokens = 0
  // Default to 0 (unknown). The webview hides the context bar when the
  // denominator is 0, so we surface no info rather than a misleading "X /
  // 100,000" when the active model's true context window hasn't been
  // resolved yet (e.g. opencode-routed models whose server config omits
  // limit.context). setTokenLimit() is called once the model resolves.
  private tokenLimit = 0
  // Per-session context window. A single shared tokenLimit caused cross-session
  // bleed: two tabs on different-context models computed maxTokens/percent
  // against whichever limit was set last. limitBySession keeps them independent;
  // this.tokenLimit remains the sessionless default/fallback.
  private limitBySession = new Map<string, number>()
  private onContextChangedEmitter = new SimpleEventEmitter<ContextUsage>()
  private latestUsageBySession = new Map<string, ContextUsage>()
  private usageHistory: ContextUsageHistory[] = []
  private historyRetentionDays = 30
  private readonly MAX_HISTORY_ENTRIES = 1000
  private providerPricing: Map<string, ProviderPricing> = new Map()
  private currentProvider: string = "anthropic"
  private currentModelId?: string
  private onHistoryUpdatedEmitter = new SimpleEventEmitter<void>()
  private trackingEnabled = true
  private throttler: ContextUsageThrottler

  readonly onContextChanged = this.onContextChangedEmitter.event
  readonly onHistoryUpdated = this.onHistoryUpdatedEmitter.event

  /** Public accessor for current token usage, used by AutoCompactor */
  get tokensUsed(): number {
    return this.currentTokens
  }

  /** Public accessor for the active limit, used by AutoCompactor */
  get limit(): number {
    return this.tokenLimit
  }

  /** Current usage as percent of limit, safe for limit === 0 (returns 0). */
  get percent(): number {
    return this.calculatePercent(this.currentTokens)
  }

  constructor(debounceMs: number = 250) {
    this.throttler = new ContextUsageThrottler(debounceMs)
    this.throttler.onEmit((data) => this.onContextChangedEmitter.fire(data as ContextUsage))
    this.initializeProviderPricing()
    this.loadSettings()
  }

  /**
   * Load user settings for context tracking.
   */
  private loadSettings(): void {
    const vscode = getVsCodeApi()
    if (!vscode) return

    const config = vscode.workspace.getConfiguration("opencode")
    this.trackingEnabled = config.get<boolean>("contextTrackingEnabled", true)
    this.historyRetentionDays = config.get<number>("contextRetentionDays", 30)
  }

  private initializeProviderPricing(): void {
    this.providerPricing.set("anthropic", {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    })
    this.providerPricing.set("openai", {
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
    })
    this.providerPricing.set("google", {
      inputPricePerMillion: 0.125,
      outputPricePerMillion: 0.375,
    })
  }

  setProvider(provider: string): void {
    this.currentProvider = provider
  }

  setModel(modelId: string, contextWindow?: number): void {
    this.currentModelId = modelId
    if (contextWindow && contextWindow > 0) {
      this.setTokenLimit(contextWindow)
    }
  }

  setModelAndProvider(modelId: string, provider: string): void {
    this.currentModelId = modelId
    this.currentProvider = provider
  }

  getCurrentModel(): string | undefined {
    return this.currentModelId
  }

  /**
   * Update the token limit dynamically based on the active model.
   */
  setTokenLimit(limit: number, sessionId?: string): void {
    if (limit < 0) return
    if (sessionId) {
      // Store per-session so a second tab's model can't change this session's
      // window. Re-emit only when this session's own limit actually changed.
      if (this.limitBySession.get(sessionId) !== limit) {
        this.limitBySession.set(sessionId, limit)
        this.tokenLimit = limit // keep the sessionless default fresh
        this.reemitLatestUsageForSession(sessionId)
      }
      return
    }
    if (limit !== this.tokenLimit) this.tokenLimit = limit
  }

  /** Effective context window for a session: its own limit, else the shared default. */
  private limitFor(sessionId?: string): number {
    if (sessionId && this.limitBySession.has(sessionId)) return this.limitBySession.get(sessionId)!
    return this.tokenLimit
  }

  getCurrentUsage(sessionId?: string): ContextUsage | undefined {
    if (sessionId) {
      const usage = this.latestUsageBySession.get(sessionId)
      return usage ? this.cloneUsage(usage) : undefined
    }
    if (this.currentTokens <= 0) return undefined
    return {
      percent: this.percent,
      tokens: this.currentTokens,
      maxTokens: this.tokenLimit,
      cost: this.calculateCost(this.currentTokens),
      source: "estimated",
      updatedAt: Date.now(),
    }
  }

  /**
   * Clear all per-session state after compaction or tab close, so stale
   * pre-compaction token counts are not served by getCurrentUsage().
   * The next real context_usage event will repopulate the entry.
   */
  resetSession(sessionId: string): void {
    this.latestUsageBySession.delete(sessionId)
    this.limitBySession.delete(sessionId)
  }

  /**
   * Read the autoCompact setting from VS Code configuration.
   */
  getAutoCompactSetting(): "ask" | "auto" | "off" {
    const vscode = getVsCodeApi()
    if (!vscode) return "ask"
    const config = vscode.workspace.getConfiguration("opencode")
    const value = config.get<string>("autoCompact", "ask")
    if (value === "auto" || value === "off") return value
    return "ask"
  }

  /**
   * Read the auto-compaction trigger threshold (percent of context window).
   *
   * Defaults to 80. Users with small-context models may prefer a higher
   * threshold (e.g. 90) so the conversation isn't compacted prematurely;
   * users on large-context models may prefer a lower one (e.g. 70) to
   * control cost. Per-model overrides are looked up first by the
   * `provider/modelId` key, e.g. `"deepseek/deepseek-reasoner": 90`.
   *
   * Returned value is clamped to [10, 95] to avoid two failure modes:
   *  - too low → constant compaction storm
   *  - too high → never compacts (no recovery from runaway context)
   */
  getAutoCompactThreshold(modelKey?: string): number {
    const vscode = getVsCodeApi()
    const defaultThreshold = 80
    if (!vscode) return defaultThreshold
    const config = vscode.workspace.getConfiguration("opencode")
    let raw = config.get<number>("autoCompactThreshold", defaultThreshold)
    if (modelKey) {
      const overrides = config.get<Record<string, number>>("autoCompactPerModelThreshold", {}) || {}
      if (typeof overrides[modelKey] === "number" && Number.isFinite(overrides[modelKey])) {
        raw = overrides[modelKey]!
      }
    }
    if (!Number.isFinite(raw)) raw = defaultThreshold
    return Math.max(10, Math.min(95, Math.round(raw)))
  }

  updateTokens(
    tokensUsed: number,
    sessionId?: string,
    breakdown?: { system: number; history: number; workspace: number; queued?: number; steer?: number },
    options: ContextUsageUpdateOptions = {},
  ): void {
    // Clamp negative token values to zero
    this.currentTokens = Math.max(0, tokensUsed)
    const cost = this.calculateCost(this.currentTokens, breakdown)
    const effectiveLimit = this.limitFor(sessionId)

    // Emit percent:0 when the limit is unknown (tokenLimit === 0) rather than
    // dividing by a fake safeLimit of 1, which would produce percent:100 for
    // any non-zero token count and trigger a false critical-red ring in the UI.
    const usage: ContextUsage = {
      percent: this.calculatePercent(this.currentTokens, effectiveLimit),
      tokens: this.currentTokens,
      maxTokens: effectiveLimit,
      sessionId,
      breakdown: breakdown ? {
        system: breakdown.system,
        history: breakdown.history,
        workspace: breakdown.workspace,
        queued: breakdown.queued ?? 0,
        steer: breakdown.steer ?? 0,
      } : undefined,
      cost,
      source: options.source ?? "estimated",
      updatedAt: Number.isFinite(options.updatedAt ?? NaN) ? options.updatedAt : Date.now(),
    }
    if (sessionId) this.latestUsageBySession.set(sessionId, usage)
    // Populate projected field from pending queued/steer tokens
    if (breakdown) {
      const pendingTokens = (breakdown.queued ?? 0) + (breakdown.steer ?? 0)
      if (pendingTokens > 0) {
        const prediction = this.predictUsage(pendingTokens)
        usage.projected = { withQueue: prediction.predictedTokens, overflow: prediction.willOverflow }
      }
    }

    // Use throttled emit for regular updates, immediate for critical events
    const data: ContextUsageData = {
      percent: usage.percent,
      tokens: usage.tokens,
      maxTokens: usage.maxTokens,
      sessionId: usage.sessionId,
      breakdown: usage.breakdown,
      cost: usage.cost,
      source: usage.source,
      updatedAt: usage.updatedAt,
    }

    if (options.immediate) {
      this.throttler.emitImmediate(data)
    } else {
      this.throttler.emit(data)
    }

    if (sessionId !== undefined && breakdown) {
      this.trackUsage(sessionId, this.currentTokens, breakdown, cost)
    }
  }

  private reemitLatestUsageForSession(sessionId: string): void {
    const latest = this.latestUsageBySession.get(sessionId)
    if (!latest) return

    const tokens = Math.max(0, latest.tokens)
    this.currentTokens = tokens
    const effectiveLimit = this.limitFor(sessionId)
    const usage: ContextUsage = {
      ...latest,
      percent: this.calculatePercent(tokens, effectiveLimit),
      tokens,
      maxTokens: effectiveLimit,
      updatedAt: Date.now(),
    }
    this.latestUsageBySession.set(sessionId, usage)

    // Re-emit immediately since this is a critical limit change
    this.throttler.emitImmediate({
      percent: usage.percent,
      tokens: usage.tokens,
      maxTokens: usage.maxTokens,
      sessionId: usage.sessionId,
      breakdown: usage.breakdown,
      cost: usage.cost,
      source: usage.source,
      updatedAt: usage.updatedAt,
    })
  }

  /**
   * Update queue and steer token counts separately.
   * Called when the prompt queue changes.
   */
  updateQueueTokens(queueTokens: number, steerTokens: number, sessionId?: string): void {
    // Edge case: Clamp negative values to zero
    const safeQueueTokens = Math.max(0, queueTokens)
    const safeSteerTokens = Math.max(0, steerTokens)
    
    // This will be called by the queue when items are added/removed.
    // Guard against tokenLimit === 0 (unknown context window) to prevent
    // NaN/Infinity in the emitted percent field.
    const queueLimit = this.limitFor(sessionId)
    const usage: ContextUsage = {
      percent: this.calculatePercent(this.currentTokens, queueLimit),
      tokens: this.currentTokens,
      maxTokens: queueLimit,
      sessionId,
      breakdown: {
        system: 0, // Will be filled by the main updateTokens
        history: 0,
        workspace: 0,
        queued: safeQueueTokens,
        steer: safeSteerTokens,
      },
      source: "estimated",
      updatedAt: Date.now(),
    }
    if (sessionId) this.latestUsageBySession.set(sessionId, usage)
    // Populate projected from queue
    const pendingTokens = safeQueueTokens + safeSteerTokens
    if (pendingTokens > 0) {
      const prediction = this.predictUsage(pendingTokens)
      usage.projected = { withQueue: prediction.predictedTokens, overflow: prediction.willOverflow }
    }

    // Queue changes are critical for UX, emit immediately
    this.throttler.emitImmediate({
      percent: usage.percent,
      tokens: usage.tokens,
      maxTokens: usage.maxTokens,
      sessionId: usage.sessionId,
      breakdown: usage.breakdown,
      source: usage.source,
      updatedAt: usage.updatedAt,
    })
  }

  showWarning(message: string): void {
    const vscode = getVsCodeApi()
    if (vscode) void vscode.window.showWarningMessage(message)
  }

  private calculateCost(tokens: number, breakdown?: { system: number; history: number; workspace: number; queued?: number; steer?: number }): number {
    const pricing = this.providerPricing.get(this.currentProvider)
    if (!pricing) return 0

    const inputTokens = breakdown ? Math.max(tokens, breakdown.system + breakdown.history + breakdown.workspace) : tokens
    const outputTokens = breakdown ? (breakdown.queued || 0) + (breakdown.steer || 0) : 0

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion

    return inputCost + outputCost
  }

  private calculatePercent(tokens: number, limit: number = this.tokenLimit): number {
    if (limit <= 0) return 0
    const raw = (Math.max(0, tokens) / limit) * 100
    if (!Number.isFinite(raw)) return 0
    const clamped = Math.min(100, Math.max(0, raw))
    if (clamped > 0 && clamped < 1) {
      return Math.max(0.01, Math.round(clamped * 100) / 100)
    }
    return Math.round(clamped)
  }

  private cloneUsage(usage: ContextUsage): ContextUsage {
    return {
      ...usage,
      breakdown: usage.breakdown ? { ...usage.breakdown } : undefined,
      projected: usage.projected ? { ...usage.projected } : undefined,
    }
  }

  private trackUsage(sessionId: string, tokens: number, breakdown: { system: number; history: number; workspace: number; queued?: number; steer?: number }, cost: number): void {
    if (!this.trackingEnabled) return

    const entry: ContextUsageHistory = {
      sessionId,
      timestamp: Date.now(),
      tokens,
      maxTokens: this.tokenLimit,
      modelId: this.currentModelId,
      breakdown: {
        system: breakdown.system,
        history: breakdown.history,
        workspace: breakdown.workspace,
        queued: breakdown.queued ?? 0,
        steer: breakdown.steer ?? 0,
      },
      cost,
    }

    this.usageHistory.push(entry)
    this.pruneOldEntries()
    this.onHistoryUpdatedEmitter.fire()
  }

  private pruneOldEntries(): void {
    const cutoffTime = Date.now() - (this.historyRetentionDays * 24 * 60 * 60 * 1000)
    this.usageHistory = this.usageHistory.filter(entry => entry.timestamp > cutoffTime)

    if (this.usageHistory.length > this.MAX_HISTORY_ENTRIES) {
      this.usageHistory = this.usageHistory.slice(-this.MAX_HISTORY_ENTRIES)
    }
  }

  getUsageStatistics(days: number = 7): UsageStatistics {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
    const recentEntries = this.usageHistory.filter(entry => entry.timestamp > cutoffTime)

    const totalTokens = recentEntries.reduce((sum, entry) => sum + entry.tokens, 0)
    const totalCost = recentEntries.reduce((sum, entry) => sum + entry.cost, 0)
    const sessionCount = new Set(recentEntries.map(entry => entry.sessionId)).size

    const dailyBreakdown = this.calculateDailyBreakdown(recentEntries)
    const topSessions = this.calculateTopSessions(recentEntries)

    return {
      totalTokens,
      totalCost,
      sessionCount,
      averageTokensPerSession: sessionCount > 0 ? totalTokens / sessionCount : 0,
      averageCostPerSession: sessionCount > 0 ? totalCost / sessionCount : 0,
      dailyBreakdown,
      topSessions,
    }
  }

  private calculateDailyBreakdown(entries: ContextUsageHistory[]): Array<{ date: string; tokens: number; cost: number }> {
    const dailyMap = new Map<string, { tokens: number; cost: number }>()

    for (const entry of entries) {
      const isoString = new Date(entry.timestamp).toISOString()
      const date = isoString.split('T')[0] || isoString
      const existing = dailyMap.get(date) || { tokens: 0, cost: 0 }
      existing.tokens += entry.tokens
      existing.cost += entry.cost
      dailyMap.set(date, existing)
    }

    return Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, tokens: data.tokens, cost: data.cost }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  private calculateTopSessions(entries: ContextUsageHistory[]): Array<{ sessionId: string; tokens: number; cost: number }> {
    const sessionMap = new Map<string, { tokens: number; cost: number }>()

    for (const entry of entries) {
      const existing = sessionMap.get(entry.sessionId) || { tokens: 0, cost: 0 }
      existing.tokens = Math.max(existing.tokens, entry.tokens)
      existing.cost = Math.max(existing.cost, entry.cost)
      sessionMap.set(entry.sessionId, existing)
    }

    return Array.from(sessionMap.entries())
      .map(([sessionId, data]) => ({ sessionId, tokens: data.tokens, cost: data.cost }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10)
  }

  getHistory(sessionId?: string): ContextUsageHistory[] {
    if (sessionId) {
      return this.usageHistory.filter(entry => entry.sessionId === sessionId)
    }
    return [...this.usageHistory]
  }

  predictUsage(pendingTokens: number): { predictedTokens: number; predictedCost: number; willOverflow: boolean } {
    const predictedTokens = this.currentTokens + pendingTokens
    const predictedCost = this.calculateCost(predictedTokens)
    const willOverflow = predictedTokens > this.tokenLimit

    return { predictedTokens, predictedCost, willOverflow }
  }

  generateOptimizationSuggestions(): Array<{ type: "summarize" | "compact" | "warning"; priority: "high" | "medium" | "low"; message: string; estimatedSavings?: number }> {
    const suggestions: Array<{ type: "summarize" | "compact" | "warning"; priority: "high" | "medium" | "low"; message: string; estimatedSavings?: number }> = []
    const utilizationPercent = (this.currentTokens / this.tokenLimit) * 100

    // High utilization warnings
    if (utilizationPercent >= 90) {
      suggestions.push({
        type: "warning",
        priority: "high",
        message: `Context usage at ${utilizationPercent.toFixed(0)}% - consider compacting history`,
      })
    } else if (utilizationPercent >= 75) {
      suggestions.push({
        type: "warning",
        priority: "medium",
        message: `Context usage at ${utilizationPercent.toFixed(0)}% - monitor usage closely`,
      })
    }

    // History compaction suggestions
    const recentHistory = this.usageHistory.slice(-10)
    const avgHistoryTokens = recentHistory.length > 0 
      ? recentHistory.reduce((sum, entry) => sum + entry.breakdown.history, 0) / recentHistory.length 
      : 0

    if (avgHistoryTokens > this.tokenLimit * 0.3) {
      const estimatedSavings = avgHistoryTokens * 0.5
      suggestions.push({
        type: "compact",
        priority: "medium",
        message: `History averages ${avgHistoryTokens.toFixed(0)} tokens - compaction could save ~${estimatedSavings.toFixed(0)} tokens`,
        estimatedSavings,
      })
    }

    return suggestions
  }

  /**
   * Set the history retention period in days.
   */
  setHistoryRetentionDays(days: number): void {
    if (days > 0 && days !== this.historyRetentionDays) {
      this.historyRetentionDays = days
      this.pruneOldEntries()
    }
  }

  /**
   * Enable or disable context tracking.
   */
  setTrackingEnabled(enabled: boolean): void {
    this.trackingEnabled = enabled
  }

  /**
   * Get current tracking status.
   */
  isTrackingEnabled(): boolean {
    return this.trackingEnabled
  }

  /**
   * Get current retention period in days.
   */
  getHistoryRetentionDays(): number {
    return this.historyRetentionDays
  }

  /**
   * Emit a context usage update immediately, bypassing throttling.
   * Use for critical events like compaction, file add, stream boundaries.
   */
  emitImmediate(data: ContextUsageData): void {
    this.throttler.emitImmediate(data)
  }

  dispose(): void {
    this.throttler.dispose()
    this.latestUsageBySession.clear()
    this.onContextChangedEmitter.dispose()
    this.onHistoryUpdatedEmitter.dispose()
  }
}
