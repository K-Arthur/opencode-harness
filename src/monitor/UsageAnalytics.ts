import type { ContextUsageHistory, UsageStatistics } from "./ContextMonitor"

/**
 * Aggregates usage statistics and generates reports.
 * Identifies patterns and optimization opportunities.
 */
export class UsageAnalytics {
  private history: ContextUsageHistory[] = []

  setHistory(history: ContextUsageHistory[]): void {
    this.history = history
  }

  /**
   * Generate a comprehensive usage report.
   */
  generateReport(days: number = 7): UsageReport {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
    const recentEntries = this.history.filter(entry => entry.timestamp > cutoffTime)

    const statistics = this.calculateStatistics(recentEntries)
    const patterns = this.identifyPatterns(recentEntries)
    const suggestions = this.generateOptimizationSuggestions(recentEntries)

    return {
      period: `${days} days`,
      generatedAt: new Date().toISOString(),
      statistics,
      patterns,
      suggestions,
    }
  }

  /**
   * Get usage statistics for a given time period.
   */
  getUsageStatistics(days: number = 7): UsageStatistics {
    // Handle negative days by treating it as no limit
    const safeDays = days > 0 ? days : Number.MAX_SAFE_INTEGER / (24 * 60 * 60 * 1000)
    const cutoffTime = Date.now() - (safeDays * 24 * 60 * 60 * 1000)
    const recentEntries = this.history.filter(entry => entry.timestamp > cutoffTime)
    return this.calculateStatistics(recentEntries)
  }

  /**
   * Calculate aggregated statistics from usage history.
   */
  private calculateStatistics(entries: ContextUsageHistory[]): UsageStatistics {
    const totalTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0)
    const totalCost = entries.reduce((sum, entry) => sum + entry.cost, 0)
    const sessionCount = new Set(entries.map(entry => entry.sessionId)).size

    const dailyBreakdown = this.calculateDailyBreakdown(entries)
    const topSessions = this.calculateTopSessions(entries)

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

  /**
   * Identify usage patterns from history.
   */
  private identifyPatterns(entries: ContextUsageHistory[]): UsagePattern[] {
    const patterns: UsagePattern[] = []

    if (entries.length === 0) return patterns

    const avgTokens = entries.reduce((sum, e) => sum + e.tokens, 0) / entries.length

    const highUsageSessions = entries.filter(e => e.tokens > avgTokens * 1.5)
    if (highUsageSessions.length > entries.length * 0.3) {
      patterns.push({
        type: "high_usage",
        description: `${highUsageSessions.length} sessions use significantly more tokens than average`,
        severity: "warning",
      })
    }

    const avgCost = entries.reduce((sum, e) => sum + e.cost, 0) / entries.length
    const highCostSessions = entries.filter(e => e.cost > avgCost * 2)
    if (highCostSessions.length > 0) {
      patterns.push({
        type: "high_cost",
        description: `${highCostSessions.length} sessions have unusually high costs`,
        severity: "warning",
      })
    }

    const recentSessions = entries.slice(-10)
    const recentAvgTokens = recentSessions.reduce((sum, e) => sum + e.tokens, 0) / recentSessions.length
    if (recentAvgTokens > avgTokens * 1.2) {
      patterns.push({
        type: "increasing_usage",
        description: "Token usage has increased in recent sessions",
        severity: "info",
      })
    }

    return patterns
  }

  /**
   * Generate optimization suggestions based on usage patterns.
   */
  private generateOptimizationSuggestions(entries: ContextUsageHistory[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []

    if (entries.length === 0) return suggestions

    const avgWorkspaceTokens = entries.reduce((sum, e) => sum + e.breakdown.workspace, 0) / entries.length
    const avgHistoryTokens = entries.reduce((sum, e) => sum + e.breakdown.history, 0) / entries.length

    if (avgWorkspaceTokens > avgHistoryTokens * 2) {
      suggestions.push({
        type: "reduce_workspace",
        title: "Consider reducing workspace context",
        description: "Workspace context accounts for most of your token usage. Try being more selective with file inclusions.",
        priority: "high",
      })
    }

    if (avgHistoryTokens > 50000) {
      suggestions.push({
        type: "compact_history",
        title: "Compact conversation history",
        description: "Your conversation history is using significant tokens. Consider compacting older messages.",
        priority: "medium",
      })
    }

    const avgSteerTokens = entries.reduce((sum, e) => sum + e.breakdown.steer, 0) / entries.length
    if (avgSteerTokens > 10000) {
      suggestions.push({
        type: "optimize_steer",
        title: "Review steer prompt complexity",
        description: "Steer prompts are using substantial tokens. Consider simplifying or consolidating them.",
        priority: "low",
      })
    }

    return suggestions
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
      existing.tokens += entry.tokens
      existing.cost += entry.cost
      sessionMap.set(entry.sessionId, existing)
    }

    return Array.from(sessionMap.entries())
      .map(([sessionId, data]) => ({ sessionId, tokens: data.tokens, cost: data.cost }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10)
  }
}

export interface UsageReport {
  period: string
  generatedAt: string
  statistics: UsageStatistics
  patterns: UsagePattern[]
  suggestions: OptimizationSuggestion[]
}

export interface UsagePattern {
  type: string
  description: string
  severity: "info" | "warning" | "error"
}

export interface OptimizationSuggestion {
  type: string
  title: string
  description: string
  priority: "high" | "medium" | "low"
}
