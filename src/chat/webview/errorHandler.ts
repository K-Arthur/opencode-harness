/**
 * Enhanced Error Handler Module
 * 
 * Central error processing with classification, retry logic, monitoring,
 * and user-facing error display capabilities.
 */

import {
  ErrorContext,
  ErrorCategory,
  ErrorSeverity,
  RetryStrategy,
  RetryStrategyType,
  createErrorContext,
  isRetryable,
  getSuggestedActions,
  DEFAULT_RETRY_STRATEGIES
} from './errorTypes';
import { mapOpencodeError } from './opencodeErrorMapper';

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  enableLogging?: boolean;
  enableRetry?: boolean;
  maxRetryAttempts?: number;
  logToConsole?: boolean;
  logToExtension?: boolean;
  enableAnalytics?: boolean;
}

/**
 * Error handler options for specific error handling
 */
export interface ErrorHandlerOptions {
  sessionId?: string;
  messageId?: string;
  correlationId?: string;
  customActions?: string[];
  suppressDefaultActions?: boolean;
}

/**
 * Retry result from retry operation
 */
export interface RetryResult {
  success: boolean;
  attempts: number;
  totalDelayMs: number;
  error?: Error;
}

/**
 * Error log entry for tracking
 */
export interface ErrorLogEntry {
  errorContext: ErrorContext;
  timestamp: number;
  handled: boolean;
  recoveryAttempted: boolean;
  recoverySuccessful: boolean;
}

/**
 * Central error handler with comprehensive error management
 */
