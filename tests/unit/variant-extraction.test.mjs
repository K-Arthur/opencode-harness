import { describe, it } from "node:test"
import assert from "node:assert/strict"

/**
 * Behavioral tests for variant name extraction from server model data.
 * The logic lives in ModelManager.fetchModelsFromServer — tested here in isolation.
 */

function extractVariantNames(variants) {
  if (!variants || typeof variants !== "object") return undefined
  const names = Object.keys(variants).filter(k => {
    const v = variants[k]
    return v && typeof v === "object" && v.disabled !== true
  })
  return names.length > 0 ? names : undefined
}

describe("variant extraction from server model data", () => {
  it("returns variant names from a normal variants map", () => {
    const result = extractVariantNames({
      high: { reasoningEffort: "high" },
      low: { reasoningEffort: "low" },
    })
    assert.deepEqual(result, ["high", "low"])
  })

  it("filters out disabled variants", () => {
    const result = extractVariantNames({
      high: { reasoningEffort: "high" },
      fast: { disabled: true },
      low: { reasoningEffort: "low" },
    })
    assert.deepEqual(result, ["high", "low"])
  })

  it("returns undefined for null variants", () => {
    assert.equal(extractVariantNames(null), undefined)
  })

  it("returns undefined for undefined variants", () => {
    assert.equal(extractVariantNames(undefined), undefined)
  })

  it("returns undefined for empty variants object", () => {
    assert.equal(extractVariantNames({}), undefined)
  })

  it("returns undefined when all variants are disabled", () => {
    const result = extractVariantNames({
      fast: { disabled: true },
      slow: { disabled: true },
    })
    assert.equal(result, undefined)
  })

  it("handles variants with non-object values gracefully", () => {
    const result = extractVariantNames({
      high: { reasoningEffort: "high" },
      bad: "not-an-object",
      low: { reasoningEffort: "low" },
    })
    assert.deepEqual(result, ["high", "low"])
  })

  it("handles variants with null values gracefully", () => {
    const result = extractVariantNames({
      high: { reasoningEffort: "high" },
      empty: null,
      low: { reasoningEffort: "low" },
    })
    assert.deepEqual(result, ["high", "low"])
  })

  it("preserves server-provided variant names exactly (case-sensitive)", () => {
    const result = extractVariantNames({
      XHigh: { reasoningEffort: "xhigh" },
      Minimal: {},
    })
    assert.deepEqual(result, ["XHigh", "Minimal"])
  })

  it("handles third-party provider custom variant names", () => {
    const result = extractVariantNames({
      thinking: { type: "enabled", budgetTokens: 16000 },
      flash: { temperature: 0 },
      turbo: { maxTokens: 1024 },
    })
    assert.deepEqual(result, ["thinking", "flash", "turbo"])
  })

  it("handles Anthropic-style built-in variants", () => {
    const result = extractVariantNames({
      high: { thinking: { type: "enabled", budgetTokens: 10000 } },
      max: { thinking: { type: "enabled", budgetTokens: 32000 } },
    })
    assert.deepEqual(result, ["high", "max"])
  })

  it("handles OpenAI-style built-in variants", () => {
    const result = extractVariantNames({
      none: { reasoningEffort: "none" },
      minimal: { reasoningEffort: "minimal" },
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
      xhigh: { reasoningEffort: "xhigh" },
    })
    assert.deepEqual(result, ["none", "minimal", "low", "medium", "high", "xhigh"])
  })
})
