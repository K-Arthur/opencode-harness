import type { ModelCapabilities, ModelProfile, ModelTier } from "../methodology/types"

/**
 * Capability-source labels for each axis, matching ModelCapabilities.
 * Maps capability field name to source.
 */
export type CapabilitySource = 'verified' | 'declared' | 'inferred' | 'fallback'

/**
 * Guidance for how to structure delegated prompts based on a model's
 * autonomy tier — smaller task grain, more explicit step-by-step
 * instructions, mandatory intermediate verification gates, shorter
 * unsupervised leashes.
 */
export interface AutonomyGuidance {
  /** Suggested max prompt length (tokens) before a checkpoint */
  maxPromptTokens: number
  /** Whether to require test-after-every-change enforcement */
  requireTestPerStep: boolean
  /** How often (in steps) to checkpoint back to the parent */
  checkpointEveryNSteps: number
  /** The delegation strategy to use */
  delegationStrategy: 'direct' | 'scoped' | 'microstep'
}

/**
 * Role suitability rating — how well a model's capabilities match
 * a given role's requirements.
 */
export interface RoleSuitability {
  role: string
  score: number
  limitingFactors: string[]
  strengths: string[]
}

/**
 * Role requirement thresholds — the minimum capability scores needed
 * for a role to be considered a good fit.
 */
export const ROLE_CAPABILITY_THRESHOLDS: Record<string, Partial<ModelCapabilities>> = {
  planning: {
    reasoning: 0.7,
    autonomy: 0.6,
    contextUtilization: 0.6,
  },
  implementation: {
    coding: 0.6,
    instructionFollowing: 0.6,
    toolUse: 0.6,
    throughput: 0.4,
  },
  review: {
    reasoning: 0.7,
    coding: 0.6,
    knowledge: 0.6,
    autonomy: 0.5,
  },
  debugging: {
    reasoning: 0.7,
    toolUse: 0.6,
    autonomy: 0.6,
    contextUtilization: 0.6,
  },
  visualReview: {
    visualJudgment: 0.6,
    vision: 0.5,
    reasoning: 0.5,
  },
}

/**
 * Default autonomy guidance per tier level.
 */
export const AUTONOMY_GUIDANCE_BY_TIER: Record<ModelTier, AutonomyGuidance> = {
  S: {
    maxPromptTokens: 8000,
    requireTestPerStep: false,
    checkpointEveryNSteps: 10,
    delegationStrategy: 'direct',
  },
  A: {
    maxPromptTokens: 6000,
    requireTestPerStep: false,
    checkpointEveryNSteps: 5,
    delegationStrategy: 'scoped',
  },
  B: {
    maxPromptTokens: 4000,
    requireTestPerStep: true,
    checkpointEveryNSteps: 3,
    delegationStrategy: 'scoped',
  },
  C: {
    maxPromptTokens: 2000,
    requireTestPerStep: true,
    checkpointEveryNSteps: 1,
    delegationStrategy: 'microstep',
  },
}

/**
 * Derive a composite autonomy score from a model's capabilities.
 * Autonomy is primarily a function of reasoning + tool-use reliability,
 * tempered by instruction-following.
 */
export function deriveAutonomyScore(capabilities: ModelCapabilities): number {
  const raw = (
    capabilities.reasoning * 0.35 +
    capabilities.toolUse * 0.25 +
    capabilities.instructionFollowing * 0.2 +
    capabilities.autonomy * 0.2
  )
  return Math.min(1, Math.max(0, raw))
}

/**
 * Derive a composite throughput score.
 * Throughput is primarily raw task competence and cost efficiency.
 */
export function deriveThroughputScore(capabilities: ModelCapabilities): number {
  const raw = (
    capabilities.throughput * 0.4 +
    capabilities.coding * 0.25 +
    capabilities.instructionFollowing * 0.2 +
    capabilities.knowledge * 0.15
  )
  return Math.min(1, Math.max(0, raw))
}

