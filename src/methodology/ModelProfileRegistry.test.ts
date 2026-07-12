import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelProfileRegistry, type ModelProfileEntry } from './ModelProfileRegistry.js';
import type { ModelTier } from './types.js';

const EXPECTED_MODELS = [
  { id: 'anthropic/claude-opus-4-7', tier: 'S' as ModelTier },
  { id: 'anthropic/claude-sonnet-4-6', tier: 'S' as ModelTier },
  { id: 'anthropic/claude-haiku-4-5', tier: 'B' as ModelTier },
  { id: 'openai/gpt-5.2', tier: 'S' as ModelTier },
  { id: 'openai/gpt-5.1-codex', tier: 'S' as ModelTier },
  { id: 'openai/gpt-5.4-mini', tier: 'B' as ModelTier },
  { id: 'google/gemini-3-pro', tier: 'S' as ModelTier },
  { id: 'google/gemini-3.1-pro', tier: 'S' as ModelTier },
  { id: 'google/gemini-3-flash', tier: 'B' as ModelTier },
];

describe('ModelProfileRegistry', () => {
  const registry = new ModelProfileRegistry();

  it('returns all default profiles', () => {
    const profiles = registry.getAllProfiles();
    assert.ok(profiles.length >= 9, `Expected at least 9 profiles, got ${profiles.length}`);
  });

  it('classifies known models into tiers', () => {
    for (const { id, tier } of EXPECTED_MODELS) {
      const profile = registry.getProfile(id);
      assert.ok(profile, `Missing profile for ${id}`);
      assert.equal(profile.tier, tier, `${id} expected tier ${tier}, got ${profile.tier}`);
    }
  });

  it('returns undefined for unknown models', () => {
    assert.equal(registry.getProfile('unknown-model-xyz'), undefined);
  });

  it('getProfilesByTier returns only models of that tier', () => {
    const sTier = registry.getProfilesByTier('S');
    assert.ok(sTier.length >= 2, 'Expected at least 2 S-tier models');
    assert.ok(sTier.every(p => p.tier === 'S'), 'All returned profiles should be S-tier');
  });

  it('allows registering custom profiles', () => {
    const custom: ModelProfileEntry = {
      id: 'custom/my-model',
      provider: 'custom',
      name: 'My Custom Model',
      capabilities: { reasoning: 0.9, coding: 0.9, knowledge: 0.8, instructionFollowing: 0.85, toolUse: 0.8, vision: 0.5, contextUtilization: 0.85, autonomy: 0.85, throughput: 0.8, visualJudgment: 0.6, confidenceSources: {} },
      performance: { contextWindow: 128000, ttft: 50, tokensPerSecond: 200, costPerInputToken: 0.005, costPerOutputToken: 0.015 },
    };
    registry.registerProfile(custom);
    const retrieved = registry.getProfile('custom/my-model');
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'My Custom Model');
  });

  it('resolveModelId finds profiles by partial name', () => {
    const profile = registry.resolveModelId('claude-opus-4-7');
    assert.ok(profile, 'Should resolve by partial ID suffix');
    assert.ok(profile!.id.includes('claude-opus'));
  });

  it('resolveModelId finds profiles by display name', () => {
    const profile = registry.resolveModelId('GPT-5.2');
    assert.ok(profile, 'Should resolve by display name');
    assert.equal(profile!.id, 'openai/gpt-5.2');
  });

  it('buildTierMap returns a complete tier classification', () => {
    const map = registry.buildTierMap();
    assert.ok(map.S.length > 0, 'S tier should have entries');
    assert.ok(map.B.length > 0, 'B tier should have entries');
    const total = map.S.length + map.A.length + map.B.length + map.C.length;
    assert.ok(total >= 9, `Expected at least 9 total models, got ${total}`);
  });
});
