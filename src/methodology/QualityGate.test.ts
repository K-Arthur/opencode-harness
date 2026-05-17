import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QualityGateRunner, createDefaultGates } from './QualityGate.js';
import { CodeDiff, QualityGate, GateResult } from './types.js';

function makeDiff(overrides: Partial<CodeDiff> = {}): CodeDiff {
  return {
    filesChanged: 1,
    linesAdded: 10,
    linesRemoved: 2,
    linesChanged: 12,
    newContent: "import fs from 'fs';\nconst x = 1;\n",
    oldContent: '',
    imports: ['fs'],
    ...overrides,
  };
}

describe('QualityGateRunner', () => {
  it('passes when all gates pass', async () => {
    const gates: QualityGate[] = [
      {
        name: 'always-pass',
        severity: 'block',
        check: async () => ({ passed: true }),
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, true);
    assert.equal(report.blocked.length, 0);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.result.passed, true);
  });

  it('blocks on failed block gate', async () => {
    const gates: QualityGate[] = [
      {
        name: 'fail-block',
        severity: 'block',
        check: async () => ({ passed: false, failures: ['blocked'] }),
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, false);
    assert.deepEqual(report.blocked, ['fail-block']);
  });

  it('warns on failed warn gate', async () => {
    const gates: QualityGate[] = [
      {
        name: 'fail-warn',
        severity: 'warn',
        check: async () => ({ passed: false, failures: ['warning'] }),
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, true);
    assert.deepEqual(report.warnings, ['fail-warn']);
    assert.equal(report.blocked.length, 0);
  });

  it('collects info results', async () => {
    const gates: QualityGate[] = [
      {
        name: 'info-gate',
        severity: 'info',
        check: async () => ({ passed: false, failures: ['info'] }),
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, true);
    assert.deepEqual(report.infos, ['info-gate']);
  });

  it('reports blocked gate names', async () => {
    const gates: QualityGate[] = [
      {
        name: 'gate-a',
        severity: 'block',
        check: async () => ({ passed: false }),
      },
      {
        name: 'gate-b',
        severity: 'warn',
        check: async () => ({ passed: false }),
      },
      {
        name: 'gate-c',
        severity: 'block',
        check: async () => ({ passed: true }),
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, false);
    assert.deepEqual(report.blocked, ['gate-a']);
    assert.deepEqual(report.warnings, ['gate-b']);
  });

  it('handles gate check throwing an error', async () => {
    const gates: QualityGate[] = [
      {
        name: 'throws',
        severity: 'block',
        check: async () => {
          throw new Error('unexpected');
        },
      },
    ];
    const runner = new QualityGateRunner(gates);
    const report = await runner.run(makeDiff());

    assert.equal(report.passed, false);
    assert.deepEqual(report.blocked, ['throws']);
    assert.equal(report.results[0]!.result.passed, false);
  });
});

describe('createDefaultGates', () => {
  it('creates 4 default gates', () => {
    const gates = createDefaultGates();
    assert.equal(gates.length, 4);
    assert.equal(gates[0]!.name, 'import-validation');
    assert.equal(gates[1]!.name, 'diff-size');
    assert.equal(gates[2]!.name, 'duplication');
    assert.equal(gates[3]!.name, 'complexity-ceiling');
  });

  it('import-validation catches empty imports', async () => {
    const gates = createDefaultGates();
    const gate = gates.find((g) => g.name === 'import-validation')!;
    const diff = makeDiff({
      newContent: "import foo from '';\nimport bar from \"\";\nconst x = 1;\n",
    });
    const result = await gate.check(diff);

    assert.equal(result.passed, false);
    assert.ok(result.failures!.length >= 2);
  });

  it('diff-size warns on large diffs', async () => {
    const gates = createDefaultGates();
    const gate = gates.find((g) => g.name === 'diff-size')!;
    const diff = makeDiff({ linesChanged: 500 });
    const result = await gate.check(diff);

    assert.equal(result.passed, false);
  });

  it('duplication detects consecutive duplicate lines', async () => {
    const gates = createDefaultGates();
    const gate = gates.find((g) => g.name === 'duplication')!;
    const diff = makeDiff({
      newContent: 'const x = 1;\nconst x = 1;\nconst x = 1;\nconst y = 2;\n',
    });
    const result = await gate.check(diff);

    assert.equal(result.passed, false);
    assert.ok(result.failures!.length > 0);
  });

  it('complexity-ceiling warns on high brace count', async () => {
    const gates = createDefaultGates();
    const gate = gates.find((g) => g.name === 'complexity-ceiling')!;
    const braces = '{'.repeat(51);
    const diff = makeDiff({
      newContent: `const x = ${braces};\n`,
    });
    const result = await gate.check(diff);

    assert.equal(result.passed, false);
  });
});
