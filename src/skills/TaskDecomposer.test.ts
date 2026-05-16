import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskDecomposer } from './TaskDecomposer';
import { TaskAnalysis, TaskDomain } from './types';

describe('TaskDecomposer', () => {
  const createMockAnalysis = (overrides: Partial<TaskAnalysis> = {}): TaskAnalysis => ({
    type: 'coding',
    domain: 'frontend',
    complexity: 'medium',
    keywords: ['component', 'button'],
    decompositionStrategy: 'fan-out',
    tddRecommended: true,
    estimatedSubtasks: 2,
    dependencyGraph: {
      sourceFiles: ['src/Button.tsx'],
      testFiles: ['src/Button.test.tsx'],
      importChains: [],
      couplingScore: 0.2,
    },
    riskScore: 0.3,
    frontendBackendSplit: false,
    ...overrides,
  });

  describe('decompose', () => {
    it('should return a plan with tasks for single-domain task', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis();
      const plan = await decomposer.decompose(analysis, 'test-repo');

      assert.equal(plan.strategy, 'fan-out');
      assert.ok(plan.tasks.length > 0);
      assert.ok(plan.executionOrder.length > 0);
      assert.ok(plan.totalEstimatedComplexity > 0);
      assert.ok(['low', 'medium', 'high'].includes(plan.conflictRisk));
    });

    it('should create separate tasks for cross-domain splits', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        frontendBackendSplit: true,
        domain: 'frontend',
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('frontend'));
      assert.ok(domains.includes('backend'));
    });

    it('should add database task when database is involved', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        domain: 'database',
        keywords: ['schema', 'migration'],
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('database'));
    });

    it('should add API task when API is involved', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        domain: 'api',
        keywords: ['endpoint', 'rest'],
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('api'));
    });

    it('should compute execution order based on dependencies', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        frontendBackendSplit: true,
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      assert.ok(Array.isArray(plan.executionOrder));
      assert.ok(plan.executionOrder.length > 0);
      // Each batch should be an array of task IDs
      for (const batch of plan.executionOrder) {
        assert.ok(Array.isArray(batch));
      }
    });

    it('should assess conflict risk correctly', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        complexity: 'simple',
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      assert.equal(plan.conflictRisk, 'low');
    });
  });

  describe('mapDomain', () => {
    it('should map frontend to frontend', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'frontend' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('frontend'));
    });

    it('should map backend to backend', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'backend' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('backend'));
    });

    it('should map database to database', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'database' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('database'));
    });

    it('should map api to api', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'api' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('api'));
    });

    it('should map testing to shared', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'testing' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('shared'));
    });

    it('should map general to shared', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'general' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const domains = plan.tasks.map(t => t.domain);
      assert.ok(domains.includes('shared'));
    });
  });

  describe('task generation', () => {
    it('should generate tasks with valid IDs', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis();
      const plan = await decomposer.decompose(analysis, 'test-repo');

      for (const task of plan.tasks) {
        assert.ok(task.id.startsWith('task-'));
        assert.ok(task.title.length > 0);
        assert.ok(task.description.length > 0);
      }
    });

    it('should assign TDD scope based on domain', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({ domain: 'frontend' });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      const frontendTask = plan.tasks.find(t => t.domain === 'frontend');
      assert.ok(frontendTask);
      assert.equal(frontendTask!.tddScope.testType, 'component');
    });

    it('should set appropriate test framework', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis();
      const plan = await decomposer.decompose(analysis, 'test-repo');

      for (const task of plan.tasks) {
        assert.ok(['vitest', 'jest'].includes(task.tddScope.testFramework));
      }
    });
  });

  describe('complexity handling', () => {
    it('should estimate more files for complex tasks', async () => {
      const decomposer = new TaskDecomposer();
      const simpleAnalysis = createMockAnalysis({ complexity: 'simple' });
      const complexAnalysis = createMockAnalysis({ complexity: 'complex' });

      const simplePlan = await decomposer.decompose(simpleAnalysis, 'test-repo');
      const complexPlan = await decomposer.decompose(complexAnalysis, 'test-repo');

      const simpleFiles = simplePlan.tasks.reduce(
        (sum, t) => sum + t.files.length,
        0,
      );
      const complexFiles = complexPlan.tasks.reduce(
        (sum, t) => sum + t.files.length,
        0,
      );

      assert.ok(complexFiles >= simpleFiles);
    });

    it('should calculate higher total complexity for complex tasks', async () => {
      const decomposer = new TaskDecomposer();
      const simpleAnalysis = createMockAnalysis({ complexity: 'simple' });
      const complexAnalysis = createMockAnalysis({ complexity: 'complex' });

      const simplePlan = await decomposer.decompose(simpleAnalysis, 'test-repo');
      const complexPlan = await decomposer.decompose(complexAnalysis, 'test-repo');

      assert.ok(complexPlan.totalEstimatedComplexity > simplePlan.totalEstimatedComplexity);
    });
  });

  describe('conflict detection', () => {
    it('should detect file overlap conflicts', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        frontendBackendSplit: true,
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      // Conflict risk should reflect detected conflicts
      assert.ok(['low', 'medium', 'high'].includes(plan.conflictRisk));
    });

    it('should detect dependency cycles', async () => {
      const decomposer = new TaskDecomposer();
      const analysis = createMockAnalysis({
        decompositionStrategy: 'hierarchical',
        complexity: 'complex',
      });
      const plan = await decomposer.decompose(analysis, 'test-repo');

      // Should not throw on cycle detection
      assert.ok(plan.executionOrder.length > 0);
    });
  });
});
