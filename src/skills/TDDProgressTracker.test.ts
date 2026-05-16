import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TDDProgressTracker } from './TDDProgressTracker';
import { DecomposedTask } from './types';

describe('TDDProgressTracker', () => {
  const createMockTask = (overrides: Partial<DecomposedTask> = {}): DecomposedTask => ({
    id: 'task-test-123',
    title: 'Test Task',
    description: 'A test task',
    domain: 'backend',
    dependencies: [],
    files: ['src/service.ts'],
    testFiles: ['src/service.test.ts'],
    estimatedComplexity: 'medium',
    tddScope: {
      testType: 'unit',
      testFramework: 'vitest',
      testPatterns: [],
      edgeCases: [],
    },
    ...overrides,
  });

  const createMockPostMessage = () => {
    const messages: Record<string, unknown>[] = [];
    return {
      postMessage: (msg: Record<string, unknown>) => messages.push(msg),
      getMessages: () => messages,
    };
  };

  describe('startSession', () => {
    it('should register a new TDD session', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      assert.ok(tracker.hasSession('session-1'));
    });

    it('should emit initial activities', async () => {
      const { postMessage, getMessages } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      const messages = getMessages();
      assert.ok(messages.length > 0);
      assert.equal(messages[0]!.type, 'subagent_activities');
    });

    it('should track multiple sessions independently', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      await tracker.startSession('session-1', createMockTask({ domain: 'frontend' }));
      await tracker.startSession('session-2', createMockTask({ domain: 'backend' }));

      assert.ok(tracker.hasSession('session-1'));
      assert.ok(tracker.hasSession('session-2'));
    });
  });

  describe('executeCycle', () => {
    it('should execute TDD cycle and emit activities', async () => {
      const { postMessage, getMessages } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      await tracker.executeCycle(
        'session-1',
        async () => ({
          agentId: 'agent-1',
          status: 'completed',
          output: 'test',
          filesModified: [],
        }),
        async () => ({
          passed: false,
          output: 'tests failed',
          testCount: 3,
          passCount: 0,
          failCount: 3,
        }),
      );

      const messages = getMessages();
      // Should have initial + cycle update
      assert.ok(messages.length >= 2);
    });

    it('should throw if session not found', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      await assert.rejects(
        async () => tracker.executeCycle(
          'nonexistent',
          async () => ({ agentId: 'agent-1', status: 'completed', output: '', filesModified: [] }),
          async () => ({ passed: false, output: '', testCount: 0, passCount: 0, failCount: 0 }),
        ),
        /No TDD session found/,
      );
    });
  });

  describe('getActivities', () => {
    it('should return activities for active session', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      const activities = tracker.getActivities('session-1');
      assert.ok(activities.length > 0);
      assert.equal(activities[0]!.id, task.id);
    });

    it('should return empty array for unknown session', () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      const activities = tracker.getActivities('nonexistent');
      assert.deepEqual(activities, []);
    });

    it('should include TDD phase in activity', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      const activities = tracker.getActivities('session-1');
      assert.ok(activities[0]!.tddPhase);
      assert.equal(activities[0]!.tddPhase, 'red');
    });
  });

  describe('completeSession', () => {
    it('should emit final activities before cleanup', async () => {
      const { postMessage, getMessages } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);
      const initialCount = getMessages().length;

      tracker.completeSession('session-1');

      const messages = getMessages();
      assert.ok(messages.length > initialCount);
      assert.ok(!tracker.hasSession('session-1'));
    });

    it('should handle unknown session gracefully', () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      // Should not throw
      tracker.completeSession('nonexistent');
    });
  });

  describe('cancelSession', () => {
    it('should reset orchestrator and remove session', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);
      assert.ok(tracker.hasSession('session-1'));

      tracker.cancelSession('session-1');
      assert.ok(!tracker.hasSession('session-1'));
    });

    it('should handle unknown session gracefully', () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      // Should not throw
      tracker.cancelSession('nonexistent');
    });
  });

  describe('getActiveSessions', () => {
    it('should return all active session IDs', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      await tracker.startSession('session-1', createMockTask());
      await tracker.startSession('session-2', createMockTask());

      const sessions = tracker.getActiveSessions();
      assert.ok(sessions.includes('session-1'));
      assert.ok(sessions.includes('session-2'));
    });

    it('should return empty array when no sessions', () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      const sessions = tracker.getActiveSessions();
      assert.deepEqual(sessions, []);
    });

    it('should update after session completion', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      await tracker.startSession('session-1', createMockTask());
      assert.equal(tracker.getActiveSessions().length, 1);

      tracker.completeSession('session-1');
      assert.equal(tracker.getActiveSessions().length, 0);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics for active session', async () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });
      const task = createMockTask();

      await tracker.startSession('session-1', task);

      const metrics = tracker.getMetrics('session-1');
      assert.ok(metrics);
      assert.equal(metrics.taskId, task.id);
    });

    it('should return null for unknown session', () => {
      const { postMessage } = createMockPostMessage();
      const tracker = new TDDProgressTracker({ postMessage });

      const metrics = tracker.getMetrics('nonexistent');
      assert.equal(metrics, null);
    });
  });
});
