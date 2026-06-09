/**
 * Tests for error type system
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  ErrorCategory,
  ErrorSeverity,
  RetryStrategyType,
  createErrorContext,
  isRetryable,
  getSuggestedActions
} from './errorTypes';

describe('Error Type System', () => {
  it('should have all expected categories', () => {
    assert.strictEqual(ErrorCategory.NETWORK, 'network');
    assert.strictEqual(ErrorCategory.USAGE, 'usage');
    assert.strictEqual(ErrorCategory.GENERATION, 'generation');
    assert.strictEqual(ErrorCategory.AUTH, 'auth');
    assert.strictEqual(ErrorCategory.MODEL, 'model');
    assert.strictEqual(ErrorCategory.CONTEXT, 'context');
    assert.strictEqual(ErrorCategory.SYSTEM, 'system');
  });

  it('should have all expected severity levels', () => {
    assert.strictEqual(ErrorSeverity.LOW, 'low');
    assert.strictEqual(ErrorSeverity.MEDIUM, 'medium');
    assert.strictEqual(ErrorSeverity.HIGH, 'high');
    assert.strictEqual(ErrorSeverity.CRITICAL, 'critical');
  });

  it('should have all expected retry strategies', () => {
    assert.strictEqual(RetryStrategyType.NONE, 'none');
    assert.strictEqual(RetryStrategyType.FIXED_DELAY, 'fixed_delay');
    assert.strictEqual(RetryStrategyType.EXPONENTIAL_BACKOFF, 'exponential_backoff');
    assert.strictEqual(RetryStrategyType.IMMEDIATE, 'immediate');
  });

  it('should create a basic error context', () => {
    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.NETWORK,
      message: 'Test error message',
      userMessage: 'User-friendly message',
      retryable: true
    });

    assert.strictEqual(context.code, 'TEST_ERROR');
    assert.strictEqual(context.category, ErrorCategory.NETWORK);
    assert.strictEqual(context.message, 'Test error message');
    assert.strictEqual(context.userMessage, 'User-friendly message');
    assert.strictEqual(context.retryable, true);
    assert.strictEqual(context.severity, ErrorSeverity.MEDIUM);
    assert.ok(context.timestamp);
    assert.ok(context.correlationId);
  });

  it('should use provided severity', () => {
    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.SYSTEM,
      message: 'Critical error',
      userMessage: 'Critical error message',
      retryable: false,
      severity: ErrorSeverity.CRITICAL
    });

    assert.strictEqual(context.severity, ErrorSeverity.CRITICAL);
  });

  it('should include technical details', () => {
    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.GENERATION,
      message: 'Error message',
      userMessage: 'User message',
      retryable: true,
      technicalDetails: 'Stack trace here'
    });

    assert.strictEqual(context.technicalDetails, 'Stack trace here');
  });

  it('should include suggested actions', () => {
    const actions = [
      { label: 'Retry', action: 'retry' as const, primary: true },
      { label: 'Dismiss', action: 'dismiss' as const, primary: false }
    ];

    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.NETWORK,
      message: 'Error message',
      userMessage: 'User message',
      retryable: true,
      suggestedActions: actions
    });

    assert.deepStrictEqual(context.suggestedActions, actions);
  });

  it('should generate unique correlation IDs', () => {
    const context1 = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.NETWORK,
      message: 'Error 1',
      userMessage: 'User message 1',
      retryable: true
    });

    const context2 = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.NETWORK,
      message: 'Error 2',
      userMessage: 'User message 2',
      retryable: true
    });

    assert.notStrictEqual(context1.correlationId, context2.correlationId);
  });

  it('should return true for retryable errors', () => {
    const context = createErrorContext('RETRYABLE_ERROR', {
      category: ErrorCategory.NETWORK,
      message: 'Network error',
      userMessage: 'Network error message',
      retryable: true
    });

    assert.strictEqual(isRetryable(context), true);
  });

  it('should return false for non-retryable errors', () => {
    const context = createErrorContext('NON_RETRYABLE_ERROR', {
      category: ErrorCategory.AUTH,
      message: 'Auth error',
      userMessage: 'Auth error message',
      retryable: false
    });

    assert.strictEqual(isRetryable(context), false);
  });

  it('should return suggested actions from context', () => {
    const actions = [
      { label: 'Retry', action: 'retry' as const, primary: true },
      { label: 'Contact Support', action: 'contact_support' as const, primary: false }
    ];

    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.GENERATION,
      message: 'Error message',
      userMessage: 'User message',
      retryable: true,
      suggestedActions: actions
    });

    const result = getSuggestedActions(context);
    assert.deepStrictEqual(result, actions);
  });

  it('should return empty array if no actions provided', () => {
    const context = createErrorContext('TEST_ERROR', {
      category: ErrorCategory.SYSTEM,
      message: 'Error message',
      userMessage: 'User message',
      retryable: false
    });

    const result = getSuggestedActions(context);
    assert.deepStrictEqual(result, []);
  });
});
