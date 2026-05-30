import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ContextMonitor } from "./ContextMonitor"

const source = readFileSync(path.join(__dirname, "ContextMonitor.ts"), "utf8")

describe("ContextMonitor.ts", () => {
  it("exports ContextUsage interface", () => {
    assert.ok(source.includes("export interface ContextUsage"))
  })

  it("exports ContextMonitor class", () => {
    assert.ok(source.includes("export class ContextMonitor"))
  })

  it("ContextUsage has percent, tokens, maxTokens", () => {
    assert.ok(source.includes("percent: number"))
    assert.ok(source.includes("tokens: number"))
    assert.ok(source.includes("maxTokens: number"))
  })

  it("has onContextChanged event", () => {
    assert.ok(source.includes("onContextChanged"))
  })

  it("has updateTokens method", () => {
    assert.ok(source.includes("updateTokens("))
  })

  it("has showWarning method", () => {
    assert.ok(source.includes("showWarning("))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  // The old 100,000 default was misleading: when a model's context window
  // couldn't be resolved (e.g. opencode/big-pickle with no server limit), the
  // UI showed "X / 100,000" as if that were correct. We now default to 0 and
  // require setTokenLimit() to be called once the actual window is known.
  // The webview hides the context bar when maxTokens <= 0.
  it("defaults tokenLimit to 0 (unknown) so a model-less monitor doesn't leak a fake 100k denominator", () => {
    assert.match(
      source,
      /private\s+tokenLimit\s*=\s*0\b/,
      "tokenLimit must default to 0, not 100000 — the old default leaked into the UI as a misleading denominator",
    )
    assert.ok(
      !/private\s+tokenLimit\s*=\s*100000\b/.test(source),
      "the old 100000 default must be gone — left behind it would still leak via the maxTokens field",
    )
  })

  it("has setTokenLimit method", () => {
    assert.ok(source.includes("setTokenLimit("))
  })

  it("setTokenLimit does not emit sessionless stale usage", () => {
    const idx = source.indexOf("setTokenLimit(")
    assert.ok(idx >= 0, "setTokenLimit must exist")
    const block = source.slice(idx, source.indexOf("\n  /**\n   * Read the autoCompact setting", idx))
    assert.ok(
      !block.includes("this.updateTokens(this.currentTokens)"),
      "setTokenLimit must not re-emit currentTokens without a sessionId"
    )
  })

  it("returns the latest usage for a requested session so the webview can refresh the dropdown on open", () => {
    const monitor = new ContextMonitor()
    monitor.setTokenLimit(200_000, "session-a")
    monitor.updateTokens(50_000, "session-a", {
      system: 500,
      history: 40_000,
      workspace: 9_500,
      queued: 0,
      steer: 0,
    })

    const usage = monitor.getCurrentUsage("session-a")
    assert.equal(usage?.sessionId, "session-a")
    assert.equal(usage?.percent, 25)
    assert.equal(usage?.tokens, 50_000)
    assert.equal(usage?.maxTokens, 200_000)
  })

  it("preserves non-zero fractional percentages instead of collapsing them to 0", () => {
    const monitor = new ContextMonitor()
    monitor.setTokenLimit(1_000_000, "session-a")
    monitor.updateTokens(100, "session-a", {
      system: 0,
      history: 100,
      workspace: 0,
      queued: 0,
      steer: 0,
    })

    const usage = monitor.getCurrentUsage("session-a")
    assert.ok((usage?.percent ?? 0) > 0, "non-zero usage should have a non-zero percent")
    assert.ok((usage?.percent ?? 1) < 1, "tiny usage should remain below 1%")
  })

  it("reads autoCompact setting", () => {
    assert.ok(source.includes("autoCompact"))
  })

  it("has getAutoCompactSetting method", () => {
    assert.ok(source.includes("getAutoCompactSetting("))
  })

  it("has updateQueueTokens method", () => {
    assert.ok(source.includes("updateQueueTokens("), "must have updateQueueTokens method")
    assert.ok(source.includes("queueTokens: number"), "updateQueueTokens must accept queueTokens")
    assert.ok(source.includes("steerTokens: number"), "updateQueueTokens must accept steerTokens")
  })

  it("ContextUsage breakdown includes queued and steer fields", () => {
    assert.ok(source.includes("queued: number"), "breakdown must have queued field")
    assert.ok(source.includes("steer: number"), "breakdown must have steer field")
  })
})
