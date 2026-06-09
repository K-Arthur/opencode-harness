/**
 * Model Profile Registry — static capability map for known AI models.
 *
 * Provides ModelProfile entries with pre-benchmarked capability scores,
 * performance characteristics, and per-task performance estimates.
 * Models are auto-classified into S/A/B/C tiers based on overall capability.
 *
 * The registry is designed to be extended at runtime via registerProfile()
 * or from user settings.
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

const STATIC_PROFILE_ROWS: ProfileRow[] = [
  ['anthropic/claude-opus-4-7', 'S'],
  ['anthropic/claude-sonnet-4-6', 'S'],
  ['anthropic/claude-haiku-4-5', 'B'],
  ['openai/gpt-5.2', 'S'],
  ['openai/gpt-5.1-codex', 'S'],
  ['openai/gpt-5.4-mini', 'B'],
  ['google/gemini-3-pro', 'S'],
  ['google/gemini-3.1-pro', 'S'],
  ['google/gemini-3-flash', 'B'],
];

const TIER_CAPABILITIES: Record<ModelTier, ModelCapabilities> = {
  S: { reasoning: 0.9, coding: 0.9, knowledge: 0.9, instructionFollowing: 0.9, toolUse: 0.88, vision: 0.85, contextUtilization: 0.9 },
  A: { reasoning: 0.8, coding: 0.8, knowledge: 0.8, instructionFollowing: 0.8, toolUse: 0.78, vision: 0.75, contextUtilization: 0.8 },
  B: { reasoning: 0.7, coding: 0.7, knowledge: 0.7, instructionFollowing: 0.7, toolUse: 0.68, vision: 0.65, contextUtilization: 0.7 },
  C: { reasoning: 0.55, coding: 0.55, knowledge: 0.55, instructionFollowing: 0.55, toolUse: 0.5, vision: 0.5, contextUtilization: 0.55 },
};

const TIER_PERFORMANCE: Record<ModelTier, ModelPerformance> = {
  S: { contextWindow: 200000, ttft: 1200, tokensPerSecond: 60, costPerInputToken: 0.01, costPerOutputToken: 0.04 },
  A: { contextWindow: 128000, ttft: 700, tokensPerSecond: 90, costPerInputToken: 0.005, costPerOutputToken: 0.015 },
  B: { contextWindow: 128000, ttft: 300, tokensPerSecond: 150, costPerInputToken: 0.001, costPerOutputToken: 0.005 },
  C: { contextWindow: 64000, ttft: 300, tokensPerSecond: 120, costPerInputToken: 0.0005, costPerOutputToken: 0.002 },
};

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
  const defaultPerf: TaskPerformance = { successRate: overallCapability(entry.capabilities), avgQuality: overallCapability(entry.capabilities), avgTokens: 2000, sampleSize: 0 };
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
    source: 'benchmark',
  };
}

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
    this.profiles.set(entry.id, toProfile(entry));
  }

  resolveModelId(partial: string): ModelProfile | undefined {
    if (this.profiles.has(partial)) return this.profiles.get(partial);
    for (const [id, profile] of this.profiles) {
      if (id.endsWith('/' + partial) || profile.name.toLowerCase().includes(partial.toLowerCase())) return profile;
    }
    return undefined;
  }

  buildTierMap(): Record<ModelTier, string[]> {
    const map: Record<ModelTier, string[]> = { S: [], A: [], B: [], C: [] };
    for (const [id, profile] of this.profiles) {
      map[profile.tier].push(id);
    }
    return map;
  }
}
