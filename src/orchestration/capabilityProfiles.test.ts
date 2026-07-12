import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ModelCapabilities } from "../methodology/types"
import {
  deriveAutonomyScore,
  deriveThroughputScore,
  deriveVisualJudgmentScore,
  getAutonomyGuidance,
  computeRoleSuitability,
  bestRoleForModel,
  isCapableForRole,
  scoreFromCanary,
  mergeCanaryIntoCapabilities,
  type CanaryProbeConfig,
} from "./capabilityProfiles"

function makeCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    reasoning: 0.7,
    coding: 0.7,
    knowledge: 0.6,
    instructionFollowing: 0.7,
    toolUse: 0.6,
    vision: 0.5,
    contextUtilization: 0.6,
    autonomy: 0.6,
    throughput: 0.6,
    visualJudgment: 0.5,
    confidenceSources: {},
    ...overrides,
  }
}

describe("deriveAutonomyScore", () => {
  it("returns high score for strong reasoning + tool use", () => {
    const score = deriveAutonomyScore(makeCapabilities({ reasoning: 0.9, toolUse: 0.9 }))
    assert.ok(score >= 0.8)
  })

  it("returns low score for weak reasoning", () => {
    const score = deriveAutonomyScore(makeCapabilities({ reasoning: 0.1, toolUse: 0.1, autonomy: 0.1, instructionFollowing: 0.1 }))
    assert.ok(score < 0.3)
  })

  it("returns clamped value between 0 and 1", () => {
    const score = deriveAutonomyScore(makeCapabilities({ reasoning: 5, toolUse: 5, autonomy: 5, instructionFollowing: 5 }))
    assert.equal(score, 1)
  })
})

describe("deriveThroughputScore", () => {
  it("returns higher score for strong coding + instruction following", () => {
    const high = deriveThroughputScore(makeCapabilities({ throughput: 0.9, coding: 0.9 }))
    const low = deriveThroughputScore(makeCapabilities({ throughput: 0.1, coding: 0.1 }))
    assert.ok(high > low)
  })
})

describe("deriveVisualJudgmentScore", () => {
  it("returns higher score for strong visual judgment + vision", () => {
    const high = deriveVisualJudgmentScore(makeCapabilities({ visualJudgment: 0.9, vision: 0.9 }))
    const low = deriveVisualJudgmentScore(makeCapabilities({ visualJudgment: 0.1, vision: 0.1 }))
    assert.ok(high > low)
  })
})

describe("getAutonomyGuidance", () => {
  it("returns S-tier guidance for high autonomy", () => {
    const g = getAutonomyGuidance(makeCapabilities({ autonomy: 0.9, reasoning: 0.9 }), undefined)
    assert.equal(g.delegationStrategy, "direct")
    assert.equal(g.requireTestPerStep, false)
  })

  it("returns C-tier guidance for low autonomy", () => {
    const g = getAutonomyGuidance(makeCapabilities({ autonomy: 0.1, reasoning: 0.1 }), undefined)
    assert.equal(g.delegationStrategy, "microstep")
    assert.equal(g.requireTestPerStep, true)
    assert.equal(g.checkpointEveryNSteps, 1)
  })

  it("falls back to B-tier when no capabilities", () => {
    const g = getAutonomyGuidance(undefined, undefined)
    assert.equal(g.delegationStrategy, "scoped")
  })
})

describe("computeRoleSuitability", () => {
  it("ranks roles by capability match", () => {
    const strongBackend = makeCapabilities({
      coding: 0.9,
      toolUse: 0.8,
      reasoning: 0.9,
      instructionFollowing: 0.9,
    })
    const results = computeRoleSuitability("test/model", strongBackend)
    assert.ok(results.length > 0)
    const first = results[0]
    const last = results[results.length - 1]
    assert.ok(first && last && first.score >= last.score)
  })

  it("reports strengths and limiting factors", () => {
    const caps = makeCapabilities({ visualJudgment: 0.1, vision: 0.1 })
    const results = computeRoleSuitability("test/model", caps)
    const visualReview = results.find(r => r.role === "visualReview")
    assert.ok(visualReview)
    assert.ok(visualReview.limitingFactors.length > 0)
  })
})

