/**
 * Model Profile Registry — capability map for known AI models.
 *
 * Provides ModelProfile entries with pre-benchmarked capability scores,
 * performance characteristics, and per-task performance estimates.
 * Models are auto-classified into S/A/B/C tiers based on overall capability.
 *
 * Supports:
 * - Static profiles for well-known models (expanded across major providers)
 * - Multi-strategy model ID resolution (exact → short → prefix → fuzzy)
 * - Dynamic inference for unknown/third-party models not in the static list
 * - Registration of custom profiles from user settings
 * - Confidence source tracking on all capability axes
 */

import type { ModelProfile, ModelTier, ModelCapabilities, ModelPerformance, TaskPerformance, TaskType } from './types.js';

export interface ModelProfileEntry {
  id: string;
  provider: string;
  name: string;
  capabilities: ModelCapabilities;
  performance: ModelPerformance;
  taskOverrides?: Partial<Record<TaskType, Partial<TaskPerformance>>>;
}

type ProfileRow = [id: string, tier: ModelTier];

// ─── Static Model Profiles ─────────────────────────────────────────────────
// Each entry is [fullId, tier]. TIER_CAPABILITIES defines per-tier scores.
// Organised by provider / model-family for maintainability.

const STATIC_PROFILE_ROWS: ProfileRow[] = [
  // ── Anthropic ────────────────────────────────────────────────────────
  ['anthropic/claude-opus-4-7',   'S'],
  ['anthropic/claude-opus-4-5',   'S'],
  ['anthropic/claude-opus-4',     'S'],
  ['anthropic/claude-sonnet-4-6', 'S'],
  ['anthropic/claude-sonnet-4',   'S'],
  ['anthropic/claude-sonnet-3-5', 'A'],
  ['anthropic/claude-haiku-4-5',  'B'],
  ['anthropic/claude-haiku-3-5',  'B'],

  // ── OpenAI ───────────────────────────────────────────────────────────
  ['openai/gpt-5.2',               'S'],
  ['openai/gpt-5.1-codex',         'S'],
  ['openai/gpt-5.4-mini',          'B'],
  ['openai/gpt-5-preview',         'S'],
  ['openai/gpt-4.5',               'S'],
  ['openai/gpt-4o',                'S'],
  ['openai/gpt-4o-mini',           'A'],
  ['openai/gpt-4-turbo',           'A'],
  ['openai/gpt-4',                 'A'],
  ['openai/o3',                    'S'],
  ['openai/o4-mini',               'A'],
  ['openai/o1',                    'S'],
  ['openai/o1-mini',               'A'],

  // ── Google / Gemini ─────────────────────────────────────────────────
  ['google/gemini-3-pro',          'S'],
  ['google/gemini-3.1-pro',        'S'],
  ['google/gemini-3-flash',        'B'],
  ['google/gemini-3-flash-lite',   'C'],
  ['google/gemini-2.5-pro',        'S'],
  ['google/gemini-2.5-flash',      'A'],
  ['google/gemini-2-pro',          'A'],
  ['google/gemini-2-flash',        'B'],

  // ── DeepSeek ─────────────────────────────────────────────────────────
  ['deepseek/deepseek-v4-flash',   'A'],
  ['deepseek/deepseek-v4-pro',     'S'],
  ['deepseek/deepseek-v3',         'A'],
  ['deepseek/deepseek-r1',         'A'],
  ['deepseek/deepseek-coder-v3',   'B'],

  // ── Mistral AI ──────────────────────────────────────────────────────
  ['mistral/mistral-large-4',      'A'],
  ['mistral/mistral-large-3',      'A'],
  ['mistral/mistral-medium',       'B'],
  ['mistral/mistral-small-3',      'B'],
  ['mistral/mistral-saba',         'C'],
  ['mistral/codestral-3',          'A'],
  ['mistral/pixtral-large',        'A'],

  // ── Meta / Llama ────────────────────────────────────────────────────
  ['meta/llama-4',                 'A'],
  ['meta/llama-4-scout',           'B'],
  ['meta/llama-4-maverick',        'A'],
  ['meta/llama-3.1-405b',          'A'],
  ['meta/llama-3.1-70b',           'B'],
  ['meta/llama-3.1-8b',            'C'],
  ['meta/llama-3-70b',             'B'],
  ['meta/llama-3-8b',              'C'],

  // ── Qwen (Alibaba) ──────────────────────────────────────────────────
  ['qwen/qwen-3-235b',             'A'],
  ['qwen/qwen-3-110b',             'B'],
  ['qwen/qwen-3-30b',              'B'],
  ['qwen/qwen-3-8b',               'C'],
  ['qwen/qwen-2.5-72b',            'B'],
  ['qwen/qwen-2.5-coder-32b',      'B'],
  ['qwen/qwen-2.5-7b',             'C'],

  // ── Kimi / Moonshot AI ──────────────────────────────────────────────
  ['moonshot/kimi-k2.5',           'A'],
  ['moonshot/kimi-k2',             'A'],
  ['moonshot/kimi-k1.5',           'B'],

  // ── Zhipu AI / GLM ─────────────────────────────────────────────────
  ['zhipu/glm-5',                  'A'],
  ['zhipu/glm-5-flash',            'B'],
  ['zhipu/glm-4',                  'B'],
  ['zhipu/glm-4v',                 'B'],

  // ── Amazon / AWS ────────────────────────────────────────────────────
  ['amazon/nova-pro',              'A'],
  ['amazon/nova-lite',             'B'],
  ['amazon/nova-micro',            'C'],

  // ── Cohere ──────────────────────────────────────────────────────────
  ['cohere/command-r-plus-08',     'A'],
  ['cohere/command-r-08',          'B'],
  ['cohere/command-a',             'A'],

  // ── xAI / Grok ──────────────────────────────────────────────────────
  ['xai/grok-3',                   'A'],
  ['xai/grok-3-mini',              'B'],
  ['xai/grok-2',                   'B'],

  // ── Microsoft ───────────────────────────────────────────────────────
  ['microsoft/phi-4',              'C'],
  ['microsoft/phi-3-medium',       'C'],
  ['microsoft/phi-3-mini',         'C'],
];

