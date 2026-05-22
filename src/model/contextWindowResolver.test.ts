import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveContextWindow, findKnownContextWindow, KNOWN_CONTEXT_WINDOWS } from "./contextWindowResolver"

// The resolver is now a thin server-trust shim — no hardcoded context
// windows. These tests pin that contract: when the server supplies a
// positive limit.context we return it; otherwise undefined, and a log
// line surfaces the gap so operators can notice.

describe("resolveContextWindow (server-only)", () => {
  it("returns the server value when it is a positive number", () => {
    assert.equal(resolveContextWindow("anthropic/claude-anything", 200_000), 200_000)
    assert.equal(resolveContextWindow("opencode/some-model", 1), 1)
    assert.equal(resolveContextWindow("provider/m", 4_096_000), 4_096_000)
  })

  it("returns undefined when the server supplies no value (0, undefined, NaN, negative)", () => {
    assert.equal(resolveContextWindow("anthropic/claude-anything"), undefined)
    assert.equal(resolveContextWindow("anthropic/claude-anything", 0), undefined)
    assert.equal(resolveContextWindow("anthropic/claude-anything", -1), undefined)
    assert.equal(resolveContextWindow("anthropic/claude-anything", NaN), undefined)
  })

  it("emits a log line when the server didn't supply a value so the gap is visible", () => {
    const lines: string[] = []
    const out = resolveContextWindow("provider/x", undefined, { log: (m) => lines.push(m) })
    assert.equal(out, undefined)
    assert.equal(lines.length, 1)
    assert.match(lines[0]!, /server did not report limit\.context/)
  })

  it("does NOT log when the server supplied a usable value (no spurious noise)", () => {
    const lines: string[] = []
    resolveContextWindow("provider/x", 200_000, { log: (m) => lines.push(m) })
    assert.equal(lines.length, 0)
  })

  it("tolerates an empty modelKey without throwing", () => {
    assert.equal(resolveContextWindow("", 0), undefined)
    assert.equal(resolveContextWindow("", 100), 100)
  })
})

describe("findKnownContextWindow — deprecated shim", () => {
  // Kept for source-compat with older importers; always returns undefined.
  it("always returns undefined (no hardcoded table)", () => {
    assert.equal(findKnownContextWindow("anthropic/claude-opus"), undefined)
    assert.equal(findKnownContextWindow("anything/at/all"), undefined)
    assert.equal(findKnownContextWindow(""), undefined)
  })
})

describe("KNOWN_CONTEXT_WINDOWS — deprecated empty table", () => {
  it("is an empty frozen object — no hardcoded values", () => {
    assert.equal(Object.keys(KNOWN_CONTEXT_WINDOWS).length, 0)
    assert.throws(() => {
      ;(KNOWN_CONTEXT_WINDOWS as Record<string, number>)["x"] = 1
    })
  })
})
