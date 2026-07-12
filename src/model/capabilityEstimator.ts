/**
 * Capability Estimator — derives model capability scores from available
 * server/registry metadata rather than relying solely on hardcoded tier
 * defaults.
 *
 * The server returns `reasoning: boolean` and `limit.context: number` per
 * model, but NO capability scores. This module bridges that gap by applying
 * evidence-based heuristics:
 *
 *   - `reasoning === true` → verified boost to reasoning/autonomy
 *   - Large context window → inferred boost to contextUtilization/knowledge
 *   - Provider + model name → tier fallback from ModelProfileRegistry
 *
 * Each axis gets a `confidenceSources` label so downstream consumers know
 * which data source drove the score.
 */
import { ModelProfileRegistry } from "../methodology/ModelProfileRegistry"
import type { ModelCapabilities } from "../methodology/types"

/**
 * Input metadata available from the server for a single model.
 */
export interface ModelMetadata {
  /** Full model ID (e.g. "deepseek/deepseek-v4-flash") */
  id: string
  /** Provider namespace (e.g. "deepseek", "anthropic") */
  provider?: string
  /** Human-readable display name */
  displayName?: string
  /** Server-reported reasoning support flag */
  supportsReasoning?: boolean
  /** Resolved context window (server → models.dev → OpenRouter) */
  contextWindow?: number
}

/**
 * All 10 capability axis keys for iteration.
 */
const CAPABILITY_AXES: Array<keyof ModelCapabilities> = [
  'reasoning', 'coding', 'knowledge', 'instructionFollowing',
  'toolUse', 'vision', 'contextUtilization',
  'autonomy', 'throughput', 'visualJudgment',
]

/**
 * Ensure every capability axis has a confidence source.
 * Axes with an explicit source (verified/inferred) keep it;
 * any remaining undefined axes get 'fallback'.
 */
function ensureAllSources(
  sources: Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'>,
): Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'> {
  const result = { ...sources }
  for (const axis of CAPABILITY_AXES) {
    if (result[axis] === undefined) {
      result[axis] = 'fallback'
    }
  }
  return result
}

/**
 * Apply metadata-driven boosts to a base capability profile.
 * Mutates the returned copy (not the input).
 */
function applyMetadataBoosts(
  base: ModelCapabilities,
  meta: ModelMetadata,
  source: 'verified' | 'inferred',
): ModelCapabilities {
  const caps = { ...base }
  const sources = ensureAllSources({ ...caps.confidenceSources } as Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'>)

  // ── Reasoning flag (server-furnished — highest confidence) ──────────
  if (meta.supportsReasoning === true) {
    caps.reasoning = Math.min(1, caps.reasoning + 0.15)
    caps.autonomy = Math.min(1, caps.autonomy + 0.1)
    caps.instructionFollowing = Math.min(1, caps.instructionFollowing + 0.1)
    sources.reasoning = 'verified'
    sources.autonomy = source
    sources.instructionFollowing = source
  }

  // ── Context window (models.dev / OpenRouter-backed) ─────────────────
  const ctx = meta.contextWindow
  if (ctx !== undefined && ctx > 0) {
    sources.contextUtilization = source
    sources.knowledge = source

    // Large context (>500K tokens) — strong multi-file capability
    if (ctx >= 500_000) {
      caps.contextUtilization = Math.min(1, Math.max(caps.contextUtilization, 0.85))
      caps.knowledge = Math.min(1, Math.max(caps.knowledge, 0.8))
    } else if (ctx >= 100_000) {
      caps.contextUtilization = Math.min(1, Math.max(caps.contextUtilization, 0.7))
    }
  }

  // ── Provider-based throughput heuristics ────────────────────────────
  const provider = (meta.provider ?? '').toLowerCase()
  if (provider === 'deepseek' || provider === 'mistral') {
    caps.throughput = Math.min(1, caps.throughput + 0.08)
    sources.throughput = source
  }

  caps.confidenceSources = sources
  return caps
}

/**
 * Estimate a capability profile for a model using available metadata.
 *
 * Strategy:
 *   1. Look up the model in the static registry (exact → inferred).
 *   2. If found, start from the registered tier's base scores and apply
 *      metadata-driven boosts on top.
 *   3. If NOT found (entirely unknown model), build a conservative
 *      mid-range profile inferred from model-name patterns, then apply
 *      any metadata boosts available.
 *   4. Every axis carries a `confidenceSources` label reflecting what
 *      data drove it: 'verified' for server boolean flags, 'inferred'
 *      for metadata-derived adjustments, 'fallback' for tier defaults.
 *
 * @param meta - Model metadata from the server (ModelInfo-compatible)
 * @param registry - Optional ModelProfileRegistry instance (defaults to fresh)
 * @returns A capability profile with confidence-source labels
 */
export function estimateCapabilities(
  meta: ModelMetadata,
  registry?: ModelProfileRegistry,
): ModelCapabilities {
  const reg = registry ?? new ModelProfileRegistry()
  const profile = reg.resolveOrInfer(meta.id)

  if (profile) {
    // Model has a known profile — start from its tier base, apply boosts
    const base = { ...profile.capabilities }
    const source: 'verified' | 'inferred' = meta.supportsReasoning === true ? 'verified' : 'inferred'
    return applyMetadataBoosts(base, meta, source)
  }

  // No profile at all — build a conservative mid-range profile
  // This handles models the registry has never heard of (custom models,
  // brand-new releases from unknown providers).
  const fallbackCaps: ModelCapabilities = {
    reasoning: 0.5,
    coding: 0.5,
    knowledge: 0.5,
    instructionFollowing: 0.5,
    toolUse: 0.5,
    vision: 0.5,
    contextUtilization: 0.5,
    autonomy: 0.5,
    throughput: 0.5,
    visualJudgment: 0.5,
    confidenceSources: {
      reasoning: 'fallback', coding: 'fallback', knowledge: 'fallback',
      instructionFollowing: 'fallback', toolUse: 'fallback', vision: 'fallback',
      contextUtilization: 'fallback', autonomy: 'fallback', throughput: 'fallback',
      visualJudgment: 'fallback',
    },
  }

  const source2: 'verified' | 'inferred' = meta.supportsReasoning === true ? 'verified' : 'inferred'
  return applyMetadataBoosts(fallbackCaps, meta, source2)
}