/**
 * Derive a composite visual judgment score.
 * Based on vision capability, visualJudgment score, and reasoning.
 */
export function deriveVisualJudgmentScore(capabilities: ModelCapabilities): number {
  const raw = (
    capabilities.visualJudgment * 0.5 +
    capabilities.vision * 0.3 +
    capabilities.reasoning * 0.2
  )
  return Math.min(1, Math.max(0, raw))
}

/**
 * Get autonomy guidance for a model based on its capability profile.
 * Falls back to defaults when capabilities are unavailable.
 */
export function getAutonomyGuidance(
  capabilities: ModelCapabilities | undefined,
  profile: ModelProfile | undefined,
): AutonomyGuidance {
  if (!capabilities) return AUTONOMY_GUIDANCE_BY_TIER.B
  const autonomy = deriveAutonomyScore(capabilities)
  if (autonomy >= 0.75) return AUTONOMY_GUIDANCE_BY_TIER.S
  if (autonomy >= 0.55) return AUTONOMY_GUIDANCE_BY_TIER.A
  if (autonomy >= 0.35) return AUTONOMY_GUIDANCE_BY_TIER.B
  return AUTONOMY_GUIDANCE_BY_TIER.C
}

/**
 * Compute role suitability for a given capability profile.
 * Returns what roles this model is best suited for, with scores.
 */
export function computeRoleSuitability(
  modelId: string,
  capabilities: ModelCapabilities,
): RoleSuitability[] {
  const results: RoleSuitability[] = []
  const numericKeys: (keyof ModelCapabilities)[] = [
    'reasoning', 'coding', 'knowledge', 'instructionFollowing',
    'toolUse', 'vision', 'contextUtilization',
    'autonomy', 'throughput', 'visualJudgment',
  ]

  for (const [role, thresholds] of Object.entries(ROLE_CAPABILITY_THRESHOLDS)) {
    const strengths: string[] = []
    const limitingFactors: string[] = []
    let totalScore = 0
    let thresholdCount = 0

    for (const [cap, threshold] of Object.entries(thresholds)) {
      const key = cap as keyof ModelCapabilities
      const val = numericKeys.includes(key) ? (capabilities[key] as number) : 0
      const value = typeof val === 'number' ? val : 0
      const t = typeof threshold === 'number' ? threshold : 0
      const ratio = t > 0 ? value / t : 1
      totalScore += Math.min(1, ratio)
      thresholdCount++

      if (value >= t) {
        strengths.push(`${cap} (${value.toFixed(2)} >= ${t.toFixed(2)})`)
      } else {
        limitingFactors.push(`${cap} (${value.toFixed(2)} < ${t.toFixed(2)})`)
      }
    }

    const score = thresholdCount > 0 ? totalScore / thresholdCount : 0
    results.push({ role, score: Math.min(1, Math.max(0, score)), strengths, limitingFactors })
  }

  return results.sort((a, b) => b.score - a.score)
}

/**
 * Best role fit for a model based on capability profile.
 */
export function bestRoleForModel(
  modelId: string,
  capabilities: ModelCapabilities,
): RoleSuitability | undefined {
  const suitabilities = computeRoleSuitability(modelId, capabilities)
  return suitabilities[0]
}

/**
 * Canary probe configuration.
 * A small, bounded, verifiable task to test a model's actual capability
 * before trusting it in an unsupervised multi-step role.
 */
export interface CanaryProbeConfig {
  /** Unique probe identifier */
  id: string
  /** What axis this probes (autonomy, throughput, visualJudgment) */
  axis: keyof ModelCapabilities
  /** The probe prompt to send */
  prompt: string
  /** Expected behavior / verification criteria */
  expectedBehavior: string
  /** How to score the result (0.0-1.0) */
  scoringFn: (output: string) => number
}

/**
 * Known canary probes for each capability axis.
 */
