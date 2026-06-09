/**
 * SkillTriggerEngine Spec-Aware Triggers Tests
 * Following TDD principles: tests first, implementation follows
 */

import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { SkillTriggerEngine } from './SkillTriggerEngine.js';

describe('SkillTriggerEngine - Spec-Aware Triggers', () => {
  let engine: SkillTriggerEngine;

  before(() => {
    engine = new SkillTriggerEngine();
  });

  after(() => {
    engine = null as any;
  });

  describe('SADD Spec-Driven Trigger', () => {
    it('should match spec-driven development patterns', () => {
      const message = 'Implement this feature using spec-driven development';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.skillIds.includes('subagent-driven-development'), true);
      assert.strictEqual(specDrivenMatch.rule.skillIds.includes('test-driven-development'), true);
    });

    it('should match spec-first patterns', () => {
      const message = 'We need to follow spec-first methodology for this task';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      assert.ok(specDrivenMatch);
    });

    it('should match according to spec patterns', () => {
      const message = 'This should be implemented according to the specification';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      assert.ok(specDrivenMatch);
    });

    it('should match spec-based patterns', () => {
      const message = 'Create a spec-based implementation of the feature';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      assert.ok(specDrivenMatch);
    });

    it('should have high priority for spec-driven triggers', () => {
      const message = 'Implement using spec-driven development';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.priority, 13);
      assert.ok(specDrivenMatch.rule.priority > 10); // Higher than regular SADD triggers
    });

    it('should combine SADD and TDD skills', () => {
      const message = 'Use spec-driven development for this task';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.skillIds.length, 2);
      assert.ok(specDrivenMatch.rule.skillIds.includes('subagent-driven-development'));
      assert.ok(specDrivenMatch.rule.skillIds.includes('test-driven-development'));
    });

    it('should be enabled by default', () => {
      const message = 'Implement using spec-driven development';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.enabled, true);
    });

    it('should have correct category', () => {
      const message = 'Implement using spec-driven development';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.category, 'sadd');
    });
  });

  describe('TDD Spec Verification Trigger', () => {
    it('should match verify spec patterns', () => {
      const message = 'Verify the specification for this feature';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      assert.ok(specVerifyMatch);
    });

    it('should match validate spec patterns', () => {
      const message = 'Validate the specification against requirements';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      assert.ok(specVerifyMatch);
    });

    it('should match check spec patterns', () => {
      const message = 'Check the specification for completeness';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      assert.ok(specVerifyMatch);
    });

    it('should match verify specification patterns', () => {
      const message = 'We need to verify the specification before implementation';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      assert.ok(specVerifyMatch);
    });

    it('should match validate requirements patterns', () => {
      const message = 'Validate the requirements against the specification';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      assert.ok(specVerifyMatch);
    });

    it('should have high priority for spec verification', () => {
      const message = 'Verify the specification';
      const matches = engine.matchMessage(message);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.ok(specVerifyMatch);
      assert.strictEqual(specVerifyMatch.rule.priority, 12);
      assert.ok(specVerifyMatch.rule.priority > 10); // Higher than regular TDD triggers
    });

    it('should trigger TDD skill', () => {
      const message = 'Verify the specification';
      const matches = engine.matchMessage(message);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.ok(specVerifyMatch);
      assert.strictEqual(specVerifyMatch.rule.skillIds.length, 1);
      assert.strictEqual(specVerifyMatch.rule.skillIds[0], 'test-driven-development');
    });

    it('should be enabled by default', () => {
      const message = 'Verify the specification';
      const matches = engine.matchMessage(message);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.ok(specVerifyMatch);
      assert.strictEqual(specVerifyMatch.rule.enabled, true);
    });

    it('should have correct category', () => {
      const message = 'Verify the specification';
      const matches = engine.matchMessage(message);
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.ok(specVerifyMatch);
      assert.strictEqual(specVerifyMatch.rule.category, 'tdd');
    });
  });

  describe('Edge Cases', () => {
    it('should handle case variations in spec-driven patterns', () => {
      const variations = [
        'SPEC-DRIVEN development',
        'Spec-Driven Development',
        'spec-driven development',
        'SPEC DRIVEN',
        'Spec Driven',
        'Spec-Driven',
      ];

      for (const variation of variations) {
        const message = `Implement using ${variation}`;
        const matches = engine.matchMessage(message);
        const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
        
        assert.ok(specDrivenMatch, `Should match: ${variation}`);
      }
    });

    it('should handle partial matches', () => {
      const message = 'The task should be spec-driven and follow TDD principles';
      const matches = engine.matchMessage(message);

      assert.ok(matches.length > 0);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      assert.ok(specDrivenMatch);
    });

    it('should not match unrelated messages', () => {
      const message = 'Implement a simple feature without any specific methodology';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.strictEqual(specDrivenMatch, undefined);
      assert.strictEqual(specVerifyMatch, undefined);
    });

    it('should handle empty messages', () => {
      const message = '';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.strictEqual(specDrivenMatch, undefined);
      assert.strictEqual(specVerifyMatch, undefined);
    });

    it('should handle messages with special characters', () => {
      const message = 'Implement using spec-driven development (with parentheses) & symbols';
      const matches = engine.matchMessage(message);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
    });

    it('should handle very long messages', () => {
      const longMessage = 'Implement using spec-driven development '.repeat(100);
      const matches = engine.matchMessage(longMessage);
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(specDrivenMatch);
    });
  });

  describe('Integration with Existing Triggers', () => {
    it('should not interfere with existing SADD triggers', () => {
      const message = 'Implement a complex feature with multiple files';
      const matches = engine.matchMessage(message);
      const complexFeatureMatch = matches.find((m: any) => m.rule.id === 'sadd-complex-feature');
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(complexFeatureMatch);
      assert.strictEqual(specDrivenMatch, undefined);
    });

    it('should not interfere with existing TDD triggers', () => {
      const message = 'Write a new function for this feature';
      const matches = engine.matchMessage(message);
      const newFunctionMatch = matches.find((m: any) => m.rule.id === 'tdd-new-function');
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');

      assert.ok(newFunctionMatch);
      assert.strictEqual(specVerifyMatch, undefined);
    });

    it('should allow both spec-driven and regular triggers to match', () => {
      const message = 'Implement a complex feature using spec-driven development';
      const matches = engine.matchMessage(message);
      
      const complexFeatureMatch = matches.find((m: any) => m.rule.id === 'sadd-complex-feature');
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');

      assert.ok(complexFeatureMatch);
      assert.ok(specDrivenMatch);
    });
  });

  describe('Trigger Priority', () => {
    it('should prioritize spec-driven over regular SADD triggers', () => {
      const message = 'Implement using spec-driven development';
      const matches = engine.matchMessage(message);
      
      const specDrivenMatch = matches.find((m: any) => m.rule.id === 'sadd-spec-driven');
      const complexFeatureMatch = matches.find((m: any) => m.rule.id === 'sadd-complex-feature');

      assert.ok(specDrivenMatch);
      assert.strictEqual(specDrivenMatch.rule.priority, 13);
      
      // If complex feature also matches, spec-driven should have higher priority
      if (complexFeatureMatch) {
        assert.ok(specDrivenMatch.rule.priority >= complexFeatureMatch.rule.priority);
      }
    });

    it('should prioritize spec verification over regular TDD triggers', () => {
      const message = 'Verify the specification for the new API';
      const matches = engine.matchMessage(message);
      
      const specVerifyMatch = matches.find((m: any) => m.rule.id === 'tdd-spec-verification');
      const newApiMatch = matches.find((m: any) => m.rule.id === 'tdd-new-api');

      assert.ok(specVerifyMatch);
      assert.strictEqual(specVerifyMatch.rule.priority, 12);
      
      // If new API also matches, spec verification should have higher priority
      if (newApiMatch) {
        assert.ok(specVerifyMatch.rule.priority >= newApiMatch.rule.priority);
      }
    });
  });
});