// ─── Per-Tier Capability Profiles ─────────────────────────────────────────
// Each capability axis 0.0-1.0 with confidenceSources tracking.
// Adjust weights for frontier vs. budget model families.

const TIER_CAPABILITIES: Record<ModelTier, ModelCapabilities> = {
  S: {
    reasoning: 0.9, coding: 0.9, knowledge: 0.9,
    instructionFollowing: 0.9, toolUse: 0.88,
    vision: 0.85, contextUtilization: 0.9,
    autonomy: 0.9, throughput: 0.85, visualJudgment: 0.85,
    confidenceSources: {},
  },
  A: {
    reasoning: 0.8, coding: 0.8, knowledge: 0.8,
    instructionFollowing: 0.8, toolUse: 0.78,
    vision: 0.75, contextUtilization: 0.8,
    autonomy: 0.8, throughput: 0.75, visualJudgment: 0.7,
    confidenceSources: {},
  },
  B: {
    reasoning: 0.7, coding: 0.7, knowledge: 0.7,
    instructionFollowing: 0.7, toolUse: 0.68,
    vision: 0.65, contextUtilization: 0.7,
    autonomy: 0.6, throughput: 0.7, visualJudgment: 0.55,
    confidenceSources: {},
  },
  C: {
    reasoning: 0.55, coding: 0.55, knowledge: 0.55,
    instructionFollowing: 0.55, toolUse: 0.5,
    vision: 0.5, contextUtilization: 0.55,
    autonomy: 0.4, throughput: 0.6, visualJudgment: 0.3,
    confidenceSources: {},
  },
};

const TIER_PERFORMANCE: Record<ModelTier, ModelPerformance> = {
  S: { contextWindow: 200000, ttft: 1200, tokensPerSecond: 60,  costPerInputToken: 0.01, costPerOutputToken: 0.04 },
  A: { contextWindow: 128000, ttft: 700,  tokensPerSecond: 90,  costPerInputToken: 0.005, costPerOutputToken: 0.015 },
  B: { contextWindow: 128000, ttft: 300,  tokensPerSecond: 150, costPerInputToken: 0.001, costPerOutputToken: 0.005 },
  C: { contextWindow: 64000,  ttft: 300,  tokensPerSecond: 120, costPerInputToken: 0.0005, costPerOutputToken: 0.002 },
};

// ─── Model Family Inference Rules ────────────────────────────────────────
// Used when a model ID is not in the static registry. Maps regex patterns
// on the short model name (after provider/) to a best-guess tier.

interface FamilyRule {
  /** Pattern to match against the short model name */
  pattern: RegExp
  /** Guessed tier */
  tier: ModelTier
  /** Adjustments for specific capability axes (+/- delta) */
  capAdjust?: Partial<ModelCapabilities>
}

