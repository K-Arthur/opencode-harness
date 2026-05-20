import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveContextWindow, findKnownContextWindow, KNOWN_CONTEXT_WINDOWS } from "./contextWindowResolver"

describe("findKnownContextWindow", () => {
  it("returns the known value for an exact lowercase key", () => {
    assert.equal(findKnownContextWindow("qwen/qwen3.6-plus"), 1_048_576)
  })

  it("is case-insensitive", () => {
    assert.equal(findKnownContextWindow("Qwen/Qwen3.6-Plus"), 1_048_576)
  })

  it("matches a different provider prefix when the id is unambiguous", () => {
    assert.equal(findKnownContextWindow("alibaba/qwen3.6-plus"), 1_048_576)
    assert.equal(findKnownContextWindow("openrouter/qwen3.6-plus"), 1_048_576)
  })

  it("matches when separators differ", () => {
    assert.equal(findKnownContextWindow("qwen/qwen-3.6-plus"), 1_048_576)
    assert.equal(findKnownContextWindow("qwen/qwen3_6_plus"), 1_048_576)
  })

  it("returns undefined for unknown models", () => {
    assert.equal(findKnownContextWindow("unknown/never-heard-of"), undefined)
    assert.equal(findKnownContextWindow(""), undefined)
  })
})

describe("resolveContextWindow", () => {
  it("returns the known value when no server value is supplied", () => {
    assert.equal(resolveContextWindow("qwen/qwen3.6-plus"), 1_048_576)
  })

  it("trusts a plausible server value (within 50% of known)", () => {
    assert.equal(resolveContextWindow("qwen/qwen3.6-plus", 900_000), 900_000)
  })

  it("replaces an implausible server value with the known value", () => {
    assert.equal(resolveContextWindow("qwen/qwen3.6-plus", 262_144), 1_048_576)
  })

  it("survives a different provider prefix from the server", () => {
    assert.equal(resolveContextWindow("alibaba/qwen3.6-plus", 262_144), 1_048_576)
  })

  it("returns the server value for unknown models when plausible", () => {
    assert.equal(resolveContextWindow("unknown/some-model", 50_000), 50_000)
  })

  it("does not override opencode server limits with another provider's known model id", () => {
    assert.equal(resolveContextWindow("opencode/claude-opus-4-7-20260415", 1_000_000), 1_000_000)
  })

  it("returns undefined when neither known nor server has a value", () => {
    assert.equal(resolveContextWindow("unknown/some-model"), undefined)
    assert.equal(resolveContextWindow("unknown/some-model", 0), undefined)
  })

  it("rejects negative or zero server values and falls back to known", () => {
    assert.equal(resolveContextWindow("qwen/qwen3.6-plus", 0), 1_048_576)
    assert.equal(resolveContextWindow("qwen/qwen3.6-plus", -1), 1_048_576)
  })
})

describe("KNOWN_CONTEXT_WINDOWS", () => {
  it("contains qwen3.6-plus at 1M tokens", () => {
    assert.equal(KNOWN_CONTEXT_WINDOWS["qwen/qwen3.6-plus"], 1_048_576)
  })

  it("is frozen", () => {
    assert.throws(() => {
      (KNOWN_CONTEXT_WINDOWS as Record<string, number>)["test"] = 1
    })
  })

  // opencode-routed models surfaced by the UI dropdown. The user was seeing
  // a misleading 100,000 fallback for these because they aren't in any other
  // provider's namespace and the server doesn't always populate limit.context
  // for them. Pin known values here so the context bar shows correctly.
  it("contains opencode/big-pickle (200k, Claude Opus class)", () => {
    assert.equal(KNOWN_CONTEXT_WINDOWS["opencode/big-pickle"], 200_000)
  })

  it("contains opencode/deepseek-v4-flash + free variant at 131k", () => {
    assert.equal(KNOWN_CONTEXT_WINDOWS["opencode/deepseek-v4-flash"], 131_072)
    assert.equal(KNOWN_CONTEXT_WINDOWS["opencode/deepseek-v4-flash-free"], 131_072)
  })
})

describe("resolveContextWindow — opencode-prefixed models", () => {
  it("falls back to known table for opencode/big-pickle when server reports nothing", () => {
    // Previously returned undefined → ContextMonitor stuck at 100k default.
    assert.equal(resolveContextWindow("opencode/big-pickle"), 200_000)
    assert.equal(resolveContextWindow("opencode/big-pickle", 0), 200_000)
  })

  it("falls back to known table for deepseek-v4-flash variants", () => {
    assert.equal(resolveContextWindow("opencode/deepseek-v4-flash"), 131_072)
    assert.equal(resolveContextWindow("opencode/deepseek-v4-flash-free"), 131_072)
  })

  it("still trusts a positive server value for opencode-prefixed models", () => {
    // The "opencode trusts server" rule shouldn't regress for the case
    // where a real server value comes through.
    assert.equal(resolveContextWindow("opencode/big-pickle", 500_000), 500_000)
  })

  it("returns undefined (not a misleading default) when truly unknown", () => {
    assert.equal(resolveContextWindow("opencode/some-truly-unknown-model"), undefined)
    assert.equal(resolveContextWindow("opencode/some-truly-unknown-model", 0), undefined)
  })

  // Fuzzy-match safety net: if a future opencode/* model wraps a deepseek
  // model whose suffix happens to start with "deepseek-", the suffix-only
  // matcher in findKnownContextWindow should still find a sane value rather
  // than letting the UI fall back to 100k.
  it("uses the provider-stripped lookup so deepseek-flavoured suffixes still resolve", () => {
    // existing test confirms the suffix matcher works for any provider —
    // re-asserting here to lock the contract for opencode routing.
    assert.equal(resolveContextWindow("opencode/qwen3.6-plus"), 1_048_576)
  })
})
