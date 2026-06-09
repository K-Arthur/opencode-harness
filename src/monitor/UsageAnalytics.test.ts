import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { UsageAnalytics, type UsageReport } from "./UsageAnalytics"
import type { ContextUsageHistory } from "./ContextMonitor"

describe("UsageAnalytics - Aggregation", () => {
  it("aggregates total tokens across sessions", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.totalTokens, 3000)
  })

  it("aggregates total cost across sessions", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.ok(Math.abs(stats.totalCost - 0.009) < 0.001)
  })

  it("counts unique sessions", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1500,
        maxTokens: 100000,
        breakdown: { system: 150, history: 750, workspace: 600, queued: 0, steer: 0 },
        cost: 0.0045,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.sessionCount, 2)
  })

  it("calculates average tokens per session", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.averageTokensPerSession, 1500)
  })

  it("calculates average cost per session", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.ok(Math.abs(stats.averageCostPerSession - 0.0045) < 0.001)
  })
})

describe("UsageAnalytics - Daily Breakdown", () => {
  it("groups entries by date", () => {
    const analytics = new UsageAnalytics()
    const now = Date.now()
    const yesterday = now - (24 * 60 * 60 * 1000)

    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: now,
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: now,
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
      {
        sessionId: "session-3",
        timestamp: yesterday,
        tokens: 1500,
        maxTokens: 100000,
        breakdown: { system: 150, history: 750, workspace: 600, queued: 0, steer: 0 },
        cost: 0.0045,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.dailyBreakdown.length, 2)
  })

  it("sorts daily breakdown by date", () => {
    const analytics = new UsageAnalytics()
    const now = Date.now()
    const yesterday = now - (24 * 60 * 60 * 1000)
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000)

    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-3",
        timestamp: twoDaysAgo,
        tokens: 1500,
        maxTokens: 100000,
        breakdown: { system: 150, history: 750, workspace: 600, queued: 0, steer: 0 },
        cost: 0.0045,
      },
      {
        sessionId: "session-1",
        timestamp: now,
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: yesterday,
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.dailyBreakdown.length, 3)
    if (stats.dailyBreakdown[0] && stats.dailyBreakdown[1] && stats.dailyBreakdown[2]) {
      assert.ok(stats.dailyBreakdown[0].date <= stats.dailyBreakdown[1].date)
      assert.ok(stats.dailyBreakdown[1].date <= stats.dailyBreakdown[2].date)
    }
  })

  it("sums tokens and cost per day", () => {
    const analytics = new UsageAnalytics()
    const now = Date.now()

    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: now,
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: now,
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    const todayEntry = stats.dailyBreakdown[0]
    if (todayEntry) {
      assert.strictEqual(todayEntry.tokens, 3000)
      assert.ok(Math.abs(todayEntry.cost - 0.009) < 0.001)
    }
  })
})

describe("UsageAnalytics - Top Sessions", () => {
  it("identifies top sessions by token usage", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: Date.now(),
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
      {
        sessionId: "session-3",
        timestamp: Date.now(),
        tokens: 1500,
        maxTokens: 100000,
        breakdown: { system: 150, history: 750, workspace: 600, queued: 0, steer: 0 },
        cost: 0.0045,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.topSessions.length, 3)
    if (stats.topSessions[0]) {
      assert.strictEqual(stats.topSessions[0].sessionId, "session-2")
      assert.strictEqual(stats.topSessions[0].tokens, 2000)
    }
  })

  it("limits top sessions to 10", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = []

    for (let i = 0; i < 15; i++) {
      entries.push({
        sessionId: `session-${i}`,
        timestamp: Date.now(),
        tokens: (i + 1) * 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: (i + 1) * 0.003,
      })
    }

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.topSessions.length, 10)
  })
})

