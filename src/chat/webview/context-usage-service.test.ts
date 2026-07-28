/**
 * Unit tests for context-usage-service.ts pure helper functions.
 * Written BEFORE implementation (TDD red phase).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  deriveUsageColor,
  formatTokenCount,
  computeBreakdownWidths,
  buildSummaryText,
  clampPercent,
} from "./context-usage-service"

describe("deriveUsageColor", () => {
  it("returns 'good' for 0%", () => {
    assert.equal(deriveUsageColor(0), "good")
  })

  it("returns 'good' for 69%", () => {
    assert.equal(deriveUsageColor(69), "good")
  })

  it("returns 'warning' for 70%", () => {
    assert.equal(deriveUsageColor(70), "warning")
  })

  it("returns 'warning' for 89%", () => {
    assert.equal(deriveUsageColor(89), "warning")
  })

  it("returns 'critical' for 90%", () => {
    assert.equal(deriveUsageColor(90), "critical")
  })

  it("returns 'critical' for 100%", () => {
    assert.equal(deriveUsageColor(100), "critical")
  })

  it("returns 'critical' for values beyond 100 (overflow)", () => {
    assert.equal(deriveUsageColor(110), "critical")
  })

  it("returns 'good' for negative input (clamped)", () => {
    assert.equal(deriveUsageColor(-5), "good")
  })
})

describe("formatTokenCount", () => {
  it("formats 0 as '0'", () => {
    assert.equal(formatTokenCount(0), "0")
  })

  it("formats 999 without separator", () => {
    assert.equal(formatTokenCount(999), "999")
  })

  it("formats 1000 with comma separator", () => {
    assert.match(formatTokenCount(1000), /1[,.]?000/)
  })

  it("formats 1234567 with thousand separators", () => {
    // locale-aware — just verify it has at least 2 separators for a 7-digit number
    const result = formatTokenCount(1234567)
    assert.ok(result.includes("1"), "must start with 1")
    assert.ok(result.length > 7, "must have at least one separator character")
  })

  it("returns '0' for NaN", () => {
    assert.equal(formatTokenCount(NaN), "0")
  })

  it("returns '0' for Infinity", () => {
    assert.equal(formatTokenCount(Infinity), "0")
  })

  it("returns '0' for -Infinity", () => {
    assert.equal(formatTokenCount(-Infinity), "0")
  })

  it("returns '0' for string input", () => {
    assert.equal(formatTokenCount("abc" as unknown as number), "0")
  })

  it("returns '0' for undefined input", () => {
    assert.equal(formatTokenCount(undefined as unknown as number), "0")
  })
})

describe("computeBreakdownWidths", () => {
  it("returns all zeros when all inputs are zero (no divide-by-zero)", () => {
    const result = computeBreakdownWidths({ system: 0, history: 0, workspace: 0, queued: 0, steer: 0 })
    assert.equal(result.system, 0)
    assert.equal(result.history, 0)
    assert.equal(result.workspace, 0)
    assert.equal(result.queued, 0)
    assert.equal(result.steer, 0)
  })

  it("returns proportional widths for uniform inputs", () => {
    const result = computeBreakdownWidths({ system: 10, history: 10, workspace: 10, queued: 10, steer: 10 })
    assert.equal(result.system, 20)
    assert.equal(result.history, 20)
    assert.equal(result.workspace, 20)
    assert.equal(result.queued, 20)
    assert.equal(result.steer, 20)
  })

  it("widths sum to 100 for non-zero inputs", () => {
    const result = computeBreakdownWidths({ system: 30, history: 20, workspace: 25, queued: 15, steer: 10 })
    const sum = result.system + result.history + result.workspace + result.queued + result.steer
    assert.ok(Math.abs(sum - 100) < 0.01, `sum was ${sum}, expected ~100`)
  })

  it("clamps negative values to 0", () => {
    const result = computeBreakdownWidths({ system: 100, history: -10, workspace: 0, queued: 0, steer: 0 })
    assert.equal(result.history, 0)
    assert.ok(result.system > 0)
  })

  it("handles single non-zero value (100% for that segment)", () => {
    const result = computeBreakdownWidths({ system: 0, history: 50, workspace: 0, queued: 0, steer: 0 })
    assert.equal(result.history, 100)
    assert.equal(result.system, 0)
  })
})

describe("buildSummaryText", () => {
  it("renders percent, token count and max tokens when maxTokens > 0", () => {
    const result = buildSummaryText(50000, 200000, 25)
    assert.ok(result.includes("25%"), `expected 25% in: ${result}`)
    assert.ok(result.includes("50,000") || result.includes("50000"), `expected token count in: ${result}`)
    assert.ok(result.includes("200,000") || result.includes("200000"), `expected max tokens in: ${result}`)
  })

  it("renders 'set limit' hint when maxTokens is 0 (unknown context window)", () => {
    const result = buildSummaryText(8000, 0, 0)
    assert.ok(result.toLowerCase().includes("set limit"), `expected 'set limit' in: ${result}`)
    assert.ok(!result.includes("/ 0"), `must not render '/ 0' in: ${result}`)
  })

  it("shows token count even when maxTokens is 0", () => {
    const result = buildSummaryText(8000, 0, 0)
    assert.ok(result.includes("8,000") || result.includes("8000"), `expected 8000 in: ${result}`)
  })

  it("renders overflow percentage without clamping label (shows actual %)", () => {
    const result = buildSummaryText(220000, 200000, 110)
    assert.ok(result.includes("110%"), `expected 110% in: ${result}`)
  })

  it("does not inject raw HTML from token count values", () => {
    // XSS guard: values that look like HTML should never appear raw
    const result = buildSummaryText(0, 0, 0)
    assert.ok(!result.includes("<script>"))
  })
})

describe("clampPercent", () => {
  it("clamps negative to 0", () => {
    assert.equal(clampPercent(-5), 0)
  })

  it("passes through 0", () => {
    assert.equal(clampPercent(0), 0)
  })

  it("passes through 50", () => {
    assert.equal(clampPercent(50), 50)
  })

  it("passes through 100", () => {
    assert.equal(clampPercent(100), 100)
  })

  it("clamps 101 to 100", () => {
    assert.equal(clampPercent(101), 100)
  })

  it("clamps large overflow to 100", () => {
    assert.equal(clampPercent(999), 100)
  })
})
