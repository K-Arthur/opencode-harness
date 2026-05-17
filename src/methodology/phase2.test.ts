/**
 * Tests for Phase 2: Quality Gates and Plan Validation.
 *
 * TDD approach: tests written to validate existing implementations.
 */

import { describe, it } from 'node:test';
import * as assert from 'assert';
import { QualityGateRunner, createDefaultGates, GateReport } from './QualityGate.js';
import { PlanValidator, ExecutionPlan } from './PlanValidator.js';
import { CodeDiff } from './types.js';

const suite = describe;
const test = it;

// ─── Quality Gate Tests ─────────────────────────────────────────────────────

suite('QualityGateRunner', () => {
  test('runs default gates on a clean diff', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 10,
      linesRemoved: 5,
      linesChanged: 15,
      newContent: "import { foo } from 'path';\nconst x = foo();",
      oldContent: '',
      imports: ["'path'"],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.blocked.length, 0);
  });

  test('blocks on import validation failure', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 2,
      linesRemoved: 0,
      linesChanged: 2,
      newContent: "import { foo } from '';\nimport { bar } from '';",
      oldContent: '',
      imports: ["''", "''"],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.blocked.length > 0, true);
  });

  test('warns on large diff size', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 10,
      linesAdded: 300,
      linesRemoved: 200,
      linesChanged: 500,
      newContent: 'x'.repeat(5000),
      oldContent: '',
      imports: [],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.warnings.length > 0, true);
  });

  test('blocks on consecutive duplicate lines', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 6,
      linesRemoved: 0,
      linesChanged: 6,
      newContent: "console.log('a');\nconsole.log('a');\nconsole.log('a');\nconsole.log('b');",
      oldContent: '',
      imports: [],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.blocked.length > 0, true);
  });

  test('passes on non-duplicated code', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 5,
      linesRemoved: 0,
      linesChanged: 5,
      newContent: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;',
      oldContent: '',
      imports: [],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.passed, true);
  });

  test('warns on high complexity', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const nested = '{'.repeat(60) + '}'.repeat(60);
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 1,
      linesRemoved: 0,
      linesChanged: 1,
      newContent: nested,
      oldContent: '',
      imports: [],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.warnings.length > 0, true);
  });

  test('returns results for each gate', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 5,
      linesRemoved: 0,
      linesChanged: 5,
      newContent: 'const x = 1;',
      oldContent: '',
      imports: [],
    };

    const report = await runner.run(diff);
    assert.strictEqual(report.results.length, 4); // 4 default gates
  });
});

// ─── Plan Validator Tests ────────────────────────────────────────────────────

suite('PlanValidator', () => {
  test('validates a simple correct plan', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'read', params: { path: 'src/foo.ts' } },
        { id: 'step-2', type: 'write', params: { path: 'src/bar.ts', content: 'export const x = 1;' }, idempotencyKey: 'write-bar' },
      ],
      edges: [
        { from: 'step-1', to: 'step-2' },
      ],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.checks.length, 7);
  });

  test('rejects empty plan', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [],
      edges: [],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'nodes_exist' && !c.passed));
  });

  test('rejects plan with circular dependencies', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'read', params: { path: 'a.ts' } },
        { id: 'step-2', type: 'read', params: { path: 'b.ts' } },
      ],
      edges: [
        { from: 'step-1', to: 'step-2' },
        { from: 'step-2', to: 'step-1' },
      ],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'dag_acyclic' && !c.passed));
  });

  test('rejects plan with edges to non-existent nodes', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'write', params: { path: 'a.ts' } },
      ],
      edges: [
        { from: 'step-999', to: 'step-1' },
      ],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'edges_type_compatible' && !c.passed));
  });

  test('rejects plan exceeding total budget', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'read', budget: 200 },
      ],
      edges: [],
      totalBudget: 100,
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'budget_satisfied' && !c.passed));
  });

  test('rejects node with tool but no params', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'write', tool: 'write' },
      ],
      edges: [],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'params_present' && !c.passed));
  });

  test('rejects write node without idempotencyKey', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'step-1', type: 'write', params: { path: 'a.ts' } },
      ],
      edges: [],
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, false);
    assert.ok(result.checks.some((c) => c.name === 'safety_compliant' && !c.passed));
  });

  test('validates complex multi-step plan', async () => {
    const validator = new PlanValidator();
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'read-1', type: 'read', params: { path: 'src/main.ts' } },
        { id: 'read-2', type: 'read', params: { path: 'src/utils.ts' } },
        { id: 'analyze', type: 'analyze', params: { target: 'complexity' } },
        { id: 'write-1', type: 'write', params: { path: 'src/main.refactored.ts', content: '// refactored' }, idempotencyKey: 'write-main-refactored' },
        { id: 'test', type: 'execute', params: { command: 'npm test' } },
      ],
      edges: [
        { from: 'read-1', to: 'analyze' },
        { from: 'read-2', to: 'analyze' },
        { from: 'analyze', to: 'write-1' },
        { from: 'write-1', to: 'test' },
      ],
      totalBudget: 50000,
    };

    const result = await validator.validate(plan);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.checks.every((c) => c.passed), true);
  });
});