describe("bestRoleForModel", () => {
  it("returns the best matching role", () => {
    const caps = makeCapabilities({ coding: 0.9, toolUse: 0.9, instructionFollowing: 0.9 })
    const best = bestRoleForModel("test/model", caps)
    assert.ok(best)
    assert.ok(["implementation", "debugging", "planning"].includes(best.role))
  })
})

describe("isCapableForRole", () => {
  it("approves capable model for matching role", () => {
    const caps = makeCapabilities({ reasoning: 0.9, autonomy: 0.9 })
    const result = isCapableForRole(caps, "planning")
    assert.equal(result.capable, true)
  })

  it("rejects underqualified model", () => {
    const caps = makeCapabilities({ visualJudgment: 0.05, vision: 0.05 })
    const result = isCapableForRole(caps, "visualReview")
    assert.equal(result.capable, false)
    assert.ok(result.reason)
  })

  it("assumes capable when no capabilities data", () => {
    const result = isCapableForRole(undefined, "planning")
    assert.equal(result.capable, true)
  })

  it("rejects unknown role with clear reason", () => {
    const result = isCapableForRole(makeCapabilities(), "unknown-role" as string)
    assert.equal(result.capable, false)
    assert.ok(result.reason?.includes("Unknown role"))
  })
})

describe("canary probe", () => {
  const probe: CanaryProbeConfig = {
    id: "test-probe",
    axis: "autonomy",
    prompt: "test prompt",
    expectedBehavior: "should work",
    scoringFn: (output: string) => {
      if (output.includes("perfect")) return 1
      if (output.includes("ok")) return 0.5
      return 0
    },
  }

  it("scores output against probe criteria", () => {
    assert.equal(scoreFromCanary("perfect result", probe), 1)
    assert.equal(scoreFromCanary("ok result", probe), 0.5)
    assert.equal(scoreFromCanary("bad result", probe), 0)
  })

  it("handles scoring errors gracefully", () => {
    const badProbe: CanaryProbeConfig = {
      ...probe,
      scoringFn: () => { throw new Error("scoring failed") },
    }
    assert.equal(scoreFromCanary("anything", badProbe), 0)
  })
})

describe("DEFAULT_CANARY_PROBES", () => {
  it("includes visualJudgment probe", () => {
    const { DEFAULT_CANARY_PROBES } = require("./capabilityProfiles")
    const probes = DEFAULT_CANARY_PROBES as Array<{ id: string; axis: string; scoringFn: (o: string) => number }>
    const visProbe = probes.find(p => p.axis === "visualJudgment")
    assert.ok(visProbe, "visual judgment canary probe must exist")
    assert.ok(visProbe.id.includes("visualJudgment"))
    assert.ok(visProbe.scoringFn("contrast and WCAG fixed button") > 0)
  })

  it("scores visual judgment probe correctly for good output", () => {
    const { DEFAULT_CANARY_PROBES } = require("./capabilityProfiles")
    const probe = (DEFAULT_CANARY_PROBES as Array<CanaryProbeConfig>).find(p => p.axis === "visualJudgment")!
    const high = scoreFromCanary("The button has poor contrast (WCAG AA fails). Fixed version uses proper padding and 12px font size.", probe)
    assert.ok(high >= 0.5, `expected high score for detailed critique, got ${high}`)
    const low = scoreFromCanary("looks fine", probe)
    assert.ok(low < 0.3, `expected low score for vague output, got ${low}`)
  })
})

describe("mergeCanaryIntoCapabilities", () => {
  it("updates capability score from canary result", () => {
    const base = makeCapabilities({ autonomy: 0.3 })
    const merged = mergeCanaryIntoCapabilities(base, 0.8, "autonomy")
    assert.equal(merged.autonomy, 0.8)
    assert.equal(merged.confidenceSources.autonomy, "inferred")
    assert.ok(merged.canaryProbedAt)
  })

  it("uses max of existing and canary score", () => {
    const base = makeCapabilities({ autonomy: 0.9 })
    const merged = mergeCanaryIntoCapabilities(base, 0.5, "autonomy")
    assert.equal(merged.autonomy, 0.9)
  })
})
