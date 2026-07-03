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
import { ContextMonitor, type ContextUsage } from "./ContextMonitor"

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

  // Bug: setTokenLimit(limit, sessionId) also refreshed the SHARED sessionless
  // default, so a session that never resolved its own window silently computed
  // percent against whichever tab's model resolved last. Combined with the
  // shared currentTokens this produced tokens_A / limit_B ratios that clamped
  // to a bogus 100% in the status bar.
  it("a per-session limit does not become another session's fallback window", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(64_000, "B")
    m.updateTokens(10_000, "C", bd(10_000))
    const c = m.getCurrentUsage("C")!
    assert.equal(c.maxTokens, 0, "C has no window of its own — it must not inherit B's 64k")
    assert.equal(c.percent, 0, "unknown window must report 0%, not a ratio against B's limit")
    m.dispose()
  })
})

describe("ContextMonitor — per-session boundary re-emits", () => {
  const bdFull = (history: number) => ({ system: 0, history, workspace: 0, queued: 0, steer: 0 })

  it("emitLatestForSession re-emits that session's own snapshot and preserves source", () => {
    const m = new ContextMonitor()
    const events: ContextUsage[] = []
    m.onContextChanged((e) => events.push(e))

    m.setTokenLimit(200_000, "A")
    m.setTokenLimit(64_000, "B")
    m.updateTokens(50_000, "A", undefined, { source: "actual", immediate: true })
    // B updates AFTER A — under the old shared currentTokens/tokenLimit this
    // is what leaked B's figures into A's stream-boundary emits.
    m.updateTokens(60_000, "B", bdFull(60_000), { immediate: true })

    events.length = 0
    assert.equal(m.emitLatestForSession("A"), true)
    assert.equal(events.length, 1)
    const e = events[0]!
    assert.equal(e.sessionId, "A")
    assert.equal(e.tokens, 50_000, "must re-emit A's own tokens, not the last-updated session's")
    assert.equal(e.maxTokens, 200_000, "must use A's own window, not B's")
    assert.equal(e.percent, 25)
    assert.equal(e.source, "actual", "re-emitting stored API-reported usage must not downgrade it to estimated")
    m.dispose()
  })

  it("emitLatestForSession is a no-op for sessions with no recorded usage", () => {
    const m = new ContextMonitor()
    const events: ContextUsage[] = []
    m.onContextChanged((e) => events.push(e))
    assert.equal(m.emitLatestForSession("ghost"), false)
    assert.equal(events.length, 0, "must not fabricate an empty/foreign snapshot for an unknown session")
    m.dispose()
  })

  // Compaction shrinks the conversation, not the model — resetSession must
  // drop the stale (high) token count but KEEP the session's own window, or
  // the first post-compaction update computes percent against maxTokens 0
  // ("set limit" flicker) until the model re-resolves.
  it("resetSession clears stale usage but keeps the session's own context window", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(200_000, "A")
    m.updateTokens(180_000, "A", bdFull(180_000), { immediate: true })
    m.resetSession("A")
    assert.equal(m.getCurrentUsage("A"), undefined, "pre-compaction fill must be gone")
    m.updateTokens(20_000, "A", bdFull(20_000), { immediate: true })
    const a = m.getCurrentUsage("A")!
    assert.equal(a.maxTokens, 200_000, "the window belongs to the model and must survive compaction")
    assert.equal(a.percent, 10)
    m.dispose()
  })

  it("clearSession removes both usage and window (tab closed)", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(200_000, "A")
    m.updateTokens(50_000, "A", bdFull(50_000), { immediate: true })
    m.clearSession("A")
    assert.equal(m.getCurrentUsage("A"), undefined)
    assert.equal(m.limitFor("A"), m.limitFor(undefined), "closed tab must not pin a per-session window")
    m.dispose()
  })

  it("re-emitting one session never mutates another session's snapshot", () => {
    const m = new ContextMonitor()
    m.setTokenLimit(200_000, "A")
    m.setTokenLimit(64_000, "B")
    m.updateTokens(50_000, "A", bdFull(50_000), { immediate: true })
    m.updateTokens(32_000, "B", bdFull(32_000), { immediate: true })

    m.emitLatestForSession("A")
    const b = m.getCurrentUsage("B")!
    assert.equal(b.tokens, 32_000)
    assert.equal(b.maxTokens, 64_000)
    assert.equal(b.percent, 50)
    m.dispose()
  })
})