export const DEFAULT_CANARY_PROBES: CanaryProbeConfig[] = [
  {
    id: 'canary-autonomy-basic',
    axis: 'autonomy',
    prompt: `You have a function that is supposed to return the sum of an array, but it has a bug:

function sumArray(arr: number[]): number {
  let sum = 0;
  for (let i = 0; i <= arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

Find and fix the bug. Then write a test that proves it works. Run the test and report the result.`,
    expectedBehavior: 'model should identify the off-by-one error, fix it, write a test, run it, and report pass/fail',
    scoringFn: (output: string): number => {
      const lines = output.toLowerCase()
      let score = 0
      if (lines.includes('off-by-one') || lines.includes('<= should be <') || lines.includes('i < arr.length')) score += 0.3
      if (lines.includes('test') && (lines.includes('pass') || lines.includes('true') || lines.includes('ok'))) score += 0.3
      if (lines.includes('sum') && lines.includes('result')) score += 0.2
      if (lines.includes('assert') || lines.includes('expect') || lines.includes('console.log')) score += 0.2
      return Math.min(1, score)
    },
  },
  {
    id: 'canary-throughput-basic',
    axis: 'throughput',
    prompt: `Write a function that takes an array of numbers and returns the median value. Handle both odd and even length arrays. Sort the array first.`,
    expectedBehavior: 'model should produce a correct, concise implementation',
    scoringFn: (output: string): number => {
      const lines = output.toLowerCase()
      let score = 0
      if (lines.includes('sort') && (lines.includes('function') || lines.includes('const') || lines.includes('let'))) score += 0.3
      if ((lines.includes('length % 2') || lines.includes('length / 2')) && (lines.includes('middle') || lines.includes('mid'))) score += 0.4
      if (lines.includes('return') && (lines.includes('median') || lines.includes('result'))) score += 0.3
      return Math.min(1, score)
    },
  },
  {
    id: 'canary-visualJudgment-basic',
    axis: 'visualJudgment',
    prompt: `You are reviewing a simple button component. It has these CSS properties:

.button {
  padding: 11px 23px;
  font-size: 13px;
  color: #667788;
  background: #eef0f2;
  border: 1px solid #ccd;
  border-radius: 3px;
}

List every visual/design issue you can find. For each issue:
1. Name the CSS property
2. Say what value it should use based on a 4px spacing grid, consistent type scale, and WCAG AA contrast
3. Say the current value and why it's a problem

Then produce a corrected version.`,
    expectedBehavior: 'model should identify non-4px-grid padding (11px, 23px), small font-size (13px), low contrast (#667788 on #eef0f2), non-standard radius (3px), and suggest token-based alternatives',
    scoringFn: (output: string): number => {
      const lines = output.toLowerCase()
      let score = 0
      // Detected non-4px padding (11px not divisible by 4, 23px not divisible by 4)
      if (lines.includes('11px') || lines.includes('padding') && (lines.includes('not 4') || lines.includes('grid') || lines.includes('12px') || lines.includes('24px') || lines.includes('8px'))) score += 0.25
      // Detected small font or non-standard size (13px not in typical scale)
      if (lines.includes('13px') || lines.includes('font-size') && (lines.includes('12') || lines.includes('14') || lines.includes('scale') || lines.includes('small'))) score += 0.25
      // Detected contrast issue (#667788 on #eef0f2 is ~3.5:1 — below WCAG AA 4.5:1)
      if (lines.includes('contrast') || lines.includes('wcag') || lines.includes('#667788') || lines.includes('readability')) score += 0.25
      // Provided a corrected version
      if ((lines.includes('correct') || lines.includes('fixed') || lines.includes('revised') || lines.includes('improved')) && lines.includes('button')) score += 0.25
      return Math.min(1, score)
    },
  },
]

/**
 * Infer capability score from a canary probe result.
 */
export function scoreFromCanary(output: string, config: CanaryProbeConfig): number {
  try {
    return config.scoringFn(output)
  } catch {
    return 0
  }
}

