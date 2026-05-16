import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { QuotaMonitor } from "./quotaMonitor"

describe("QuotaMonitor", () => {
  it("treats unknown quota limits as unavailable instead of exhausted", () => {
    const monitor = new QuotaMonitor()

    monitor.updateQuotaState({
      remainingTokens: null,
      limitTokens: null,
      remainingRequests: undefined,
      limitRequests: undefined,
      resetAt: null,
    } as any)

    const state = monitor.getQuotaState()
    assert.ok(state)
    assert.equal(state.timeUntilReset, 0)
    assert.equal(state.currentWarningLevel, 100)
    assert.equal(monitor.getWarnings().length, 0)
  })

  it("does not produce NaN warning percentages for partial quota data", () => {
    const monitor = new QuotaMonitor()

    monitor.updateQuotaState({
      remainingTokens: 100,
      limitTokens: 1_000,
      remainingRequests: undefined,
      limitRequests: 100,
      resetAt: "not-a-date",
    } as any)

    const warnings = monitor.getWarnings()
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.percentage, 10)
    assert.equal(monitor.getQuotaState()?.currentWarningLevel, 20)

    for (const warning of warnings) {
      assert.ok(Number.isFinite(warning.percentage))
      assert.ok(Number.isFinite(warning.timeUntilReset))
    }
  })
})
