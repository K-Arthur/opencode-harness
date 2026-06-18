import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("ContextUsageThrottler", () => {
  it("exists and exports a class", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /export\s+class\s+ContextUsageThrottler/)
  })

  it("has constructor accepting debounceMs parameter", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /constructor\s*\(\s*private\s+readonly\s+debounceMs\s*:\s*number/)
  })

  it("has emit method that debounces updates", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /emit\s*\(/)
  })

  it("has emitImmediate method that bypasses debounce", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /emitImmediate\s*\(/)
  })

  it("has onEmit event for subscribing to throttled emissions", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /readonly\s+onEmit\s*=/)
  })

  it("has dispose method to cleanup timers", () => {
    const source = require("fs").readFileSync(__dirname + "/ContextUsageThrottler.ts", "utf8")
    assert.match(source, /dispose\s*\(\s*\)/)
  })
})

describe("ContextUsageThrottler behavior", () => {
  it("coalesces multiple rapid emits within debounce window", async () => {
    const { ContextUsageThrottler } = require("./ContextUsageThrottler.ts")
    const emissions: Array<{ percent: number; tokens: number }> = []
    const throttler = new ContextUsageThrottler(250)

    throttler.onEmit((data: { percent: number; tokens: number }) => emissions.push(data))

    throttler.emit({ percent: 10, tokens: 1000 })
    throttler.emit({ percent: 20, tokens: 2000 })
    throttler.emit({ percent: 30, tokens: 3000 })

    assert.equal(emissions.length, 0)

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(emissions.length, 1)
    if (emissions[0]) {
      assert.equal(emissions[0].percent, 30)
      assert.equal(emissions[0].tokens, 3000)
    }

    throttler.dispose()
  })

  it("emitImmediate bypasses debounce and emits immediately", () => {
    const { ContextUsageThrottler } = require("./ContextUsageThrottler.ts")
    const emissions: Array<{ percent: number; tokens: number }> = []
    const throttler = new ContextUsageThrottler(250)

    throttler.onEmit((data: { percent: number; tokens: number }) => emissions.push(data))

    throttler.emitImmediate({ percent: 50, tokens: 5000 })

    assert.equal(emissions.length, 1)
    if (emissions[0]) {
      assert.equal(emissions[0].percent, 50)
      assert.equal(emissions[0].tokens, 5000)
    }

    throttler.dispose()
  })

  it("per-session tracking prevents cross-session interference", async () => {
    const { ContextUsageThrottler } = require("./ContextUsageThrottler.ts")
    const emissions: Array<{ sessionId: string; percent: number }> = []
    const throttler = new ContextUsageThrottler(250)

    throttler.onEmit((data: { sessionId: string; percent: number }) => emissions.push(data))

    throttler.emit({ sessionId: "session-a", percent: 10, tokens: 1000 })
    throttler.emit({ sessionId: "session-b", percent: 20, tokens: 2000 })
    throttler.emit({ sessionId: "session-a", percent: 15, tokens: 1500 })

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(emissions.length, 2)
    const sessionAEmits = emissions.filter((e) => e.sessionId === "session-a")
    const sessionBEmits = emissions.filter((e) => e.sessionId === "session-b")
    assert.equal(sessionAEmits.length, 1)
    assert.equal(sessionBEmits.length, 1)
    if (sessionAEmits[0]) {
      assert.equal(sessionAEmits[0].percent, 15)
    }
    if (sessionBEmits[0]) {
      assert.equal(sessionBEmits[0].percent, 20)
    }

    throttler.dispose()
  })

  it("dispose clears pending timers and prevents further emits", async () => {
    const { ContextUsageThrottler } = require("./ContextUsageThrottler.ts")
    const emissions: Array<{ percent: number }> = []
    const throttler = new ContextUsageThrottler(250)

    throttler.onEmit((data: { percent: number }) => emissions.push(data))

    throttler.emit({ percent: 10, tokens: 1000 })
    throttler.dispose()

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(emissions.length, 0)
  })
})
