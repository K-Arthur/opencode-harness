import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TDDOrchestrator } from './TDDOrchestrator';
import { DecomposedTask } from './types';

describe('TDDOrchestrator', () => {
  const createMockTask = (overrides: Partial<DecomposedTask> = {}): DecomposedTask => ({
    id: 'task-test-123',
    title: 'Test Task',
    description: 'A test task for TDD orchestration',
    domain: 'backend',
    dependencies: [],
    files: ['src/service.ts'],
    testFiles: ['src/service.test.ts'],
    estimatedComplexity: 'medium',
    tddScope: {
      testType: 'unit',
      testFramework: 'vitest',
      testPatterns: ['input/output', 'error handling'],
      edgeCases: ['null input', 'empty array'],
    },
    ...overrides,
  });

  const createMockDispatchResult = (overrides: Partial<{ status: 'completed' | 'failed'; output: string; filesModified: string[] }> = {}) => ({
    agentId: 'agent-1',
    status: 'completed' as const,
    output: 'test output',
    filesModified: ['src/service.ts'],
    ...overrides,
  });

  const createMockTestResult = (overrides: Partial<{ passed: boolean; testCount: number; passCount: number; failCount: number; coveragePercent: number }> = {}) => ({
    passed: false,
    output: 'test output',
    testCount: 3,
    passCount: 0,
    failCount: 3,
    coveragePercent: 0,
    ...overrides,
  });

  describe('start', () => {
    it('should initialize orchestration state', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      const state = await orchestrator.start(task);

      assert.equal(state.taskId, task.id);
      assert.equal(state.currentPhase, 0);
      assert.equal(state.totalTests, 0);
      assert.equal(state.passingTests, 0);
      assert.equal(state.failingTests, 0);
      assert.equal(state.domain, task.domain);
    });

    it('should initialize all four TDD phases', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      const state = await orchestrator.start(task);

      assert.equal(state.phases.length, 4);
      assert.equal(state.phases[0]!.name, 'red');
      assert.equal(state.phases[1]!.name, 'green');
      assert.equal(state.phases[2]!.name, 'refactor');
      assert.equal(state.phases[3]!.name, 'coverage');
    });

    it('should set all phases to pending initially', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      const state = await orchestrator.start(task);

      for (const phase of state.phases) {
        assert.equal(phase.status, 'pending');
      }
    });

    it('should initialize metrics', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      const metrics = orchestrator.getMetrics();
      assert.ok(metrics);
      assert.equal(metrics.taskId, task.id);
      assert.equal(metrics.testsGenerated, 0);
      assert.equal(metrics.redGreenRefactorCycles, 0);
      assert.equal(metrics.success, false);
    });
  });

  describe('executeCycle - RED phase', () => {
    it('should complete RED phase when tests fail as expected', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false, failCount: 3 }),
      );

      const redPhase = state.phases.find(p => p.name === 'red');
      assert.equal(redPhase?.status, 'completed');
      assert.equal(state.currentPhase, 1);
    });

    it('should fail RED phase when tests pass unexpectedly', async () => {
      const orchestrator = new TDDOrchestrator({ maxIterations: 1 });
      const task = createMockTask();
      await orchestrator.start(task);

      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      const redPhase = state.phases.find(p => p.name === 'red');
      assert.equal(redPhase?.status, 'failed');
    });

    it('should track tests generated in metrics', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false, testCount: 5 }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.testsGenerated, 5);
    });
  });

  describe('executeCycle - GREEN phase', () => {
    it('should complete GREEN phase when tests pass', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED phase first
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      // Execute GREEN phase
      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, passCount: 3 }),
      );

      const greenPhase = state.phases.find(p => p.name === 'green');
      assert.equal(greenPhase?.status, 'completed');
    });

    it('should increment redGreenRefactorCycles on GREEN completion', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED phase
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      // Complete GREEN phase
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.redGreenRefactorCycles, 1);
    });

    it('should track testsPassedFirstRun when GREEN passes on first iteration', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED phase
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      // Complete GREEN phase on first try
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.testsPassedFirstRun, 1);
    });
  });

  describe('executeCycle - REFACTOR phase', () => {
    it('should complete REFACTOR phase when tests still pass', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED and GREEN phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      // Execute REFACTOR phase
      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      const refactorPhase = state.phases.find(p => p.name === 'refactor');
      assert.equal(refactorPhase?.status, 'completed');
    });

    it('should fail REFACTOR phase when tests break', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED and GREEN phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      // Execute REFACTOR phase that breaks tests
      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      const refactorPhase = state.phases.find(p => p.name === 'refactor');
      assert.equal(refactorPhase?.status, 'failed');
    });
  });

  describe('executeCycle - COVERAGE phase', () => {
    it('should complete COVERAGE phase when coverage meets threshold', async () => {
      const orchestrator = new TDDOrchestrator({ minCoverage: 80 });
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED, GREEN, REFACTOR phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      // Execute COVERAGE phase
      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, coveragePercent: 85 }),
      );

      const coveragePhase = state.phases.find(p => p.name === 'coverage');
      assert.equal(coveragePhase?.status, 'completed');
    });

    it('should loop back to RED when coverage below threshold', async () => {
      const orchestrator = new TDDOrchestrator({ minCoverage: 80 });
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED, GREEN, REFACTOR phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      // Execute COVERAGE phase with low coverage
      const state = await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, coveragePercent: 60 }),
      );

      // Should loop back to RED phase
      assert.equal(state.currentPhase, 0);
    });

    it('should set finalCoverage in metrics', async () => {
      const orchestrator = new TDDOrchestrator({ minCoverage: 80 });
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete all phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, coveragePercent: 90 }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.finalCoverage, 90);
    });
  });

  describe('getActivity', () => {
    it('should return null before start', () => {
      const orchestrator = new TDDOrchestrator();
      assert.equal(orchestrator.getActivity(), null);
    });

    it('should return activity with current phase info', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      const activity = orchestrator.getActivity();
      assert.ok(activity);
      assert.equal(activity.id, task.id);
      assert.equal(activity.tddPhase, 'red');
      assert.equal(activity.domain, task.domain);
    });

    it('should update phase name as orchestration progresses', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED phase
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      const activity = orchestrator.getActivity();
      assert.equal(activity?.tddPhase, 'green');
    });

    it('should calculate progress percentage', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete RED phase (1/4 = 25%)
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );

      const activity = orchestrator.getActivity();
      assert.equal(activity?.progress, 25);
    });
  });

  describe('getMetrics', () => {
    it('should return null before start', () => {
      const orchestrator = new TDDOrchestrator();
      assert.equal(orchestrator.getMetrics(), null);
    });

    it('should return success=true when all phases complete', async () => {
      const orchestrator = new TDDOrchestrator({ minCoverage: 80 });
      const task = createMockTask();
      await orchestrator.start(task);

      // Complete all phases
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: false }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, coveragePercent: 85 }),
      );

      // Complete the cycle
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true, coveragePercent: 85 }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.success, true);
    });

    it('should return success=false when any phase fails', async () => {
      const orchestrator = new TDDOrchestrator({ maxIterations: 1 });
      const task = createMockTask();
      await orchestrator.start(task);

      // Fail RED phase
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      // Complete the cycle
      await orchestrator.executeCycle(
        async () => createMockDispatchResult(),
        async () => createMockTestResult({ passed: true }),
      );

      const metrics = orchestrator.getMetrics();
      assert.equal(metrics?.success, false);
    });
  });

  describe('reset', () => {
    it('should clear state and metrics', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask();
      await orchestrator.start(task);

      orchestrator.reset();

      assert.equal(orchestrator.getActivity(), null);
      assert.equal(orchestrator.getMetrics(), null);
    });
  });

  describe('domain-specific TDD scopes', () => {
    it('should use component tests for frontend', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask({ domain: 'frontend' });
      const state = await orchestrator.start(task);

      assert.equal(state.domain, 'frontend');
    });

    it('should use integration tests for API', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask({ domain: 'api' });
      const state = await orchestrator.start(task);

      assert.equal(state.domain, 'api');
    });

    it('should use integration tests for database', async () => {
      const orchestrator = new TDDOrchestrator();
      const task = createMockTask({ domain: 'database' });
      const state = await orchestrator.start(task);

      assert.equal(state.domain, 'database');
    });
  });
});
