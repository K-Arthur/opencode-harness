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
  private tokenLimit = 100000
  private onContextChangedEmitter = new SimpleEventEmitter<ContextUsage>()
  private usageHistory: ContextUsageHistory[] = []
  private historyRetentionDays = 30
  private readonly MAX_HISTORY_ENTRIES = 1000
  private providerPricing: Map<string, ProviderPricing> = new Map()
  private currentProvider: string = "anthropic"
  private currentModelId?: string
  private onHistoryUpdatedEmitter = new SimpleEventEmitter<void>()
  private trackingEnabled = true

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

  constructor() {
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

  getCurrentModel(): string | undefined {
    return this.currentModelId
  }

  /**
   * Update the token limit dynamically based on the active model.
   */
  setTokenLimit(limit: number): void {
    if (limit >= 0 && limit !== this.tokenLimit) {
      this.tokenLimit = limit
      // Re-evaluate current usage with new limit
      this.updateTokens(this.currentTokens)
    }
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

  updateTokens(tokensUsed: number, sessionId?: string, breakdown?: { system: number; history: number; workspace: number; queued?: number; steer?: number }): void {
    // Clamp negative token values to zero
    this.currentTokens = Math.max(0, tokensUsed)
    const cost = this.calculateCost(this.currentTokens, breakdown)
    
    // Handle zero token limit to avoid division by zero
    const safeTokenLimit = this.tokenLimit > 0 ? this.tokenLimit : 1
    const usage: ContextUsage = {
      percent: Math.min(100, Math.round((this.currentTokens / safeTokenLimit) * 100)),
      tokens: this.currentTokens,
      maxTokens: this.tokenLimit,
      sessionId,
      breakdown: breakdown ? {
        system: breakdown.system,
        history: breakdown.history,
        workspace: breakdown.workspace,
        queued: breakdown.queued ?? 0,
        steer: breakdown.steer ?? 0,
      } : undefined,
      cost,
    }
    this.onContextChangedEmitter.fire(usage)
    if (sessionId !== undefined && breakdown) {
      this.trackUsage(sessionId, this.currentTokens, breakdown, cost)
    }
  }

  /**
   * Update queue and steer token counts separately.
   * Called when the prompt queue changes.
   */
  updateQueueTokens(queueTokens: number, steerTokens: number, sessionId?: string): void {
    // Edge case: Clamp negative values to zero
    const safeQueueTokens = Math.max(0, queueTokens)
    const safeSteerTokens = Math.max(0, steerTokens)
    
    // This will be called by the queue when items are added/removed
    // The breakdown will be merged with the current context usage
    const usage: ContextUsage = {
      percent: Math.min(100, Math.round((this.currentTokens / this.tokenLimit) * 100)),
      tokens: this.currentTokens,
      maxTokens: this.tokenLimit,
      sessionId,
      breakdown: {
        system: 0, // Will be filled by the main updateTokens
        history: 0,
        workspace: 0,
        queued: safeQueueTokens,
        steer: safeSteerTokens,
      },
    }
    this.onContextChangedEmitter.fire(usage)
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

  dispose(): void {
    this.onContextChangedEmitter.dispose()
    this.onHistoryUpdatedEmitter.dispose()
  }
}
