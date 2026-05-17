import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlanValidator, type ExecutionPlan } from './PlanValidator.js';

function makeValidPlan(): ExecutionPlan {
  return {
    nodes: [
      { id: 'n1', type: 'read', tool: 'read_file', params: { path: '/tmp/a.ts' }, dependencies: [] },
      { id: 'n2', type: 'write', tool: 'write_file', params: { path: '/tmp/b.ts' }, dependencies: ['n1'], idempotencyKey: 'write-b-001' },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
    totalBudget: 1000,
  };
}

describe('PlanValidator', () => {
  const validator = new PlanValidator();

  it('validates a correct plan', async () => {
    const result = await validator.validate(makeValidPlan());
    assert.equal(result.valid, true);
    for (const check of result.checks) {
      assert.equal(check.passed, true, `Check "${check.name}" should pass`);
    }
  });

  it('rejects plan with no nodes', async () => {
    const plan: ExecutionPlan = { nodes: [], edges: [], totalBudget: 100 };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'nodes_exist');
    assert.equal(check!.passed, false);
  });

  it('rejects edges referencing non-existent nodes', async () => {
    const plan: ExecutionPlan = {
      nodes: [{ id: 'n1', type: 'read' }],
      edges: [{ from: 'n1', to: 'missing' }],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'edges_type_compatible');
    assert.equal(check!.passed, false);
  });

  it('rejects cyclic dependencies', async () => {
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'a', type: 'read' },
        { id: 'b', type: 'read' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'dag_acyclic');
    assert.equal(check!.passed, false);
  });

  it('rejects tool nodes without params', async () => {
    const plan: ExecutionPlan = {
      nodes: [{ id: 'n1', type: 'read', tool: 'read_file' }],
      edges: [],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'params_present');
    assert.equal(check!.passed, false);
  });

  it('rejects plan exceeding budget', async () => {
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'n1', type: 'read', budget: 600 },
        { id: 'n2', type: 'read', budget: 500 },
      ],
      edges: [],
      totalBudget: 1000,
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'budget_satisfied');
    assert.equal(check!.passed, false);
  });

  it('rejects write operations without idempotency keys', async () => {
    const plan: ExecutionPlan = {
      nodes: [{ id: 'n1', type: 'write' }],
      edges: [],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'safety_compliant');
    assert.equal(check!.passed, false);
  });

  it('rejects duplicate idempotency keys', async () => {
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'n1', type: 'write', idempotencyKey: 'key-1' },
        { id: 'n2', type: 'write', idempotencyKey: 'key-1' },
      ],
      edges: [],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, false);
    const check = result.checks.find((c) => c.name === 'idempotency_keys');
    assert.equal(check!.passed, false);
  });

  it('passes plan with no edges (single node)', async () => {
    const plan: ExecutionPlan = {
      nodes: [{ id: 'n1', type: 'read', tool: 'read_file', params: { path: '/tmp/x' } }],
      edges: [],
    };
    const result = await validator.validate(plan);
    assert.equal(result.valid, true);
  });

  it('passes plan within budget', async () => {
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'n1', type: 'read', budget: 300 },
        { id: 'n2', type: 'read', budget: 200 },
      ],
      edges: [],
      totalBudget: 1000,
    };
    const result = await validator.validate(plan);
    const check = result.checks.find((c) => c.name === 'budget_satisfied');
    assert.equal(check!.passed, true);
  });

  it('passes plan with unique idempotency keys for write operations', async () => {
    const plan: ExecutionPlan = {
      nodes: [
        { id: 'n1', type: 'write', idempotencyKey: 'write-1' },
        { id: 'n2', type: 'delete', idempotencyKey: 'delete-1' },
      ],
      edges: [],
    };
    const result = await validator.validate(plan);
    const safetyCheck = result.checks.find((c) => c.name === 'safety_compliant');
    const idempotencyCheck = result.checks.find((c) => c.name === 'idempotency_keys');
    assert.equal(safetyCheck!.passed, true);
    assert.equal(idempotencyCheck!.passed, true);
  });
});
