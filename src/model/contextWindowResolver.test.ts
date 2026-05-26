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

describe("resolveContextWindow — OpenRouter cache fallback (0.2.15)", () => {
  it("consults the OpenRouter cache when the server didn't supply a value", () => {
    const cache = new Map<string, number>([
      ["moonshotai/kimi-k2.5", 200_000],
      ["kimi-k2.5", 200_000],
    ])
    // The exact server-reported key wins.
    assert.equal(
      resolveContextWindow("moonshotai/kimi-k2.5", undefined, { openRouterCache: cache }),
      200_000,
    )
  })

  it("falls back to the short id when the provider prefix differs (cross-provider lookup)", () => {
    // Same model weights, different host: the prefix doesn't match but
    // the short id does. This is the whole reason we built the
    // OpenRouter fallback.
    const cache = new Map<string, number>([
      ["moonshotai/kimi-k2.5", 200_000],
      ["kimi-k2.5", 200_000],
    ])
    assert.equal(
      resolveContextWindow("openrouter/kimi-k2.5", undefined, { openRouterCache: cache }),
      200_000,
    )
  })

  it("uses the OpenRouter lookup helper for case-insensitive short-id hits", () => {
    const cache = new Map<string, number>([
      ["MoonshotAI/Kimi-K2.5", 200_000],
    ])
    assert.equal(
      resolveContextWindow("openrouter/kimi-k2.5", undefined, { openRouterCache: cache }),
      200_000,
    )
  })

  it("server-reported value still wins over the cache (server is authoritative)", () => {
    const cache = new Map<string, number>([["kimi-k2.5", 1_000_000]])
    // Server says 200k, cache says 1M. Trust the server.
    assert.equal(
      resolveContextWindow("anyhost/kimi-k2.5", 200_000, { openRouterCache: cache }),
      200_000,
    )
  })

  it("returns undefined and logs when both server and cache come up empty", () => {
    const lines: string[] = []
    const cache = new Map<string, number>([["totally-different/model", 1]])
    const out = resolveContextWindow("opencode/proprietary-model", undefined, {
      openRouterCache: cache,
      log: (m) => lines.push(m),
    })
    assert.equal(out, undefined)
    assert.equal(lines.length, 1, "should log the miss so operators can notice")
    assert.match(lines[0]!, /no OpenRouter fallback hit/, "log line must reflect that fallback also failed")
  })

  it("does not log when the cache hits — silence on the happy path", () => {
    const lines: string[] = []
    const cache = new Map<string, number>([["kimi-k2.5", 200_000]])
    resolveContextWindow("anyhost/kimi-k2.5", undefined, {
      openRouterCache: cache,
      log: (m) => lines.push(m),
    })
    assert.equal(lines.length, 0)
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
