import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ModelCapabilities } from "../methodology/types"
import { estimateCapabilities, type ModelMetadata } from "./capabilityEstimator"

describe("estimateCapabilities", () => {
  // ── Known models ──────────────────────────────────────────────────────

  it("returns S-tier profile for known flagship model (claude-opus)", () => {
    const meta: ModelMetadata = {
      id: "anthropic/claude-opus-4-7",
      provider: "anthropic",
      supportsReasoning: true,
      contextWindow: 200000,
    }
    const caps = estimateCapabilities(meta)
    assert.ok(caps.reasoning >= 0.9, "opus should have high reasoning")
    assert.ok(caps.autonomy >= 0.9, "opus should have high autonomy")
    assert.equal(caps.confidenceSources.reasoning, "verified", "reasoning flag makes reasoning verified")
  })

  it("returns A-tier profile for known mid-range model (deepseek-v4-flash)", () => {
    const meta: ModelMetadata = {
      id: "deepseek/deepseek-v4-flash",
      provider: "deepseek",
      supportsReasoning: false,
      contextWindow: 1000000,
    }
    const caps = estimateCapabilities(meta)
    assert.ok(caps.reasoning >= 0.7, "flash should have decent reasoning")
    assert.ok(caps.contextUtilization >= 0.7, "1M context should boost contextUtilization")
    assert.ok(caps.throughput >= 0.7, "deepseek provider should boost throughput")
    // DeepSeek V4 Flash registered as A-tier: reasoning 0.8 + 0 from no-reasoning flag
    assert.equal(caps.confidenceSources.reasoning, "fallback", "no reasoning flag → fallback source")
    assert.equal(caps.confidenceSources.contextUtilization, "inferred", "context-driven → inferred")
  })

  it("honors reasoning flag boost for known model", () => {
    const metaYes: ModelMetadata = {
      id: "anthropic/claude-haiku-4-5",
      provider: "anthropic",
      supportsReasoning: true,
    }
    const metaNo: ModelMetadata = {
      id: "anthropic/claude-haiku-4-5",
      provider: "anthropic",
      supportsReasoning: false,
    }
    const withReasoning = estimateCapabilities(metaYes)
    const withoutReasoning = estimateCapabilities(metaNo)
    assert.ok(withReasoning.reasoning > withoutReasoning.reasoning,
      "reasoning flag should boost reasoning score")
    assert.equal(withReasoning.confidenceSources.reasoning, "verified",
      "reasoning flag → verified source")
    assert.equal(withoutReasoning.confidenceSources.reasoning, "fallback",
      "no reasoning flag → fallback source")
  })

  // ── Unknown models (not in static registry) ───────────────────────────

  it("returns conservative fallback profile for entirely unknown model", () => {
    const meta: ModelMetadata = {
      id: "zzzzz/zzzzz-unknown-private-model-v99",
      provider: "custom",
      displayName: "My Private Model",
    }
    const caps = estimateCapabilities(meta)
    // resolveOrInfer returns the constant FALLBACK_CAPABILITIES for unrecognised
    // models: reasoning=0.6, coding=0.6, etc. No metadata → all stay 'fallback'.
    assert.ok(caps.reasoning >= 0.5, "unknown model should have conservative reasoning")
    assert.equal(caps.coding, 0.6, "unknown model should have fallback coding=0.6")
    assert.equal(caps.confidenceSources.reasoning, "fallback", "unknown → fallback")
    assert.equal(caps.confidenceSources.coding, "fallback", "unknown → fallback")
  })

  it("applies reasoning boost even for unknown model when flag is true", () => {
    const meta: ModelMetadata = {
      id: "custom/my-private-model-v1",
      provider: "custom",
      supportsReasoning: true,
    }
    const caps = estimateCapabilities(meta)
    // Baseline 0.5 + 0.15 reasoning boost
    assert.ok(caps.reasoning >= 0.6, "reasoning flag should boost unknown model")
    assert.ok(caps.autonomy >= 0.55, "reasoning flag should boost autonomy")
    assert.equal(caps.confidenceSources.reasoning, "verified", "reasoning flag → verified even for unknown")
  })

  it("applies context window boost for unknown model with large context", () => {
    const meta: ModelMetadata = {
      id: "custom/big-context-model",
      provider: "custom",
      contextWindow: 1000000,
    }
    const caps = estimateCapabilities(meta)
    assert.ok(caps.contextUtilization >= 0.8, "1M context should boost contextUtilization to ≥0.85")
    assert.equal(caps.confidenceSources.contextUtilization, "inferred", "context-driven → inferred")
    assert.equal(caps.confidenceSources.knowledge, "inferred", "context-driven → inferred")
  })

  // ── Context window edge cases ─────────────────────────────────────────

  it("adjusts for moderate context window (100K-500K)", () => {
    const meta: ModelMetadata = {
      id: "test/moderate-context",
      contextWindow: 128000,
    }
    const caps = estimateCapabilities(meta)
    assert.ok(caps.contextUtilization >= 0.7, "128K context should set contextUtilization ≥0.7")
  })

  it("does not boost contextUtilization for tiny context window", () => {
    const meta: ModelMetadata = {
      id: "zzzzz/tiny-context-model",
      contextWindow: 8000,
    }
    const caps = estimateCapabilities(meta)
    // Small context (8K < 100K threshold) doesn't trigger boost
    // Fallback contextUtilization is 0.55 (from FALLBACK_CAPABILITIES)
    assert.ok(caps.contextUtilization <= 0.55, "small context should not boost above fallback")
  })

  // ── Provider heuristics ───────────────────────────────────────────────

  it("boosts throughput for known-cheap providers (deepseek)", () => {
    const meta: ModelMetadata = {
      id: "zzzzz/deepseek-type-model",
      provider: "deepseek",
    }
    const caps = estimateCapabilities(meta)
    // Baseline 0.5 + 0.08 deepseek boost = 0.58
    assert.ok(caps.throughput >= 0.55, "deepseek provider should boost throughput")
  })

  it("boosts throughput for mistral provider", () => {
    const meta: ModelMetadata = {
      id: "zzzzz/mistral-type-model",
      provider: "mistral",
    }
    const caps = estimateCapabilities(meta)
    // Baseline 0.5 + 0.08 mistral boost = 0.58
    assert.ok(caps.throughput >= 0.55, "mistral provider should boost throughput")
  })

  it("does not artificially boost throughput for non-budget providers", () => {
    const meta: ModelMetadata = {
      id: "zzzzz/unknown-provider-model",
      provider: "anthropic",
    }
    const caps = estimateCapabilities(meta)
    // Fallback throughput is 0.6 (from FALLBACK_CAPABILITIES), no boost applied
    assert.equal(caps.throughput, 0.6, "anthropic should keep fallback throughput, no boost")
    assert.equal(caps.confidenceSources.throughput, "fallback", "no boost → fallback source")
  })

  // ── Combined metadata ─────────────────────────────────────────────────

  it("combines reasoning + context + provider boosts correctly", () => {
    const meta: ModelMetadata = {
      id: "deepseek/deepseek-v4-flash",
      provider: "deepseek",
      supportsReasoning: false,
      contextWindow: 1000000,
    }
    const caps = estimateCapabilities(meta)
    // A-tier base + 1M context boost + deepseek throughput boost
    assert.ok(caps.reasoning >= 0.7, "should have A-tier reasoning")
    assert.ok(caps.contextUtilization >= 0.8, "1M context should push contextUtilization up")
    assert.ok(caps.throughput >= 0.75, "A-tier + deepseek boost should push throughput up")
  })

  // ── Edge cases and invariants ─────────────────────────────────────────

  it("never returns scores > 1.0", () => {
    const meta: ModelMetadata = {
      id: "test/extreme",
      supportsReasoning: true,
      contextWindow: 1000000,
      provider: "deepseek",
    }
    const caps = estimateCapabilities(meta)
    const numericKeys: (keyof ModelCapabilities)[] = [
      "reasoning", "coding", "knowledge", "instructionFollowing",
      "toolUse", "vision", "contextUtilization",
      "autonomy", "throughput", "visualJudgment",
    ]
    for (const key of numericKeys) {
      const val = caps[key] as number
      assert.ok(typeof val === "number", `${key} must be a number`)
      assert.ok(val <= 1.0, `${key} must be ≤ 1.0, got ${val}`)
    }
  })

  it("never returns scores < 0.0", () => {
    const meta: ModelMetadata = { id: "test/unknown" }
    const caps = estimateCapabilities(meta)
    const numericKeys: (keyof ModelCapabilities)[] = [
      "reasoning", "coding", "knowledge", "instructionFollowing",
      "toolUse", "vision", "contextUtilization",
      "autonomy", "throughput", "visualJudgment",
    ]
    for (const key of numericKeys) {
      const val = caps[key] as number
      assert.ok(typeof val === "number", `${key} must be a number`)
      assert.ok(val >= 0.0, `${key} must be ≥ 0.0, got ${val}`)
    }
  })

  it("always includes all 10 capability axes", () => {
    const meta: ModelMetadata = { id: "test/all-axes" }
    const caps = estimateCapabilities(meta)
    const expectedAxes = [
      "reasoning", "coding", "knowledge", "instructionFollowing",
      "toolUse", "vision", "contextUtilization",
      "autonomy", "throughput", "visualJudgment",
    ]
    for (const axis of expectedAxes) {
      assert.ok(typeof caps[axis as keyof ModelCapabilities] === 'number',
        `${axis} must be present and numeric`)
    }
  })

  it("always populates confidenceSources for all 10 axes", () => {
    const meta: ModelMetadata = { id: "test/confidence" }
    const caps = estimateCapabilities(meta)
    const expectedSources: (keyof ModelCapabilities)[] = [
      "reasoning", "coding", "knowledge", "instructionFollowing",
      "toolUse", "vision", "contextUtilization",
      "autonomy", "throughput", "visualJudgment",
    ]
    for (const axis of expectedSources) {
      const source = caps.confidenceSources[axis]
      assert.ok(source !== undefined, `${axis} must have a confidenceSource`)
    }
  })
})
