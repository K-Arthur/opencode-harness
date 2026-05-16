/**
 * Unit tests for SkillTriggerEngine — Phase 1 SADD/TDD trigger rules.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SkillTriggerEngine } from './SkillTriggerEngine';

void describe('SkillTriggerEngine', () => {
  let engine: SkillTriggerEngine;

  beforeEach(() => {
    engine = new SkillTriggerEngine();
  });

  void describe('SADD triggers', () => {
    void it('should trigger SADD for complex feature implementation', () => {
      const skills = engine.getTriggeredSkills('Implement a new dashboard feature');
      assert.ok(skills.includes('subagent-driven-development'));
    });

    void it('should trigger SADD for full-stack tasks', () => {
      const skills = engine.getTriggeredSkills('Build a full-stack application');
      assert.ok(skills.includes('subagent-driven-development'));
    });

    void it('should trigger SADD for multi-file changes', () => {
      const skills = engine.getTriggeredSkills('Update multiple components and services');
      assert.ok(skills.includes('subagent-driven-development'));
    });

    void it('should trigger SADD for system-level tasks', () => {
      const skills = engine.getTriggeredSkills('Create a new authentication system');
      assert.ok(skills.includes('subagent-driven-development'));
    });
  });

  void describe('TDD triggers', () => {
    void it('should trigger TDD for new function creation', () => {
      const skills = engine.getTriggeredSkills('Write a function to validate emails');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for new API endpoints', () => {
      const skills = engine.getTriggeredSkills('Create an API endpoint for user registration');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for bug fixes', () => {
      const skills = engine.getTriggeredSkills('Fix the bug in the login handler');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for refactoring', () => {
      const skills = engine.getTriggeredSkills('Refactor the database layer');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for new component creation', () => {
      const skills = engine.getTriggeredSkills('Build a component for user profiles');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for new method creation', () => {
      const skills = engine.getTriggeredSkills('Add a method to calculate scores');
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger TDD for new class creation', () => {
      const skills = engine.getTriggeredSkills('Create a class for handling payments');
      assert.ok(skills.includes('test-driven-development'));
    });
  });

  void describe('combined SADD + TDD triggers', () => {
    void it('should trigger both SADD and TDD for complex feature implementation', () => {
      const skills = engine.getTriggeredSkills(
        'Implement a comprehensive authentication system with multiple endpoints',
      );
      assert.ok(skills.includes('subagent-driven-development'));
      assert.ok(skills.includes('test-driven-development'));
    });

    void it('should trigger both for full-stack feature with API', () => {
      const skills = engine.getTriggeredSkills(
        'Build a full-stack feature with API endpoints and React components',
      );
      assert.ok(skills.includes('subagent-driven-development'));
      assert.ok(skills.includes('test-driven-development'));
    });
  });

  void describe('existing triggers (regression)', () => {
    void it('should still trigger react component rule', () => {
      const skills = engine.getTriggeredSkills('Create a React component');
      assert.ok(skills.includes('react-component-builder'));
    });

    void it('should still trigger code review rule', () => {
      const skills = engine.getTriggeredSkills('Review the code');
      assert.ok(skills.includes('code-reviewer'));
    });

    void it('should still trigger API documentation rule', () => {
      const skills = engine.getTriggeredSkills('Document the API endpoint');
      assert.ok(skills.includes('api-documenter'));
    });
  });

  void describe('rule management', () => {
    void it('should return SADD rules via getSaddRules', () => {
      const rules = engine.getSaddRules();
      assert.ok(rules.length > 0);
      assert.ok(rules.every(r => r.category === 'sadd'));
    });

    void it('should return TDD rules via getTddRules', () => {
      const rules = engine.getTddRules();
      assert.ok(rules.length > 0);
      assert.ok(rules.every(r => r.category === 'tdd'));
    });

    void it('should allow disabling a rule', () => {
      engine.setRuleEnabled('sadd-complex-feature', false);
      const saddRules = engine.getSaddRules();
      const disabledRule = saddRules.find(r => r.id === 'sadd-complex-feature');
      assert.strictEqual(disabledRule?.enabled, false);
    });

    void it('should allow adding custom rules', () => {
      engine.addRule({
        id: 'custom-test',
        name: 'Custom Test Rule',
        pattern: '\\bcustom\\s+task\\b',
        skillIds: ['custom-skill'],
        priority: 15,
        enabled: true,
        category: 'keyword',
      });

      const skills = engine.getTriggeredSkills('Do a custom task now');
      assert.ok(skills.includes('custom-skill'));
    });

    void it('should allow removing rules', () => {
      engine.removeRule('sadd-complex-feature');
      const rules = engine.getSaddRules();
      assert.strictEqual(rules.find(r => r.id === 'sadd-complex-feature'), undefined);
    });

    void it('should export and import rules', () => {
      const exported = engine.exportRules();
      const parsed = JSON.parse(exported);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length > 0);
    });

    void it('should reset to defaults', () => {
      engine.clearRules();
      assert.strictEqual(engine.getRules().length, 0);

      engine.resetToDefaults();
      assert.ok(engine.getRules().length > 0);
    });
  });

  void describe('confidence calculation', () => {
    void it('should return matches with confidence scores', () => {
      const matches = engine.matchMessage('Implement a new feature');
      assert.ok(matches.length > 0);
      assert.ok(matches.every(m => m.confidence >= 0 && m.confidence <= 1));
    });

    void it('should provide skill boost map', () => {
      const boostMap = engine.getSkillBoostMap('Create a React component');
      assert.ok(boostMap.size > 0);
      for (const [, confidence] of boostMap) {
        assert.ok(confidence >= 0);
        assert.ok(confidence <= 1);
      }
    });
  });

  void describe('non-triggers', () => {
    void it('should not trigger SADD for simple tasks', () => {
      const skills = engine.getTriggeredSkills('Fix a typo');
      assert.ok(!skills.includes('subagent-driven-development'));
    });

    void it('should not trigger TDD for documentation tasks', () => {
      const skills = engine.getTriggeredSkills('Write a README file');
      assert.ok(!skills.includes('test-driven-development'));
    });
  });
});