/**
 * Merge inferred capability data into an existing profile.
 * Promotes the capability source from 'fallback' to 'inferred' when
 * canary data is available.
 */
const NUMERIC_CAPABILITY_KEYS: Set<string> = new Set([
  'reasoning', 'coding', 'knowledge', 'instructionFollowing',
  'toolUse', 'vision', 'contextUtilization',
  'autonomy', 'throughput', 'visualJudgment',
])

function getNumericCapability(caps: ModelCapabilities, key: string): number {
  if (NUMERIC_CAPABILITY_KEYS.has(key)) {
    const v = (caps as unknown as Record<string, unknown>)[key]
    return typeof v === 'number' ? v : 0
  }
  return 0
}

function setNumericCapability(caps: ModelCapabilities, key: string, value: number): void {
  if (NUMERIC_CAPABILITY_KEYS.has(key)) {
    (caps as unknown as Record<string, unknown>)[key] = value
  }
}

export function mergeCanaryIntoCapabilities(
  base: ModelCapabilities,
  canaryScore: number,
  axis: string,
): ModelCapabilities {
  const updated = { ...base }
  if (canaryScore > 0) {
    const current = getNumericCapability(updated, axis)
    setNumericCapability(updated, axis, Math.max(current, canaryScore))
    if (updated.confidenceSources) {
      updated.confidenceSources = {
        ...updated.confidenceSources,
        [axis]: 'inferred',
      }
    }
  }
  updated.canaryScore = Math.max(updated.canaryScore ?? 0, canaryScore)
  updated.canaryProbedAt = new Date().toISOString()
  return updated
}

/**
 * Check whether a model is eligible for an unsupervised multi-step role
 * based on its capability profile.
 */
export function isCapableForRole(
  capabilities: ModelCapabilities | undefined,
  role: string,
): { capable: boolean; reason?: string } {
  if (!capabilities) return { capable: true, reason: 'No capability data — assuming capable' }

  const thresholds = ROLE_CAPABILITY_THRESHOLDS[role]
  if (!thresholds) return { capable: false, reason: `Unknown role "${role}" — no capability thresholds defined` }

  for (const [cap, threshold] of Object.entries(thresholds)) {
    const value = getNumericCapability(capabilities, cap)
    const t = typeof threshold === 'number' ? threshold : 0
    if (value < t) {
      const source = (capabilities.confidenceSources as Record<string, string>)?.[cap] ?? 'fallback'
      return {
        capable: false,
        reason: `${cap} score ${value.toFixed(2)} below threshold ${t.toFixed(2)} (source: ${source})`,
      }
    }
  }

  return { capable: true }
}

/**
 * Scaffolding strategy for a model assigned to a role it may not be
 * fully capable of. Returns the guidance and a suggested prompt prefix.
 */
export function scaffoldingForRole(
  capabilities: ModelCapabilities | undefined,
  role: string,
  profile?: ModelProfile,
): { guidance: AutonomyGuidance; promptPrefix: string } {
  const guidance = getAutonomyGuidance(capabilities, profile)

  const prefixes: Record<string, string> = {
    planning: `Break this planning task into concrete, verifiable steps. After each step, confirm the result before proceeding.`,
    implementation: `Implement this change one file at a time. After each file, run the relevant tests and report the result. If a test fails, fix it before moving to the next file.`,
    review: `Review the code and cite specific file paths and line ranges for each finding. If you cannot find concrete evidence for a claim, say so.`,
    debugging: `Investigate the bug systematically. Formulate a hypothesis, test it with evidence, then fix. After each fix attempt, re-run the failing test.`,
    visualReview: `Check the rendered output against the design reference. Report every specific discrepancy with CSS property values. Do not say "looks good" without verifying each checkable criterion.`,
  }

  return {
    guidance,
    promptPrefix: prefixes[role] ?? '',
  }
}
