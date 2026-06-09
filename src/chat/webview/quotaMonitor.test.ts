import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { QuotaMonitor, getQuotaMonitor, resetQuotaMonitor } from "./quotaMonitor"

describe("QuotaMonitor (simplified state holder)", () => {
  beforeEach(() => {
    resetQuotaMonitor()
  })

  it("starts with an empty snapshot", () => {
    const monitor = new QuotaMonitor()
    const state = monitor.getState()
    assert.equal(state.remainingTokens, 0)
    assert.equal(state.limitTokens, 0)
    assert.equal(state.remainingRequests, 0)
    assert.equal(state.limitRequests, 0)
    assert.equal(state.resetAt, null)
  })

  it("stores the most recent snapshot from updateQuotaState", () => {
    const monitor = new QuotaMonitor()
    monitor.updateQuotaState({
      remainingTokens: 700,
      limitTokens: 1_000,
      remainingRequests: 90,
      limitRequests: 100,
      resetAt: "2026-06-06T12:00:00Z",
    })

    const state = monitor.getState()
    assert.equal(state.remainingTokens, 700)
    assert.equal(state.limitTokens, 1_000)
    assert.equal(state.remainingRequests, 90)
    assert.equal(state.limitRequests, 100)
    assert.ok(state.resetAt instanceof Date)
    assert.equal(state.resetAt?.toISOString(), "2026-06-06T12:00:00.000Z")
  })

  it("coerces an invalid resetAt to null instead of NaN", () => {
    const monitor = new QuotaMonitor()
    monitor.updateQuotaState({
      remainingTokens: 100,
      limitTokens: 1_000,
      remainingRequests: 0,
      limitRequests: 0,
      resetAt: "not-a-date",
    })

    assert.equal(monitor.getState().resetAt, null)
  })

  it("startMonitoring and stopMonitoring are safe no-ops", () => {
    const monitor = new QuotaMonitor()
    assert.doesNotThrow(() => monitor.startMonitoring())
    assert.doesNotThrow(() => monitor.stopMonitoring())
    assert.doesNotThrow(() => monitor.startMonitoring())
    assert.doesNotThrow(() => monitor.startMonitoring())
    assert.doesNotThrow(() => monitor.stopMonitoring())
  })

  it("destroy resets the snapshot to empty", () => {
    const monitor = new QuotaMonitor()
    monitor.updateQuotaState({
      remainingTokens: 500,
      limitTokens: 1_000,
      remainingRequests: 50,
      limitRequests: 100,
      resetAt: "2026-06-06T12:00:00Z",
    })
    monitor.destroy()
    assert.equal(monitor.getState().remainingTokens, 0)
  })

  it("getQuotaMonitor returns the same instance (singleton)", () => {
    const a = getQuotaMonitor()
    const b = getQuotaMonitor()
    assert.equal(a, b)
  })

  it("resetQuotaMonitor creates a fresh instance on next getQuotaMonitor", () => {
    const a = getQuotaMonitor()
    a.updateQuotaState({
      remainingTokens: 1,
      limitTokens: 1,
      remainingRequests: 1,
      limitRequests: 1,
      resetAt: "2026-06-06T12:00:00Z",
    })
    resetQuotaMonitor()
    const b = getQuotaMonitor()
    assert.notEqual(a, b)
    assert.equal(b.getState().remainingTokens, 0)
  })
})