const MODEL_FAMILY_RULES: FamilyRule[] = [
  // Frontier reasoning / flagship
  { pattern: /opus|sonnet.*4|sonnet.*2025|gpt-5(\.|[^m]|$)/i,              tier: 'S' },
  { pattern: /gemini.*(ultra|3\b)/i,                                        tier: 'S' },
  { pattern: /deepseek.*v4.*pro/i,                                          tier: 'S', capAdjust: { reasoning: 0.05 } },
  { pattern: /o1\b|o3\b|o4\b|claude.*thought/i,                             tier: 'S' },

  // Strong general-purpose (A-tier)
  { pattern: /sonnet|haiku.*4|gpt-4o?\b|gemini.*(pro|2\b)/i,               tier: 'A' },
  { pattern: /deepseek.*(v4.*flash|r1|v3)/i,                                tier: 'A', capAdjust: { throughput: 0.1 } },
  { pattern: /mistral.*large|llama.*(4|405|maverick)/i,                     tier: 'A' },
  { pattern: /kimi.*k2|qwen.*235|\bgrok-3$/i,                               tier: 'A' },
  { pattern: /glm-5$/i,                                                     tier: 'A' },
  { pattern: /nova-pro|command-(r-plus|a)/i,                                tier: 'A' },
  { pattern: /codestral|coder|deepseek.*coder/i,                            tier: 'A' },

  // Capable mid-tier (B-tier)
  { pattern: /mini|flash|haiku|gemini.*flash/i,                             tier: 'B' },
  { pattern: /llama.*(70b|3\b)|mistral.*(medium|small)/i,                  tier: 'B' },
  { pattern: /qwen.*(110|72|32b)|deepseek.*v2/i,                            tier: 'B' },
  { pattern: /glm.*flash|nova-lite|command-r\b/i,                           tier: 'B' },
  { pattern: /grok.*mini|kimi.*k1/i,                                        tier: 'B' },

  // Lightweight / efficient (C-tier)
  { pattern: /llama.*(8b|70b.*?tiny)|phi|tiny/i,                           tier: 'C' },
  { pattern: /qwen.*(8b|7b|0\.5)|nova-micro/i,                             tier: 'C' },
  { pattern: /flash.*lite|gemini.*nano/i,                                   tier: 'C' },
  { pattern: /\b\d+[mb]\b|\.\d+b$/i,                                       tier: 'C' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function rowToEntry(row: ProfileRow): ModelProfileEntry {
  const [id, tier] = row;
  return {
    id,
    provider: id.split('/')[0] ?? '',
    name: id.split('/')[1] ?? id,
    capabilities: TIER_CAPABILITIES[tier],
    performance: TIER_PERFORMANCE[tier],
  };
}

function overallCapability(c: ModelCapabilities): number {
  return (c.reasoning + c.coding + c.knowledge + c.instructionFollowing + c.toolUse + c.contextUtilization) / 6;
}

function classifyTier(c: ModelCapabilities): ModelTier {
  const o = overallCapability(c);
  if (o >= 0.85) return 'S';
  if (o >= 0.75) return 'A';
  if (o >= 0.6) return 'B';
  return 'C';
}

function toProfile(entry: ModelProfileEntry): ModelProfile {
  const tier = classifyTier(entry.capabilities);
  const defaultPerf: TaskPerformance = {
    successRate: overallCapability(entry.capabilities),
    avgQuality: overallCapability(entry.capabilities),
    avgTokens: 2000,
    sampleSize: 0,
  };
  const taskPerformance: Partial<Record<TaskType, TaskPerformance>> = {};
  if (entry.taskOverrides) {
    for (const [tt, override] of Object.entries(entry.taskOverrides)) {
      taskPerformance[tt as TaskType] = { ...defaultPerf, ...override };
    }
  }
  return {
    id: entry.id,
    provider: entry.provider,
    name: entry.name,
    tier,
    capabilities: entry.capabilities,
    performance: entry.performance,
    taskPerformance,
    lastUpdated: new Date(),
    source: 'benchmark' as const,
  };
}

/**
 * Strip version/release suffixes from a short model name for fuzzy matching.
 * e.g. "claude-sonnet-5-20250506" → "claude-sonnet-5"
 */
function stripVersionSuffix(name: string): string {
  return name.replace(/[-_]?\d{8,}[-_]?\w*$/i, '').replace(/[-_]\d+\.\d+(\.\d+)?$/, '');
}

/**
 * Levenshtein distance for fuzzy matching (capped at maxDist).
 */
function levenshtein(a: string, b: string, maxDist: number = 3): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0]![j] = j;
  for (let i = 1; i <= b.length; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= a.length; j++) {
      matrix[i]![j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1]![j - 1]!
        : Math.min(matrix[i - 1]![j - 1]! + 1, matrix[i]![j - 1]! + 1, matrix[i - 1]![j]! + 1);
      if (matrix[i]![j]! < rowMin) rowMin = matrix[i]![j]!;
    }
    if (rowMin > maxDist) return maxDist + 1; // early exit
  }
  return matrix[b.length]![a.length]!;
}

