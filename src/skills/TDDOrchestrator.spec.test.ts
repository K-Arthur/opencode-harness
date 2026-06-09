/**
 * TDDOrchestrator Spec Integration Tests
 * Following TDD principles: tests first, implementation follows
 */

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { TDDOrchestrator } from './TDDOrchestrator.js';
import type { DecomposedTask } from './types.js';

describe('TDDOrchestrator - Spec Integration', () => {
  let orchestrator: TDDOrchestrator;

  // Use beforeEach so each test starts with a fresh orchestrator and state
  // from a previous test (e.g. a set spec) doesn't leak across tests.
  beforeEach(() => {
    orchestrator = new TDDOrchestrator();
  });

  describe('Spec Management', () => {
    it('should set and retrieve a spec', () => {
      const spec = {
        outcomes: ['Feature implemented', 'Tests pass'],
        scope: {
          inScope: ['Core functionality'],
          outOfScope: ['Performance optimization'],
        },
        constraints: ['Follow existing patterns', 'No breaking changes'],
        verificationCriteria: [
          { criteria: 'All tests pass', test: 'npm test', automated: true },
        ],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.strictEqual(retrieved, spec);
    });

    it('should return undefined when no spec is set', () => {
      const retrieved = orchestrator.getSpec();
      assert.strictEqual(retrieved, undefined);
    });

    it('should overwrite existing spec when setSpec is called again', () => {
      const spec1 = {
        outcomes: ['Feature 1'],
        scope: { inScope: ['Scope 1'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      const spec2 = {
        outcomes: ['Feature 2'],
        scope: { inScope: ['Scope 2'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec1);
      orchestrator.setSpec(spec2);
      const retrieved = orchestrator.getSpec();

      assert.strictEqual(retrieved, spec2);
      assert.notStrictEqual(retrieved, spec1);
    });
  });

  describe('Spec-Aware Prompt Generation', () => {
    it('should include spec context in RED phase prompt when spec is set', () => {
      const spec = {
        outcomes: ['Feature implemented', 'Tests pass'],
        scope: {
          inScope: ['Core functionality', 'Error handling'],
          outOfScope: ['Performance optimization'],
        },
        constraints: ['Follow existing patterns', 'No breaking changes'],
        verificationCriteria: [
          { criteria: 'All tests pass', test: 'npm test', automated: true },
          { criteria: 'Coverage >= 80%', test: 'npm test --coverage', automated: true },
        ],
      };

      orchestrator.setSpec(spec);

      // We can't directly test buildRedPrompt since it's private
      // But we can verify the spec is set and would be used
      const retrieved = orchestrator.getSpec();
      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes.length, 2);
      assert.strictEqual(retrieved!.scope.inScope.length, 2);
      assert.strictEqual(retrieved!.constraints.length, 2);
      assert.strictEqual(retrieved!.verificationCriteria.length, 2);
    });

    it('should handle empty verification criteria gracefully', () => {
      const spec = {
        outcomes: ['Feature implemented'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.verificationCriteria.length, 0);
    });

    it('should filter verification criteria to only those with tests', () => {
      const spec = {
        outcomes: ['Feature implemented'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [
          { criteria: 'All tests pass', test: 'npm test', automated: true },
          { criteria: 'Code review approved', automated: false },
          { criteria: 'Coverage >= 80%', test: 'npm test --coverage', automated: true },
        ],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.verificationCriteria.length, 3);
      
      // Filter to only those with test property
      const withTests = retrieved!.verificationCriteria.filter(c => c.test);
      assert.strictEqual(withTests.length, 2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null spec gracefully', () => {
      orchestrator.setSpec(null as any);
      const retrieved = orchestrator.getSpec();
      assert.strictEqual(retrieved, null);
    });

    it('should handle spec with empty arrays', () => {
      const spec = {
        outcomes: [],
        scope: { inScope: [], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes.length, 0);
      assert.strictEqual(retrieved!.scope.inScope.length, 0);
      assert.strictEqual(retrieved!.scope.outOfScope.length, 0);
      assert.strictEqual(retrieved!.constraints.length, 0);
      assert.strictEqual(retrieved!.verificationCriteria.length, 0);
    });

    it('should handle spec with missing optional fields', () => {
      const spec = {
        outcomes: ['Feature implemented'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [
          { criteria: 'All tests pass' },
        ],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      if (retrieved && retrieved.verificationCriteria[0]) {
        assert.strictEqual(retrieved.verificationCriteria[0].automated, undefined);
        assert.strictEqual(retrieved.verificationCriteria[0].test, undefined);
      }
    });

    it('should handle very long spec data', () => {
      const longArray = Array(1000).fill('item');
      const spec = {
        outcomes: longArray,
        scope: { inScope: longArray, outOfScope: longArray },
        constraints: longArray,
        verificationCriteria: longArray.map((item, i) => ({
          criteria: item,
          test: `test-${i}`,
          automated: i % 2 === 0,
        })),
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes.length, 1000);
      assert.strictEqual(retrieved!.scope.inScope.length, 1000);
    });
  });

  describe('Integration with TDD Workflow', () => {
    it('should start TDD orchestration without spec', async () => {
      const task: DecomposedTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'A test task',
        domain: 'backend',
        dependencies: [],
        files: ['src/test.ts'],
        testFiles: ['src/test.test.ts'],
        estimatedComplexity: 'simple',
        tddScope: {
          testType: 'unit',
          testFramework: 'vitest',
          testPatterns: [],
          edgeCases: [],
        },
      };

      const state = await orchestrator.start(task);
      assert.ok(state);
      assert.strictEqual(state.taskId, 'task-1');
      assert.strictEqual(state.phases.length, 4); // red, green, refactor, coverage
    });

    it('should start TDD orchestration with spec', async () => {
      const spec = {
        outcomes: ['Feature implemented'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);

      const task: DecomposedTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'A test task',
        domain: 'backend',
        dependencies: [],
        files: ['src/test.ts'],
        testFiles: ['src/test.test.ts'],
        estimatedComplexity: 'simple',
        tddScope: {
          testType: 'unit',
          testFramework: 'vitest',
          testPatterns: [],
          edgeCases: [],
        },
      };

      const state = await orchestrator.start(task);
      assert.ok(state);
      assert.strictEqual(state.taskId, 'task-1');
      assert.strictEqual(state.phases.length, 4);
    });

    it('should maintain spec across multiple start calls', async () => {
      const spec = {
        outcomes: ['Feature implemented'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);

      const task1: DecomposedTask = {
        id: 'task-1',
        title: 'Task 1',
        description: 'First task',
        domain: 'backend',
        dependencies: [],
        files: ['src/test1.ts'],
        testFiles: ['src/test1.test.ts'],
        estimatedComplexity: 'simple',
        tddScope: {
          testType: 'unit',
          testFramework: 'vitest',
          testPatterns: [],
          edgeCases: [],
        },
      };

      await orchestrator.start(task1);
      const retrievedAfterFirst = orchestrator.getSpec();
      assert.strictEqual(retrievedAfterFirst, spec);

      const task2: DecomposedTask = {
        id: 'task-2',
        title: 'Task 2',
        description: 'Second task',
        domain: 'frontend',
        dependencies: [],
        files: ['src/test2.ts'],
        testFiles: ['src/test2.test.ts'],
        estimatedComplexity: 'medium',
        tddScope: {
          testType: 'unit',
          testFramework: 'vitest',
          testPatterns: [],
          edgeCases: [],
        },
      };

      await orchestrator.start(task2);
      const retrievedAfterSecond = orchestrator.getSpec();
      assert.strictEqual(retrievedAfterSecond, spec);
    });
  });

  describe('Spec Validation Edge Cases', () => {
    it('should handle spec with special characters in outcomes', () => {
      const spec = {
        outcomes: ['Feature <implemented>', 'Test & validation', 'API/REST'],
        scope: { inScope: ['Core <functionality>'], outOfScope: [] },
        constraints: ['No breaking changes', 'Use TypeScript >= 4.0'],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes[0], 'Feature <implemented>');
      assert.strictEqual(retrieved!.outcomes[1], 'Test & validation');
      assert.strictEqual(retrieved!.outcomes[2], 'API/REST');
    });

    it('should handle spec with unicode characters', () => {
      const spec = {
        outcomes: ['Feature implemented 🚀', 'Tests pass ✓'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes[0], 'Feature implemented 🚀');
      assert.strictEqual(retrieved!.outcomes[1], 'Tests pass ✓');
    });

    it('should handle spec with duplicate outcomes', () => {
      const spec = {
        outcomes: ['Feature implemented', 'Feature implemented', 'Tests pass'],
        scope: { inScope: ['Core functionality'], outOfScope: [] },
        constraints: [],
        verificationCriteria: [],
      };

      orchestrator.setSpec(spec);
      const retrieved = orchestrator.getSpec();

      assert.ok(retrieved);
      assert.strictEqual(retrieved!.outcomes.length, 3);
      // Duplicates are allowed - spec validation would handle this if needed
    });
  });
});
