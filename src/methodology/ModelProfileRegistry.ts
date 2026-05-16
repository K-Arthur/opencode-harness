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

const STATIC_PROFILES: ModelProfileEntry[] = [
  {
    id: 'anthropic/claude-opus-4-7',
    provider: 'anthropic',
    name: 'Claude Opus 4',
    capabilities: { reasoning: 0.95, coding: 0.95, knowledge: 0.95, instructionFollowing: 0.95, toolUse: 0.9, vision: 0.9, contextUtilization: 0.95 },
    performance: { contextWindow: 200000, ttft: 2000, tokensPerSecond: 40, costPerInputToken: 0.015, costPerOutputToken: 0.075 },
    taskOverrides: { architect: { successRate: 0.9, avgQuality: 0.9 }, generate: { successRate: 0.85, avgQuality: 0.88 } },
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    capabilities: { reasoning: 0.85, coding: 0.88, knowledge: 0.85, instructionFollowing: 0.88, toolUse: 0.85, vision: 0.8, contextUtilization: 0.85 },
    performance: { contextWindow: 200000, ttft: 800, tokensPerSecond: 80, costPerInputToken: 0.003, costPerOutputToken: 0.015 },
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    provider: 'anthropic',
    name: 'Claude Haiku 4.5',
    capabilities: { reasoning: 0.7, coding: 0.75, knowledge: 0.7, instructionFollowing: 0.78, toolUse: 0.7, vision: 0.7, contextUtilization: 0.72 },
    performance: { contextWindow: 200000, ttft: 300, tokensPerSecond: 150, costPerInputToken: 0.001, costPerOutputToken: 0.005 },
  },
  {
    id: 'openai/gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2',
    capabilities: { reasoning: 0.93, coding: 0.92, knowledge: 0.93, instructionFollowing: 0.9, toolUse: 0.88, vision: 0.85, contextUtilization: 0.9 },
    performance: { contextWindow: 128000, ttft: 1500, tokensPerSecond: 50, costPerInputToken: 0.015, costPerOutputToken: 0.06 },
  },
  {
    id: 'openai/gpt-5.1-codex',
    provider: 'openai',
    name: 'GPT-5.1 Codex',
    capabilities: { reasoning: 0.85, coding: 0.9, knowledge: 0.83, instructionFollowing: 0.87, toolUse: 0.82, vision: 0.75, contextUtilization: 0.85 },
    performance: { contextWindow: 128000, ttft: 700, tokensPerSecond: 90, costPerInputToken: 0.005, costPerOutputToken: 0.015 },
  },
  {
    id: 'openai/gpt-5.4-mini',
    provider: 'openai',
    name: 'GPT-5.4 Mini',
    capabilities: { reasoning: 0.68, coding: 0.72, knowledge: 0.68, instructionFollowing: 0.72, toolUse: 0.65, vision: 0.6, contextUtilization: 0.7 },
    performance: { contextWindow: 128000, ttft: 200, tokensPerSecond: 180, costPerInputToken: 0.0005, costPerOutputToken: 0.002 },
  },
  {
    id: 'google/gemini-3-pro',
    provider: 'google',
    name: 'Gemini 3 Pro',
    capabilities: { reasoning: 0.9, coding: 0.88, knowledge: 0.92, instructionFollowing: 0.88, toolUse: 0.85, vision: 0.92, contextUtilization: 0.88 },
    performance: { contextWindow: 1000000, ttft: 1200, tokensPerSecond: 60, costPerInputToken: 0.01, costPerOutputToken: 0.04 },
  },
  {
    id: 'google/gemini-3.1-pro',
    provider: 'google',
    name: 'Gemini 3.1 Pro',
    capabilities: { reasoning: 0.85, coding: 0.85, knowledge: 0.88, instructionFollowing: 0.85, toolUse: 0.82, vision: 0.88, contextUtilization: 0.85 },
    performance: { contextWindow: 1000000, ttft: 600, tokensPerSecond: 100, costPerInputToken: 0.005, costPerOutputToken: 0.02 },
  },
  {
    id: 'google/gemini-3-flash',
    provider: 'google',
    name: 'Gemini 3 Flash',
    capabilities: { reasoning: 0.7, coding: 0.72, knowledge: 0.72, instructionFollowing: 0.72, toolUse: 0.68, vision: 0.75, contextUtilization: 0.7 },
    performance: { contextWindow: 1000000, ttft: 150, tokensPerSecond: 200, costPerInputToken: 0.0005, costPerOutputToken: 0.002 },
  },
];

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
    for (const entry of STATIC_PROFILES) {
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
