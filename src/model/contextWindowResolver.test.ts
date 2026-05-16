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
})
