import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditTrail } from './AuditTrail.js';
import type { MethodologyId, ClassifiedError } from './types.js';

describe('AuditTrail', () => {
  it('starts a trace and returns a traceId', () => {
    const trail = new AuditTrail();
    const traceId = trail.startTrace('fix bug', 'direct-execution' as MethodologyId, 'model-a', 'hash123');
    assert.ok(traceId.startsWith('trace-'), `Expected trace- prefix, got ${traceId}`);
  });

  it('endTrace updates the entry with results', () => {
    const trail = new AuditTrail();
    const traceId = trail.startTrace('refactor', 'spec-first' as MethodologyId, 'model-b', 'hash456');
    trail.endTrace(traceId, 'success', 0.85, 0.02, 1500, 3200);

    const entry = trail.getEntry(traceId);
    assert.ok(entry);
    assert.equal(entry!.status, 'success');
    assert.equal(entry!.quality, 0.85);
    assert.equal(entry!.cost, 0.02);
    assert.equal(entry!.tokens, 1500);
    assert.equal(entry!.duration, 3200);
  });

  it('endTrace is a no-op for unknown traceId', () => {
    const trail = new AuditTrail();
    trail.endTrace('nonexistent', 'success', 0.9, 0.01, 500, 1000);
    assert.equal(trail.getEntries().length, 0);
  });

  it('endTrace with error stores classified error', () => {
    const trail = new AuditTrail();
    const traceId = trail.startTrace('test', 'quick-flow' as MethodologyId, 'model-c', 'hash789');
    const error: ClassifiedError = {
      class: 'routing',
      message: 'Model unavailable',
      recoverable: true,
      recoveryAction: 'fallback',
      userMessage: 'Switching to fallback model',
    };
    trail.endTrace(traceId, 'error', 0, 0, 0, 500, error);

    const entry = trail.getEntry(traceId);
    assert.ok(entry);
    assert.equal(entry!.status, 'error');
    assert.ok(entry!.error);
    assert.equal(entry!.error!.class, 'routing');
    assert.equal(entry!.error!.message, 'Model unavailable');
  });

  it('getEntries returns all entries when no filter', () => {
    const trail = new AuditTrail();
    trail.startTrace('task1', 'direct-execution' as MethodologyId, 'm1', 'h1');
    trail.startTrace('task2', 'spec-first' as MethodologyId, 'm2', 'h2');
    assert.equal(trail.getEntries().length, 2);
  });

  it('getEntries filters by status', () => {
    const trail = new AuditTrail();
    const id1 = trail.startTrace('task1', 'direct-execution' as MethodologyId, 'm1', 'h1');
    const id2 = trail.startTrace('task2', 'spec-first' as MethodologyId, 'm2', 'h2');
    trail.endTrace(id1, 'success', 0.8, 0.01, 500, 1000);
    trail.endTrace(id2, 'error', 0, 0, 0, 200, { class: 'execution', message: 'fail', recoverable: false, userMessage: 'err' });

    const errors = trail.getEntries({ status: 'error' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.intent, 'task2');
  });

  it('getEntries filters by methodology', () => {
    const trail = new AuditTrail();
    trail.startTrace('t1', 'direct-execution' as MethodologyId, 'm1', 'h1');
    trail.startTrace('t2', 'spec-first' as MethodologyId, 'm2', 'h2');

    const filtered = trail.getEntries({ methodology: 'spec-first' as MethodologyId });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.intent, 't2');
  });

  it('getEntries filters by minQuality', () => {
    const trail = new AuditTrail();
    const id1 = trail.startTrace('t1', 'direct-execution' as MethodologyId, 'm1', 'h1');
    const id2 = trail.startTrace('t2', 'direct-execution' as MethodologyId, 'm2', 'h2');
    trail.endTrace(id1, 'success', 0.5, 0, 0, 0);
    trail.endTrace(id2, 'success', 0.9, 0, 0, 0);

    const high = trail.getEntries({ minQuality: 0.8 });
    assert.equal(high.length, 1);
    assert.equal(high[0]!.intent, 't2');
  });

  it('getEntries filters by time range', () => {
    const trail = new AuditTrail();
    const id = trail.startTrace('now', 'direct-execution' as MethodologyId, 'm', 'h');
    trail.endTrace(id, 'success', 0.7, 0, 0, 0);

    const past = trail.getEntries({ endTime: new Date(Date.now() - 86400000) });
    assert.equal(past.length, 0);
  });

  it('getStats returns zeros for empty trail', () => {
    const trail = new AuditTrail();
    const stats = trail.getStats();
    assert.equal(stats.totalTraces, 0);
    assert.equal(stats.successRate, 0);
    assert.equal(stats.avgQuality, 0);
    assert.equal(stats.totalCost, 0);
  });

  it('getStats computes correct aggregates', () => {
    const trail = new AuditTrail();
    const id1 = trail.startTrace('t1', 'direct-execution' as MethodologyId, 'm', 'h');
    const id2 = trail.startTrace('t2', 'direct-execution' as MethodologyId, 'm', 'h');
    trail.endTrace(id1, 'success', 0.9, 0.01, 1000, 2000);
    trail.endTrace(id2, 'error', 0.5, 0.02, 2000, 4000, { class: 'model', message: 'timeout', recoverable: true, recoveryAction: 'retry', userMessage: 'retrying' });

    const stats = trail.getStats();
    assert.equal(stats.totalTraces, 2);
    assert.equal(stats.successRate, 0.5);
    assert.equal(stats.avgQuality, 0.7);
    assert.equal(stats.totalCost, 0.03);
    assert.equal(stats.totalTokens, 3000);
    assert.equal(stats.avgDuration, 3000);
    assert.equal(stats.errorsByClass['model'], 1);
    assert.equal(stats.errorsByClass['execution'], 0);
  });

  it('clear removes all entries', () => {
    const trail = new AuditTrail();
    trail.startTrace('t1', 'direct-execution' as MethodologyId, 'm', 'h');
    trail.startTrace('t2', 'direct-execution' as MethodologyId, 'm', 'h');
    assert.equal(trail.getEntries().length, 2);
    trail.clear();
    assert.equal(trail.getEntries().length, 0);
  });

  it('getEntry returns undefined for unknown traceId', () => {
    const trail = new AuditTrail();
    assert.equal(trail.getEntry('nonexistent'), undefined);
  });

  describe('classifyError', () => {
    it('passes through valid ClassifiedError', () => {
      const trail = new AuditTrail();
      const err: ClassifiedError = { class: 'validation', message: 'invalid schema', recoverable: false, userMessage: 'bad' };
      const result = trail.classifyError(err);
      assert.equal(result.class, 'validation');
      assert.equal(result.message, 'invalid schema');
    });

    it('classifies timeout errors as model class', () => {
      const trail = new AuditTrail();
      const result = trail.classifyError(new Error('Request timed out after 30s'));
      assert.equal(result.class, 'model');
      assert.ok(result.recoverable);
      assert.equal(result.recoveryAction, 'retry');
    });

    it('classifies validation errors', () => {
      const trail = new AuditTrail();
      const result = trail.classifyError(new Error('Schema validation failed'));
      assert.equal(result.class, 'validation');
      assert.equal(result.recoverable, false);
    });

    it('classifies not-found errors as routing', () => {
      const trail = new AuditTrail();
      const result = trail.classifyError(new Error('File not found'));
      assert.equal(result.class, 'routing');
      assert.ok(result.recoverable);
    });

    it('classifies unknown errors as execution', () => {
      const trail = new AuditTrail();
      const result = trail.classifyError('something broke');
      assert.equal(result.class, 'execution');
      assert.equal(result.recoverable, false);
    });
  });
});
