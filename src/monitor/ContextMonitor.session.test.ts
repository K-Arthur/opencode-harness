/**
 * Multi-session context-usage persistence (reported bug).
 *
 * ContextMonitor kept a single shared `tokenLimit`, so two tabs on
 * different-context models corrupted each other's percentage: whichever called
 * setTokenLimit last won, and the other session then computed maxTokens/percent
 * against the wrong context window. These tests pin per-session isolation.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ContextMonitor } from "./ContextMonitor"

const bd = (history: number) => ({ system: 0, history, workspace: 0 })

describe("ContextMonitor — per-session token limits", () => {
  it("does not let one session's limit corrupt another's maxTokens/percent", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(200_000, "A")
    m.setTokenLimit(64_000, "B") // shared field would now be 64k

    // A updates AFTER B's limit was set — must still use A's 200k window.
    m.updateTokens(50_000, "A", bd(50_000))
    const a = m.getCurrentUsage("A")!
    assert.equal(a.maxTokens, 200_000, "A keeps its own 200k limit")
    assert.equal(a.percent, 25, "50k/200k = 25%, not 50k/64k")

    m.updateTokens(32_000, "B", bd(32_000))
    const b = m.getCurrentUsage("B")!
    assert.equal(b.maxTokens, 64_000)
    assert.equal(b.percent, 50)

    // B's update must not retroactively change A.
    const a2 = m.getCurrentUsage("A")!
    assert.equal(a2.maxTokens, 200_000)
    assert.equal(a2.percent, 25)
  })

  it("re-emitting after a limit change uses that session's own limit", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(100_000, "A")
    m.updateTokens(40_000, "A", bd(40_000))
    m.setTokenLimit(80_000, "B")
    // Changing A's limit re-emits A against A's new limit, not B's.
    m.setTokenLimit(50_000, "A")
    const a = m.getCurrentUsage("A")!
    assert.equal(a.maxTokens, 50_000)
    assert.equal(a.percent, 80) // 40k/50k
  })
})