// ─── FALLBACK CAPABILITIES ────────────────────────────────────────────────
// Used when no inference rule matches. Visible as 'fallback' source.

const FALLBACK_CAPABILITIES: ModelCapabilities = {
  reasoning: 0.6, coding: 0.6, knowledge: 0.6,
  instructionFollowing: 0.6, toolUse: 0.55,
  vision: 0.5, contextUtilization: 0.55,
  autonomy: 0.5, throughput: 0.6, visualJudgment: 0.4,
  confidenceSources: {},
};

const FALLBACK_PERFORMANCE: ModelPerformance = {
  contextWindow: 128000, ttft: 500,
  tokensPerSecond: 100, costPerInputToken: 0.003,
  costPerOutputToken: 0.01,
};

// ─── Registry ────────────────────────────────────────────────────────────

export class ModelProfileRegistry {
  private profiles: Map<string, ModelProfile> = new Map();

  constructor() {
    for (const row of STATIC_PROFILE_ROWS) {
      const entry = rowToEntry(row);
      this.profiles.set(entry.id, toProfile(entry));
    }
  }

  getProfile(modelId: string): ModelProfile | undefined {
    return this.profiles.get(modelId);
  }

  getAllProfiles(): ModelProfile[] {
    return [...this.profiles.values()];
  }

  getProfilesByTier(tier: ModelTier): ModelProfile[] {
    return [...this.profiles.values()].filter(p => p.tier === tier);
  }

  registerProfile(entry: ModelProfileEntry): void {
    const profile = toProfile(entry);
    profile.capabilities.confidenceSources = markAllSources(profile.capabilities, 'verified');
    this.profiles.set(entry.id, profile);
  }

  /**
   * Core multi-strategy model ID resolution. Tries in order:
   *   1. Exact `provider/model` match
   *   2. Short ID match (just the model part, no provider prefix)
   *   3. Case-insensitive short ID comparison
   *   4. Stripped version suffix match (e.g. "sonnet-5" matches "sonnet-5-20250506")
   *   5. Fuzzy (Levenshtein) match against short model names (≤2 edits)
   *   6. Prefix match (model name starts with a known entry's name)
   *
   * Returns undefined when no entry matches by any strategy.
   */
  resolveModelId(partial: string): ModelProfile | undefined {
    if (!partial) return undefined;

    // 1. Exact match
    const exact = this.profiles.get(partial);
    if (exact) return exact;

    const slash = partial.indexOf('/');
    const shortId = slash >= 0 ? partial.slice(slash + 1) : partial;
    const shortLower = shortId.toLowerCase();

    // 2. Short ID match (providerless)
    for (const [id, profile] of this.profiles) {
      const idSlash = id.indexOf('/');
      const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
      if (idShort === shortId) return profile;
    }

    // 3. Case-insensitive exact match
    for (const [id, profile] of this.profiles) {
      if (id.toLowerCase() === partial.toLowerCase()) return profile;
      const idSlash = id.indexOf('/');
      const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
      if (idShort.toLowerCase() === shortLower) return profile;
    }

    // 4. Stripped version suffix match
    const stripped = stripVersionSuffix(shortId).toLowerCase();
    if (stripped.length >= 4) {
      for (const [id, profile] of this.profiles) {
        const idSlash = id.indexOf('/');
        const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
        if (stripVersionSuffix(idShort).toLowerCase() === stripped) return profile;
      }
    }

    // 5. Prefix match: known entry is a prefix of the query
    //    (e.g. query "claude-sonnet-5-20250506" matches "claude-sonnet-5")
    for (const [id, profile] of this.profiles) {
      const idSlash = id.indexOf('/');
      const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
      if (shortId.startsWith(idShort) || idShort.startsWith(shortId)) return profile;
    }

    // 6. Content-based substring match (display name in model name)
    for (const [id, profile] of this.profiles) {
      const idSlash = id.indexOf('/');
      const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
      if (idShort.toLowerCase().includes(shortLower) || shortLower.includes(idShort.toLowerCase())) return profile;
    }

    // 7. Fuzzy Levenshtein match (≤ 2 edits)
    let bestDist = 3;
    let bestProfile: ModelProfile | undefined;
    for (const [id, profile] of this.profiles) {
      const idSlash = id.indexOf('/');
      const idShort = idSlash >= 0 ? id.slice(idSlash + 1) : id;
      const dist = levenshtein(shortLower, idShort.toLowerCase(), 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestProfile = profile;
      }
    }
    if (bestProfile) return bestProfile;

    return undefined;
  }