export class ErrorHandler {
  private config: ErrorHandlerConfig;
  private errorHistory: ErrorLogEntry[] = [];
  private maxHistorySize = 100;
  private retryRegistry = new Map<string, number>(); // Track retry attempts per error code

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = {
      enableLogging: true,
      enableRetry: true,
      maxRetryAttempts: 3,
      logToConsole: true,
      logToExtension: true,
      enableAnalytics: false,
      ...config
    };
  }

  /**
   * Central error processing entry point.
   *
   * Errors arriving from the opencode SDK carry structural signals (a `name`
   * like "ProviderAuthError" / "APIError", a `statusCode`, an `isRetryable`
   * flag). When any of those are present we route through the opencode-grounded
   * mapper which understands the actual error taxonomy. Anything else falls
   * back to the legacy classifier.
   */
  handleError(error: unknown, options: ErrorHandlerOptions = {}): ErrorContext {
    const errorContext = this.shouldUseOpencodeMapper(error)
      ? this.applyOptions(mapOpencodeError(error as { name?: string; message?: string; statusCode?: number; isRetryable?: boolean; providerID?: string }), options)
      : this.classifyError(error, options);

    if (this.config.enableLogging) {
      this.logError(errorContext);
    }

    this.trackError(errorContext);

    return errorContext;
  }

  private shouldUseOpencodeMapper(error: unknown): boolean {
    if (!error || typeof error !== "object") return false
    const e = error as Record<string, unknown>
    return typeof e.name === "string" || typeof e.statusCode === "number" || typeof e.isRetryable === "boolean"
  }

  private applyOptions(ctx: ErrorContext, options: ErrorHandlerOptions): ErrorContext {
    if (options.sessionId) (ctx as { sessionId?: string }).sessionId = options.sessionId
    if (options.messageId) (ctx as { messageId?: string }).messageId = options.messageId
    if (options.correlationId) (ctx as { correlationId?: string }).correlationId = options.correlationId
    if (options.customActions && options.customActions.length > 0) {
      return this.applyCustomActions(ctx, options.customActions)
    }
    if (options.suppressDefaultActions) {
      ctx.suggestedActions = []
    }
    return ctx
  }

  /**
   * Classify an error into a structured ErrorContext
   */
  classifyError(error: unknown, options: ErrorHandlerOptions = {}): ErrorContext {
    // Try to extract error information
    let code = 'UNKNOWN_ERROR';
    let message = 'Unknown error';
    let category = ErrorCategory.SYSTEM;
    let severity = ErrorSeverity.HIGH;

    if (error instanceof Error) {
      message = error.message;
      
      // Try to extract error code from message
      const codeMatch = error.message.match(/\[([A-Z_]+)\]/);
      if (codeMatch && codeMatch[1]) {
        code = codeMatch[1];
      }
      
      // Classify based on error message patterns
      category = this.classifyByMessage(error.message);
      severity = this.determineSeverity(category, error.message);
    } else if (typeof error === 'string') {
      message = error;
      category = this.classifyByMessage(error);
      severity = this.determineSeverity(category, error);
    } else if (error && typeof error === 'object') {
      // Try to extract from object structure
      const errorObj = error as Record<string, unknown>;
      message = (errorObj.message as string) || String(error);
      const extractedCode = errorObj.code as string | undefined;
      if (extractedCode) {
        code = extractedCode;
      }
      
      if (errorObj.category && Object.values(ErrorCategory).includes(errorObj.category as ErrorCategory)) {
        category = errorObj.category as ErrorCategory;
      } else {
        category = this.classifyByMessage(message);
      }
      
      severity = this.determineSeverity(category, message);
    }

    // Create error context with defaults
    let errorContext = createErrorContext(code, {
      message,
      category,
      severity,
      sessionId: options.sessionId,
      messageId: options.messageId,
      correlationId: options.correlationId || this.generateCorrelationId()
    });

    // Apply custom actions if provided
    if (options.customActions && options.customActions.length > 0) {
      errorContext = this.applyCustomActions(errorContext, options.customActions);
    }

    // Suppress default actions if requested
    if (options.suppressDefaultActions) {
      errorContext.suggestedActions = [];
    }

    // Set retry strategy based on category
    if (!errorContext.retryStrategy) {
      errorContext.retryStrategy = DEFAULT_RETRY_STRATEGIES[category];
    }

    return errorContext;
  }

  /**
   * Classify error category based on message content
   */
  private classifyByMessage(message: string): ErrorCategory {
    const lowerMessage = message.toLowerCase();

    // Network errors
    if (lowerMessage.includes('network') || 
        lowerMessage.includes('connection') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('offline') ||
        lowerMessage.includes('unreachable')) {
      return ErrorCategory.NETWORK;
    }

    // Usage/rate limit errors
    if (lowerMessage.includes('rate limit') ||
        lowerMessage.includes('quota') ||
        lowerMessage.includes('usage') ||
        lowerMessage.includes('limit')) {
      return ErrorCategory.USAGE;
    }

    // Authentication errors
    if (lowerMessage.includes('auth') ||
        lowerMessage.includes('permission') ||
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('forbidden') ||
        lowerMessage.includes('credential')) {
      return ErrorCategory.AUTH;
    }

    // Model errors
    if (lowerMessage.includes('model') ||
        lowerMessage.includes('overload') ||
        lowerMessage.includes('deprecated')) {
      return ErrorCategory.MODEL;
    }

    // Context errors
    if (lowerMessage.includes('context') ||
        lowerMessage.includes('token limit') ||
        lowerMessage.includes('window')) {
      return ErrorCategory.CONTEXT;
    }

    // Generation errors
    if (lowerMessage.includes('generation') ||
        lowerMessage.includes('stream') ||
        lowerMessage.includes('response')) {
      return ErrorCategory.GENERATION;
    }

    return ErrorCategory.SYSTEM;
  }

  /**
   * Determine error severity based on category and message
   */
  private determineSeverity(category: ErrorCategory, message: string): ErrorSeverity {
    const lowerMessage = message.toLowerCase();

    // Critical errors
    if (lowerMessage.includes('critical') ||
        lowerMessage.includes('fatal') ||
        category === ErrorCategory.SYSTEM) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity
    if (category === ErrorCategory.AUTH ||
        category === ErrorCategory.CONTEXT ||
        lowerMessage.includes('error') ||
        lowerMessage.includes('failed')) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity
    if (category === ErrorCategory.USAGE ||
        category === ErrorCategory.NETWORK ||
        category === ErrorCategory.GENERATION) {
      return ErrorSeverity.MEDIUM;
    }

    // Low severity (informational)
    return ErrorSeverity.LOW;
  }

  /**
   * Apply custom actions to error context
   */
  private applyCustomActions(errorContext: ErrorContext, customActions: string[]): ErrorContext {
    // This would integrate with a plugin system for custom actions
    // For now, we'll just note that custom actions were requested
    return {
      ...errorContext,
      suggestedActions: [
        ...errorContext.suggestedActions,
        ...customActions.map(action => ({
          label: action,
          action: 'contact_support' as const
        }))
      ]
    };
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    strategy: RetryStrategy
  ): Promise<RetryResult & { result?: T }> {
    if (!this.config.enableRetry || strategy.type === RetryStrategyType.NONE) {
      try {
        const result = await operation();
        return { success: true, attempts: 1, totalDelayMs: 0, result };
      } catch (error) {
        return { 
          success: false, 
          attempts: 1, 
          totalDelayMs: 0, 
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }

    const maxAttempts = strategy.maxAttempts || 3;
    const initialDelay = strategy.delayMs || 1000;
    const maxDelay = strategy.maxDelayMs || 30000;
    const multiplier = strategy.backoffMultiplier || 2;
    const useJitter = strategy.jitter || false;

    let attempts = 0;
    let totalDelayMs = 0;
    let currentDelay = initialDelay;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const result = await operation();
        return { success: true, attempts, totalDelayMs, result };
      } catch (error) {
        if (attempts >= maxAttempts) {
          return {
            success: false,
            attempts,
            totalDelayMs,
            error: error instanceof Error ? error : new Error(String(error))
          };
        }

        // Calculate delay with exponential backoff
        if (strategy.type === RetryStrategyType.EXPONENTIAL_BACKOFF) {
          currentDelay = Math.min(currentDelay * multiplier, maxDelay);
        }

        // Add jitter if enabled
        if (useJitter) {
          currentDelay = currentDelay * (0.5 + Math.random() * 0.5);
        }

        totalDelayMs += currentDelay;

        // Wait before retry
        await this.delay(currentDelay);
      }
    }

    return {
      success: false,
      attempts,
      totalDelayMs,
      error: new Error('Max retry attempts exceeded')
    };
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log error to configured destinations
   */
  private logError(errorContext: ErrorContext): void {
    if (this.config.logToConsole) {
      console.error(`[${errorContext.category.toUpperCase()}] ${errorContext.code}: ${errorContext.userMessage}`, errorContext);
    }

    if (this.config.logToExtension) {
      // Log to extension host via VS Code API
      try {
        // Check if acquireVsCodeApi exists in global scope
        const globalAcquireVsCodeApi = (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
        if (typeof globalAcquireVsCodeApi === 'function') {
          const vscode = globalAcquireVsCodeApi();
          if (vscode && typeof vscode === 'object' && 'postMessage' in vscode) {
            (vscode as { postMessage: (message: unknown) => void }).postMessage({
              type: 'error_log',
              errorContext
            });
          }
        }
      } catch (error) {
        console.warn('Failed to log error to extension:', error);
      }
    }
  }

  /**
   * Track error in history for analytics
   */
  private trackError(errorContext: ErrorContext): void {
    const entry: ErrorLogEntry = {
      errorContext,
      timestamp: Date.now(),
      handled: false,
      recoveryAttempted: false,
      recoverySuccessful: false
    };

    this.errorHistory.push(entry);

    // Keep history size bounded
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Mark error as handled
   */
  markErrorHandled(correlationId: string, handled: boolean): void {
    const entry = this.errorHistory.find(
      e => e.errorContext.correlationId === correlationId
    );
    if (entry) {
      entry.handled = handled;
    }
  }

  /**
   * Mark error recovery attempt
   */
  markRecoveryAttempt(correlationId: string, successful: boolean): void {
    const entry = this.errorHistory.find(
      e => e.errorContext.correlationId === correlationId
    );
    if (entry) {
      entry.recoveryAttempted = true;
      entry.recoverySuccessful = successful;
    }
  }

  /**
   * Get error history
   */
  getErrorHistory(limit?: number): ErrorLogEntry[] {
    if (limit) {
      return this.errorHistory.slice(-limit);
    }
    return [...this.errorHistory];
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    recoveryRate: number;
  } {
    const totalErrors = this.errorHistory.length;
    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.USAGE]: 0,
      [ErrorCategory.GENERATION]: 0,
      [ErrorCategory.AUTH]: 0,
      [ErrorCategory.MODEL]: 0,
      [ErrorCategory.CONTEXT]: 0,
      [ErrorCategory.SYSTEM]: 0
    };
    const bySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    let successfulRecoveries = 0;

    for (const entry of this.errorHistory) {
      byCategory[entry.errorContext.category]++;
      bySeverity[entry.errorContext.severity]++;
      
      if (entry.recoveryAttempted && entry.recoverySuccessful) {
        successfulRecoveries++;
      }
    }

    const recoveryAttempts = this.errorHistory.filter(e => e.recoveryAttempted).length;
    const recoveryRate = recoveryAttempts > 0 
      ? (successfulRecoveries / recoveryAttempts) * 100 
      : 0;

    return {
      totalErrors,
      byCategory,
      bySeverity,
      recoveryRate
    };
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Generate unique correlation ID for error tracking
   */
  private generateCorrelationId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ErrorHandlerConfig {
    return { ...this.config };
  }
}

// Global singleton instance
let globalErrorHandler: ErrorHandler | null = null;

/**
 * Get or create the global error handler instance
 */
export function getErrorHandler(config?: ErrorHandlerConfig): ErrorHandler {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler(config);
  } else if (config) {
    globalErrorHandler.updateConfig(config);
  }
  return globalErrorHandler;
}

/**
 * Reset the global error handler (useful for testing)
 */
export function resetErrorHandler(): void {
  globalErrorHandler = null;
}
