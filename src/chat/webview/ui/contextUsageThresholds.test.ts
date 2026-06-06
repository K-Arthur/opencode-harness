import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { deriveState, CONTEXT_THRESHOLDS } from "./contextUsageThresholds"

describe("contextUsageThresholds", () => {
  describe("CONTEXT_THRESHOLDS", () => {
    it("exports frozen threshold values", () => {
      assert.equal(CONTEXT_THRESHOLDS.CAUTION, 70)
      assert.equal(CONTEXT_THRESHOLDS.WARNING, 85)
      assert.equal(CONTEXT_THRESHOLDS.CRITICAL, 95)
    })
  })

  describe("deriveState", () => {
    it("returns 'good' for low usage", () => {
      assert.equal(deriveState(0, 0, 100_000), "good")
      assert.equal(deriveState(50, 50_000, 100_000), "good")
      assert.equal(deriveState(69, 69_000, 100_000), "good")
    })

    it("returns 'caution' at 70-84%", () => {
      assert.equal(deriveState(70, 70_000, 100_000), "caution")
      assert.equal(deriveState(80, 80_000, 100_000), "caution")
      assert.equal(deriveState(84, 84_000, 100_000), "caution")
    })

    it("returns 'warning' at 85-94%", () => {
      assert.equal(deriveState(85, 85_000, 100_000), "warning")
      assert.equal(deriveState(90, 90_000, 100_000), "warning")
      assert.equal(deriveState(94, 94_000, 100_000), "warning")
    })

    it("returns 'critical' at 95-100%", () => {
      assert.equal(deriveState(95, 95_000, 100_000), "critical")
      assert.equal(deriveState(99, 99_000, 100_000), "critical")
      assert.equal(deriveState(100, 100_000, 100_000), "critical")
    })

    it("returns 'over' when tokens exceed maxTokens", () => {
      assert.equal(deriveState(50, 150_000, 100_000), "over")
      assert.equal(deriveState(10, 200_000, 100_000), "over")
    })

    it("returns 'unknown' for non-finite percent", () => {
      assert.equal(deriveState(NaN, 0, 100_000), "unknown")
      assert.equal(deriveState(Infinity, 0, 100_000), "unknown")
    })

    it("returns 'good' when maxTokens is 0 (unknown window, no color class applied)", () => {
      assert.equal(deriveState(0, 0, 0), "good")
    })
  })
})
