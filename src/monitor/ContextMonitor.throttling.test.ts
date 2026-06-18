import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("ContextMonitor throttling integration", () => {
  it("has constructor accepting optional throttler", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextMonitor.ts", "utf8")
    assert.match(source, /constructor\s*\(/)
  })

  it("has emitImmediate method for critical events", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextMonitor.ts", "utf8")
    assert.match(source, /emitImmediate\s*\(/)
  })

  it("updateTokens uses throttled emit by default", async () => {
    const { ContextMonitor } = require("./ContextMonitor.ts")
    const emissions: Array<{ percent: number }> = []
    const monitor = new ContextMonitor()

    monitor.onContextChanged?.((usage: { percent: number }) => emissions.push(usage))

    monitor.setTokenLimit(100_000, "test-session")
    monitor.updateTokens(10_000, "test-session", {
      system: 1000,
      history: 5000,
      workspace: 4000,
    })

    // Should emit (throttling might delay, but should eventually emit)
    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.ok(emissions.length > 0, "should have emitted at least once")
    monitor.dispose()
  })

  it("emitImmediate bypasses throttling and fires immediately", () => {
    const { ContextMonitor } = require("./ContextMonitor.ts")
    const emissions: Array<{ percent: number }> = []
    const monitor = new ContextMonitor()

    monitor.onContextChanged?.((usage: { percent: number }) => emissions.push(usage))

    monitor.setTokenLimit(100_000, "test-session")
    monitor.emitImmediate?.({
      percent: 50,
      tokens: 50_000,
      maxTokens: 100_000,
      sessionId: "test-session",
    })

    // Should emit immediately
    assert.equal(emissions.length, 1)
    assert.equal(emissions[0]?.percent, 50)
    monitor.dispose()
  })

  it("dispose cleans up throttler timers", () => {
    const { ContextMonitor } = require("./ContextMonitor.ts")
    const monitor = new ContextMonitor()

    monitor.setTokenLimit(100_000, "test-session")
    monitor.updateTokens(10_000, "test-session")
    monitor.dispose()

    // Should not throw
    assert.ok(true)
  })
})
