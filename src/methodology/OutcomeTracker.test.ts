import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeTracker, type OutcomeEvent } from './OutcomeTracker.js';
import type { MethodologyId, TaskType } from './types.js';

function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    methodology: 'direct-execution' as MethodologyId,
    taskType: 'generate' as TaskType,
    recommendedTier: 'A',
    signal: 'approval',
    timestamp: Date.now(),
    signature: 'test-sig',
    ...overrides,
  };
}

describe('OutcomeTracker', () => {
  it('records events and retrieves them', () => {
    const tracker = new OutcomeTracker();
    tracker.record(makeEvent({ methodology: 'direct-execution', signal: 'approval' }));
    tracker.record(makeEvent({ methodology: 'spec-first', signal: 're-send' }));
    const events = tracker.getAllEvents();
    assert.equal(events.length, 2);
  });

  it('persists events via persistence function', () => {
    let persisted: OutcomeEvent[] | undefined;
    const tracker = new OutcomeTracker();
    tracker.setPersistenceFn((events) => { persisted = events; });
    tracker.record(makeEvent({ methodology: 'direct-execution' }));
    assert.ok(persisted !== undefined, 'Persistence fn should have been called');
    assert.equal(persisted!.length, 1);
  });

  it('initializes from stored events', () => {
    const stored: OutcomeEvent[] = [
      makeEvent({ methodology: 'direct-execution', signal: 'approval' }),
      makeEvent({ methodology: 'spec-first', signal: 're-send' }),
    ];
    const tracker = new OutcomeTracker(stored);
    assert.equal(tracker.getAllEvents().length, 2);
  });

  it('returns default stats for methodology with no events', () => {
    const tracker = new OutcomeTracker();
    const stats = tracker.getStats('bmad-full' as MethodologyId, 'generate' as TaskType);
    assert.equal(stats.totalEvents, 0);
    assert.equal(stats.approvalRate, 0.5);
  });

  it('computes stats correctly', () => {
    const tracker = new OutcomeTracker();
    const meth: MethodologyId = 'direct-execution';
    const task: TaskType = 'generate';
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 'approval' }));
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 'approval' }));
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 're-send' }));
    const stats = tracker.getStats(meth, task);
    assert.equal(stats.totalEvents, 3);
    assert.ok(Math.abs(stats.approvalRate - 2 / 3) < 0.01, `Expected ~0.667, got ${stats.approvalRate}`);
    assert.ok(Math.abs(stats.reSendRate - 1 / 3) < 0.01, `Expected ~0.333, got ${stats.reSendRate}`);
  });

  it('returns 0 adjustment when fewer than 3 events', () => {
    const tracker = new OutcomeTracker();
    tracker.record(makeEvent({ methodology: 'direct-execution', signal: 'approval' }));
    tracker.record(makeEvent({ methodology: 'direct-execution', signal: 'approval' }));
    const adj = tracker.getConfidenceAdjustment('direct-execution', 'generate');
    assert.equal(adj, 0);
  });

  it('negative outcomes reduce confidence', () => {
    const tracker = new OutcomeTracker();
    const meth: MethodologyId = 'direct-execution';
    const task: TaskType = 'generate';
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 're-send' }));
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 'rollback' }));
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 'model-switch' }));
    tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 're-send' }));
    const adj = tracker.getConfidenceAdjustment(meth, task);
    assert.ok(adj < 0, 'Negative outcomes should reduce confidence');
  });

  it('high approval rate boosts confidence', () => {
    const tracker = new OutcomeTracker();
    const meth: MethodologyId = 'direct-execution';
    const task: TaskType = 'generate';
    for (let i = 0; i < 5; i++) {
      tracker.record(makeEvent({ methodology: meth, taskType: task, signal: 'approval' }));
    }
    const adj = tracker.getConfidenceAdjustment(meth, task);
    assert.equal(adj, 0.1, 'High approval should boost confidence by 0.1');
  });

  it('clear removes all events', () => {
    const tracker = new OutcomeTracker();
    tracker.record(makeEvent());
    tracker.record(makeEvent());
    tracker.clear();
    assert.equal(tracker.getAllEvents().length, 0);
  });
});
