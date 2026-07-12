import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelProfileRegistry, type ModelProfileEntry } from './ModelProfileRegistry.js';
import type { ModelTier } from './types.js';

const EXPECTED_STATIC_COUNT = 75; // total static profile rows

describe('ModelProfileRegistry', () => {
  const registry = new ModelProfileRegistry();

  it('returns all default profiles', () => {
    const profiles = registry.getAllProfiles();
    assert.ok(profiles.length >= EXPECTED_STATIC_COUNT,
      `Expected at least ${EXPECTED_STATIC_COUNT} profiles, got ${profiles.length}`);
  });

  it('classifies known models into expected tiers', () => {
    const checks: Array<[string, ModelTier]> = [
      ['anthropic/claude-opus-4-7', 'S'],
      ['anthropic/claude-sonnet-4-6', 'S'],
      ['anthropic/claude-haiku-4-5', 'B'],
      ['openai/gpt-5.2', 'S'],
      ['openai/gpt-5.4-mini', 'B'],
      ['google/gemini-3-pro', 'S'],
      ['google/gemini-3-flash', 'B'],
      ['deepseek/deepseek-v4-flash', 'A'],
      ['deepseek/deepseek-v4-pro', 'S'],
      ['mistral/mistral-large-4', 'A'],
      ['meta/llama-4', 'A'],
      ['qwen/qwen-3-235b', 'A'],
      ['zhipu/glm-5', 'A'],
    ];
    for (const [id, expectedTier] of checks) {
      const profile = registry.getProfile(id);
      assert.ok(profile, `Missing profile for ${id}`);
      assert.equal(profile.tier, expectedTier, `${id} expected tier ${expectedTier}, got ${profile.tier}`);
    }
  });

  it('returns undefined for unknown models via exact lookup', () => {
    assert.equal(registry.getProfile('unknown-model-xyz'), undefined);
  });

  it('getProfilesByTier returns only models of that tier', () => {
    const sTier = registry.getProfilesByTier('S');
    assert.ok(sTier.length >= 5, 'Expected at least 5 S-tier models');
    assert.ok(sTier.every(p => p.tier === 'S'), 'All returned profiles should be S-tier');
  });

  it('allows registering custom profiles with verified source', () => {
    const custom: ModelProfileEntry = {
      id: 'custom/my-model',
      provider: 'custom',
      name: 'My Custom Model',
      capabilities: {
        reasoning: 0.9, coding: 0.9, knowledge: 0.8,
        instructionFollowing: 0.85, toolUse: 0.8, vision: 0.5,
        contextUtilization: 0.85, autonomy: 0.85, throughput: 0.8,
        visualJudgment: 0.6, confidenceSources: {},
      },
      performance: { contextWindow: 128000, ttft: 50, tokensPerSecond: 200, costPerInputToken: 0.005, costPerOutputToken: 0.015 },
    };
    registry.registerProfile(custom);
    const retrieved = registry.getProfile('custom/my-model');
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'My Custom Model');
    // Registered profiles should carry 'verified' source on all axes
    assert.equal(retrieved.capabilities.confidenceSources?.reasoning, 'verified');
  });

  // ─── resolveModelId multi-strategy tests ────────────────────────────

  describe('resolveModelId — exact match', () => {
    it('finds by exact provider/model id', () => {
      const profile = registry.resolveModelId('deepseek/deepseek-v4-flash');
      assert.ok(profile);
      assert.equal(profile!.id, 'deepseek/deepseek-v4-flash');
    });
  });

  describe('resolveModelId — short ID match', () => {
    it('finds by short ID (no provider)', () => {
      const profile = registry.resolveModelId('deepseek-v4-flash');
      assert.ok(profile);
      assert.equal(profile!.id, 'deepseek/deepseek-v4-flash');
    });

    it('finds by partial suffix (claude-opus-4-7)', () => {
      const profile = registry.resolveModelId('claude-opus-4-7');
      assert.ok(profile);
      assert.ok(profile!.id.includes('claude-opus'));
    });
  });

  describe('resolveModelId — case-insensitive match', () => {
    it('matches case-insensitively', () => {
      const profile = registry.resolveModelId('DEEPSEEK/DEEPSEEK-V4-FLASH');
      assert.ok(profile, 'Should match case-insensitively');
    });

    it('matches short ID case-insensitively', () => {
      const profile = registry.resolveModelId('Claude-Sonnet-4-6');
      assert.ok(profile);
    });
  });

  describe('resolveModelId — prefix / substring match', () => {
    it('finds by content-based substring (model name inside longer provider path)', () => {
      // "openrouter/anthropic/claude-haiku-3-5" contains "claude-haiku-3-5"
      // which matches via content-based substring (step 6)
      const variant = registry.resolveModelId('openrouter/anthropic/claude-haiku-3-5');
      assert.ok(variant, 'Should match via short ID substring');
      assert.equal(variant!.id, 'anthropic/claude-haiku-3-5');
    });

    it('finds via stripped version suffix', () => {
      // "claude-opus-4-20250506" strips to "claude-opus-4" which matches
      const variant = registry.resolveModelId('claude-opus-4-20250506');
      assert.ok(variant, 'Should match via stripped version suffix');
      assert.ok(variant!.id.includes('claude-opus'));
    });
  });

  describe('resolveModelId — display name match', () => {
    it('finds by display name substring', () => {
      const profile = registry.resolveModelId('GPT-5.2');
      assert.ok(profile, 'Should resolve by display name');
      assert.equal(profile!.id, 'openai/gpt-5.2');
    });

    it('finds by partial display name', () => {
      const profile = registry.resolveModelId('Gemini-3-Pro');
      assert.ok(profile);
      assert.ok(profile!.id.includes('gemini-3-pro'));
    });
  });

  // ─── inferProfileFromId tests ───────────────────────────────────────

  describe('inferProfileFromId', () => {
    it('infers S-tier for opus-like models', () => {
      const profile = registry.inferProfileFromId('openrouter/anthropic/claude-opus-4');
      assert.equal(profile.tier, 'S');
      assert.equal(profile.source, 'inferred');
    });

    it('infers A-tier for deepseek-flash-like models', () => {
      const profile = registry.inferProfileFromId('opencode/deepseek-v4-flash-free');
      assert.equal(profile.tier, 'A');
    });

    it('infers B-tier for mini/flash/haiku-like models', () => {
      const profile = registry.inferProfileFromId('together/mixtral-8x22b-instruct-mini');
      assert.equal(profile.tier, 'B');
    });

    it('infers C-tier for tiny/phi-like models', () => {
      const profile = registry.inferProfileFromId('ollama/tinyllama');
      assert.equal(profile.tier, 'C');
    });

    it('inferred profiles carry fallback confidence sources', () => {
      const profile = registry.inferProfileFromId('custom/my-unknown-model');
      const cs = profile.capabilities.confidenceSources;
      assert.ok(cs);
      assert.equal(cs.reasoning, 'fallback');
      assert.equal(cs.coding, 'fallback');
    });

    it('returns B-tier fallback for completely unknown models', () => {
      const profile = registry.inferProfileFromId('mystery/xyz-unknown-model');
      assert.ok(profile);
      assert.equal(profile.source, 'inferred');
    });

    it('returns fallback for empty model ID', () => {
      const profile = registry.inferProfileFromId('');
      assert.ok(profile);
      assert.equal(profile.tier, 'B');
      assert.equal(profile.source, 'inferred');
    });

    it('handles gateway providers with model-family names', () => {
      const profile = registry.inferProfileFromId('zenmux/deepseek-v4-flash-free');
      assert.ok(profile);
      // Should match the A-tier deepseek rule despite different provider
      assert.equal(profile.tier, 'A');
    });

    it('handles ollama/local model names gracefully', () => {
      const profile = registry.inferProfileFromId('ollama/llama-3.2-3b');
      assert.ok(profile);
      // Matches C-tier via small param count pattern
      assert.ok(['B', 'C'].includes(profile.tier));
    });
  });

  // ─── resolveOrInfer tests ───────────────────────────────────────────

  describe('resolveOrInfer', () => {
    it('returns exact profile for known models', () => {
      const profile = registry.resolveOrInfer('anthropic/claude-sonnet-4-6');
      assert.ok(profile);
      assert.equal(profile!.source, 'benchmark');
    });

    it('infers profile for unknown models', () => {
      const profile = registry.resolveOrInfer('zenmux/alien-model-x-42');
      assert.ok(profile);
      assert.equal(profile!.source, 'inferred');
    });

    it('returns undefined for empty input', () => {
      assert.equal(registry.resolveOrInfer(''), undefined);
      assert.equal(registry.resolveOrInfer(undefined as unknown as string), undefined);
    });
  });

  // ─── buildExtendedTierMap tests ─────────────────────────────────────

  describe('buildExtendedTierMap', () => {
    it('includes both registered and inferred models', () => {
      const ids = [
        'anthropic/claude-sonnet-4-6', // registered S
        'custom/some-random-model', // inferred B (fallback)
      ];
      const map = registry.buildExtendedTierMap(ids);
      assert.ok(map.S.includes('anthropic/claude-sonnet-4-6'));
      assert.equal(map.S.length, 1);
      assert.equal(map.B.length, 1);
    });
  });

  // ─── buildTierMap tests ─────────────────────────────────────────────

  it('buildTierMap returns a complete tier classification', () => {
    const map = registry.buildTierMap();
    assert.ok(map.S.length > 0, 'S tier should have entries');
    assert.ok(map.B.length > 0, 'B tier should have entries');
    const total = map.S.length + map.A.length + map.B.length + map.C.length;
    assert.ok(total >= EXPECTED_STATIC_COUNT,
      `Expected at least ${EXPECTED_STATIC_COUNT} total models, got ${total}`);
  });
});