  /**
   * Dynamically infer a capability profile for an unknown model based on
   * its name and provider. Uses heuristic family rules when the model
   * isn't in the static registry. All inferred capabilities are marked
   * with source 'fallback' (not 'verified').
   */
  inferProfileFromId(modelId: string): ModelProfile {
    if (!modelId) {
      return this._buildFallbackProfile('unknown', 'unknown', 'unknown');
    }

    const slash = modelId.indexOf('/');
    const provider = slash >= 0 ? modelId.slice(0, slash) : '';
    const shortName = slash >= 0 ? modelId.slice(slash + 1) : modelId;

    // Try to find a matching family rule
    const rule = MODEL_FAMILY_RULES.find(r => r.pattern.test(shortName));

    if (rule) {
      const baseCaps = TIER_CAPABILITIES[rule.tier];
      const caps: ModelCapabilities = {
        ...baseCaps,
        confidenceSources: {},
      };
      // Apply capability adjustments
      if (rule.capAdjust) {
        for (const [key, val] of Object.entries(rule.capAdjust)) {
          const k = key as keyof ModelCapabilities;
          if (typeof val === 'number' && typeof caps[k] === 'number') {
            (caps[k] as number) = Math.min(1, Math.max(0, (caps[k] as number) + val));
          }
        }
      }

      const perf = TIER_PERFORMANCE[rule.tier];
      const tier = classifyTier(caps);

      return {
        id: modelId,
        provider,
        name: shortName,
        tier,
        capabilities: markSources(caps, 'fallback'),
        performance: { ...perf },
        taskPerformance: {},
        lastUpdated: new Date(),
        source: 'inferred',
      };
    }

    // No rule matched — use default fallback profile
    return this._buildFallbackProfile(modelId, provider, shortName);
  }

  /**
   * Best-effort model resolution: tries resolveModelId first, then
   * falls back to inferProfileFromId. Guaranteed to return a profile
   * for any non-empty model ID.
   */
  resolveOrInfer(modelId: string): ModelProfile | undefined {
    if (!modelId) return undefined;
    const resolved = this.resolveModelId(modelId);
    if (resolved) return resolved;
    return this.inferProfileFromId(modelId);
  }

  buildTierMap(): Record<ModelTier, string[]> {
    const map: Record<ModelTier, string[]> = { S: [], A: [], B: [], C: [] };
    for (const [id, profile] of this.profiles) {
      map[profile.tier].push(id);
    }
    return map;
  }

  /**
   * Build a tier map that includes both registered AND inferred models.
   * Accepts a list of model IDs; any not in the registry are inferred.
   */
  buildExtendedTierMap(modelIds: string[]): Record<ModelTier, string[]> {
    const map: Record<ModelTier, string[]> = { S: [], A: [], B: [], C: [] };
    for (const id of modelIds) {
      const profile = this.resolveOrInfer(id);
      if (profile) {
        map[profile.tier].push(id);
      }
    }
    return map;
  }

  private _buildFallbackProfile(modelId: string, provider: string, name: string): ModelProfile {
    return {
      id: modelId,
      provider,
      name: name || modelId,
      tier: 'B',
      capabilities: { ...FALLBACK_CAPABILITIES, confidenceSources: markAllSources(FALLBACK_CAPABILITIES, 'fallback') },
      performance: { ...FALLBACK_PERFORMANCE },
      taskPerformance: {},
      lastUpdated: new Date(),
      source: 'inferred',
    };
  }
}

// ─── Confidence Source Helpers ───────────────────────────────────────────

const CAPABILITY_KEYS: (keyof ModelCapabilities)[] = [
  'reasoning', 'coding', 'knowledge', 'instructionFollowing',
  'toolUse', 'vision', 'contextUtilization',
  'autonomy', 'throughput', 'visualJudgment',
];

function markSources(caps: ModelCapabilities, source: 'verified' | 'declared' | 'inferred' | 'fallback'): ModelCapabilities {
  const sources: Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'> = {};
  for (const key of CAPABILITY_KEYS) {
    sources[key] = source;
  }
  return { ...caps, confidenceSources: sources };
}

function markAllSources(caps: ModelCapabilities, source: 'verified' | 'declared' | 'inferred' | 'fallback'): Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'> {
  const sources: Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'> = {};
  for (const key of CAPABILITY_KEYS) {
    sources[key] = source;
  }
  return sources;
}