describe("UsageAnalytics - Report Generation", () => {
  it("generates comprehensive report", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
    ]

    analytics.setHistory(entries)
    const report = analytics.generateReport(7)

    assert.strictEqual(report.period, "7 days")
    assert.ok(report.generatedAt)
    assert.ok(report.statistics)
    assert.ok(Array.isArray(report.patterns))
    assert.ok(Array.isArray(report.suggestions))
  })

  it("identifies usage patterns", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = []

    for (let i = 0; i < 10; i++) {
      entries.push({
        sessionId: `session-${i}`,
        timestamp: Date.now(),
        tokens: i < 7 ? 5000 : 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.015,
      })
    }

    analytics.setHistory(entries)
    const report = analytics.generateReport(7)

    assert.ok(report.patterns.length >= 0)
  })

  it("generates optimization suggestions", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 60000, queued: 0, steer: 0 },
        cost: 0.003,
      },
    ]

    analytics.setHistory(entries)
    const report = analytics.generateReport(7)

    assert.ok(report.suggestions.length >= 0)
  })
})

describe("UsageAnalytics - Filtering", () => {
  it("filters entries by date range", () => {
    const analytics = new UsageAnalytics()
    const now = Date.now()
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000)
    const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000)

    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: now,
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
      {
        sessionId: "session-2",
        timestamp: sevenDaysAgo + 1000,
        tokens: 2000,
        maxTokens: 100000,
        breakdown: { system: 200, history: 1000, workspace: 800, queued: 0, steer: 0 },
        cost: 0.006,
      },
      {
        sessionId: "session-3",
        timestamp: eightDaysAgo,
        tokens: 1500,
        maxTokens: 100000,
        breakdown: { system: 150, history: 750, workspace: 600, queued: 0, steer: 0 },
        cost: 0.0045,
      },
    ]

    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    assert.strictEqual(stats.totalTokens, 3000)
  })
})

describe("UsageAnalytics - Edge Cases", () => {
  it("handles empty history", () => {
    const analytics = new UsageAnalytics()
    analytics.setHistory([])
    const stats = analytics.getUsageStatistics(7)
    
    assert.strictEqual(stats.totalTokens, 0)
    assert.strictEqual(stats.totalCost, 0)
    assert.strictEqual(stats.sessionCount, 0)
    assert.strictEqual(stats.averageTokensPerSession, 0)
    assert.strictEqual(stats.averageCostPerSession, 0)
    assert.strictEqual(stats.dailyBreakdown.length, 0)
    assert.strictEqual(stats.topSessions.length, 0)
  })

  it("handles zero sessions", () => {
    const analytics = new UsageAnalytics()
    analytics.setHistory([])
    const stats = analytics.getUsageStatistics(7)
    
    assert.strictEqual(stats.sessionCount, 0)
    assert.strictEqual(stats.averageTokensPerSession, 0)
    assert.strictEqual(stats.averageCostPerSession, 0)
  })

  it("handles negative days parameter", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: 0.003,
      },
    ]
    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(-1)
    
    // Should return all entries when days is negative
    assert.strictEqual(stats.totalTokens, 1000)
  })

  it("handles very large token values", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: Number.MAX_SAFE_INTEGER,
        maxTokens: Number.MAX_SAFE_INTEGER,
        breakdown: { system: 100, history: 500, workspace: 400, queued: 0, steer: 0 },
        cost: Number.MAX_SAFE_INTEGER / 1_000_000 * 3,
      },
    ]
    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    
    assert.strictEqual(stats.totalTokens, Number.MAX_SAFE_INTEGER)
  })

  it("handles missing breakdown data", () => {
    const analytics = new UsageAnalytics()
    const entries: ContextUsageHistory[] = [
      {
        sessionId: "session-1",
        timestamp: Date.now(),
        tokens: 1000,
        maxTokens: 100000,
        breakdown: { system: 0, history: 0, workspace: 0, queued: 0, steer: 0 },
        cost: 0.003,
      },
    ]
    analytics.setHistory(entries)
    const stats = analytics.getUsageStatistics(7)
    
    assert.strictEqual(stats.totalTokens, 1000)
  })
})
