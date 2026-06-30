/**
 * Error Type System for Frontend Error Handling
 * 
 * This module provides a comprehensive error classification system that supports
 * systematic error handling across all error scenarios with extensibility for
 * future error types and recovery patterns.
 */

/**
 * Error categories for systematic classification
 */
export enum ErrorCategory {
  NETWORK = 'network',
  USAGE = 'usage',
  GENERATION = 'generation',
  AUTH = 'auth',
  MODEL = 'model',
  CONTEXT = 'context',
  SYSTEM = 'system'
}

/**
 * Error severity levels for UI prioritization and user communication
 */
export enum ErrorSeverity {
  LOW = 'low',      // Informational, user can continue
  MEDIUM = 'medium', // Action required, but recoverable
  HIGH = 'high',    // Blocking, requires user intervention
  CRITICAL = 'critical' // System failure, cannot continue
}

/**
 * Retry strategy types for automatic error recovery
 */
export enum RetryStrategyType {
  NONE = 'none',              // No retry
  FIXED_DELAY = 'fixed_delay', // Fixed delay between retries
  EXPONENTIAL_BACKOFF = 'exponential_backoff', // Exponential backoff with jitter
  IMMEDIATE = 'immediate'     // Immediate retry (for idempotent operations)
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  type: RetryStrategyType;
  maxAttempts?: number;       // Maximum number of retry attempts
  delayMs?: number;          // Initial delay in milliseconds
  maxDelayMs?: number;       // Maximum delay for exponential backoff
  backoffMultiplier?: number; // Multiplier for exponential backoff
  jitter?: boolean;          // Add random jitter to prevent thundering herd
}

/**
 * User action types for error recovery
 */
export type ErrorActionType = 'retry' | 'edit' | 'contact_support' | 'view_details' | 'dismiss' | 'regenerate' | 'switch_model' | 'upgrade_plan' | 'wait_for_reset' | 'pick_model';

/**
 * User-facing error action for recovery
 */
export interface ErrorAction {
  label: string;              // User-visible action label
  action: ErrorActionType;   // Action type
  primary?: boolean;         // Whether this is the primary action button
  disabled?: boolean;        // Whether the action is currently disabled
  metadata?: Record<string, unknown>; // Additional action-specific metadata
}

/**
 * Comprehensive error context for frontend error handling
 */
export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  code: string;              // Machine-readable error code
  message: string;           // Technical error message
  userMessage: string;       // User-friendly explanation
  technicalDetails?: string; // Expandable technical information
  suggestedActions: ErrorAction[];
  retryable: boolean;
  retryStrategy?: RetryStrategy;
  timestamp: number;
  sessionId?: string;        // Associated session ID if applicable
  messageId?: string;        // Associated message ID if applicable
  correlationId?: string;    // For error tracking and debugging
  providerID?: string;       // Provider that caused the error (e.g. "openai")
}

/**
 * Network-specific error context
 */
export interface NetworkErrorContext extends ErrorContext {
  category: ErrorCategory.NETWORK;
  networkStatus?: 'offline' | 'slow' | 'timeout' | 'server_unreachable';
  connectionQuality?: 'fast' | 'slow' | 'poor';
  isOffline?: boolean;
  canQueueRequest?: boolean;
}

/**
 * Usage/quota-specific error context
 */
export interface UsageErrorContext extends ErrorContext {
  category: ErrorCategory.USAGE;
  quotaState?: QuotaState;
  resetAt?: Date;
  warningThreshold?: number;
  currentUsage?: number;
  limitUsage?: number;
}

/**
 * Quota state information
 */
export interface QuotaState {
  remainingTokens: number;
  limitTokens: number;
  remainingRequests: number;
  limitRequests: number;
  resetAt: Date;
  warningThreshold: number;
}

/**
 * Generation-specific error context
 */
export interface GenerationErrorContext extends ErrorContext {
  category: ErrorCategory.GENERATION;
  partialResponse?: string;   // Save partial generation for recovery
  canRegenerate: boolean;
  canEditPrompt: boolean;
  alternativeModels?: string[]; // Suggest different models
  streamingInterrupted?: boolean;
  contextLimitReached?: boolean;
  currentContextSize?: number;
  maxContextSize?: number;
  suggestedReduction?: number;
  canReduceContext?: boolean;
  modelId?: string;
  modelAvailable?: boolean;
  modelOverloaded?: boolean;
}

/**
 * Authentication-specific error context
 */
export interface AuthErrorContext extends ErrorContext {
  category: ErrorCategory.AUTH;
  authType?: 'api_key' | 'oauth' | 'session' | 'unknown';
  canReauthenticate: boolean;
  canRefreshCredentials: boolean;
  permissionDenied?: boolean;
  credentialsExpired?: boolean;
}

/**
 * Model-specific error context
 */
export interface ModelErrorContext extends ErrorContext {
  category: ErrorCategory.MODEL;
  modelId?: string;
  modelAvailable?: boolean;
  modelDeprecated?: boolean;
  alternativeModels?: string[];
  modelOverloaded?: boolean;
}

/**
 * Context-specific error context
 */
export interface ContextErrorContext extends ErrorContext {
  category: ErrorCategory.CONTEXT;
  contextLimitReached: boolean;
  currentContextSize: number;
  maxContextSize: number;
  suggestedReduction?: number;
  canReduceContext: boolean;
}

/**
 * System-specific error context
 */
export interface SystemErrorContext extends ErrorContext {
  category: ErrorCategory.SYSTEM;
  systemComponent?: string;
  recoverable?: boolean;
  requiresRestart?: boolean;
}

/**
 * Error warning for proactive quota monitoring
 */
export interface QuotaWarning {
  type: 'warning' | 'critical' | 'info';
  percentage: number;
  message: string;
  suggestedActions: ErrorAction[];
  timeUntilReset?: number; // Milliseconds until reset
}

/**
 * Network status for monitoring
 */
export interface NetworkStatus {
  online: boolean;
  connectionQuality: 'fast' | 'slow' | 'poor';
  latency?: number; // Network latency in milliseconds
  lastChecked: number;
}

/**
 * Pending request for offline queue
 */
export interface PendingRequest {
  id: string;
  timestamp: number;
  request: unknown; // Request payload
  retryCount: number;
  maxRetries: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Error report for user-initiated error reporting
 */
export interface ErrorReport {
  errorContext: ErrorContext;
  diagnosticInfo: DiagnosticInfo;
  userFeedback?: string;
  timestamp: number;
}

/**
 * Diagnostic information for error reporting
 */
export interface DiagnosticInfo {
  browserInfo: string;
  networkStatus: NetworkStatus;
  sessionInfo: {
    sessionId?: string;
    messageCount?: number;
    activeTab?: string;
  };
  errorHistory: ErrorContext[];
  systemInfo: {
    userAgent: string;
    platform: string;
    language: string;
  };
}

/**
 * Error trend for analytics
 */
export interface ErrorTrend {
  errorCode: string;
  category: ErrorCategory;
  count: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  timeWindow: string; // e.g., '24h', '7d', '30d'
}

/**
 * Default retry strategies for common error scenarios
 */
export const DEFAULT_RETRY_STRATEGIES: Record<ErrorCategory, RetryStrategy> = {
  [ErrorCategory.NETWORK]: {
    type: RetryStrategyType.EXPONENTIAL_BACKOFF,
    maxAttempts: 3,
    delayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true
  },
  [ErrorCategory.USAGE]: {
    type: RetryStrategyType.FIXED_DELAY,
    maxAttempts: 1,
    delayMs: 60000 // Wait 1 minute before retry for usage errors
  },
  [ErrorCategory.GENERATION]: {
    type: RetryStrategyType.EXPONENTIAL_BACKOFF,
    maxAttempts: 2,
    delayMs: 2000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitter: true
  },
  [ErrorCategory.AUTH]: {
    type: RetryStrategyType.NONE // Don't retry auth errors automatically
  },
  [ErrorCategory.MODEL]: {
    type: RetryStrategyType.IMMEDIATE,
    maxAttempts: 1 // Try once with alternative model
  },
  [ErrorCategory.CONTEXT]: {
    type: RetryStrategyType.NONE // Context errors require user action
  },
  [ErrorCategory.SYSTEM]: {
    type: RetryStrategyType.NONE // System errors require investigation
  }
};

/**
 * Error code mappings for common scenarios
 */
export const ERROR_CODES: Record<string, Partial<ErrorContext>> = {
  // Network errors
  'NETWORK_OFFLINE': {
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    code: 'NETWORK_OFFLINE',
    message: 'Network connection is offline',
    userMessage: 'You appear to be offline. Please check your internet connection.',
    retryable: true
  },
  'NETWORK_TIMEOUT': {
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    code: 'NETWORK_TIMEOUT',
    message: 'Network request timed out',
    userMessage: 'The request took too long. Please check your connection and try again.',
    retryable: true
  },
  'NETWORK_SERVER_UNREACHABLE': {
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    code: 'NETWORK_SERVER_UNREACHABLE',
    message: 'Server is unreachable',
    userMessage: 'Unable to reach the server. Please check your connection and try again.',
    retryable: true
  },
  
  // Usage errors
  'RATE_LIMIT_EXCEEDED': {
    category: ErrorCategory.USAGE,
    severity: ErrorSeverity.MEDIUM,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Rate limit exceeded',
    userMessage: 'You\'ve reached your usage limit. Wait for reset or upgrade your plan.',
    retryable: false
  },
  'QUOTA_EXCEEDED': {
    category: ErrorCategory.USAGE,
    severity: ErrorSeverity.HIGH,
    code: 'QUOTA_EXCEEDED',
    message: 'Quota exceeded',
    userMessage: 'You\'ve exceeded your quota. Please upgrade your plan to continue.',
    retryable: false
  },
  
  // Generation errors
  'GENERATION_STREAM_INTERRUPTED': {
    category: ErrorCategory.GENERATION,
    severity: ErrorSeverity.MEDIUM,
    code: 'GENERATION_STREAM_INTERRUPTED',
    message: 'Generation stream was interrupted',
    userMessage: 'The response generation was interrupted. You can retry to get the complete response.',
    retryable: true
  },
  'GENERATION_FAILED': {
    category: ErrorCategory.GENERATION,
    severity: ErrorSeverity.HIGH,
    code: 'GENERATION_FAILED',
    message: 'Generation failed',
    userMessage: 'The response generation failed. Please try again or contact support if the issue persists.',
    retryable: true
  },
  'CONTEXT_LIMIT_EXCEEDED': {
    category: ErrorCategory.CONTEXT,
    severity: ErrorSeverity.MEDIUM,
    code: 'CONTEXT_LIMIT_EXCEEDED',
    message: 'Context limit exceeded',
    userMessage: 'The conversation context is too large. Try starting a new conversation or clearing some messages.',
    retryable: false
  },
  
  // Authentication errors
  'AUTH_FAILED': {
    category: ErrorCategory.AUTH,
    severity: ErrorSeverity.HIGH,
    code: 'AUTH_FAILED',
    message: 'Authentication failed',
    userMessage: 'Authentication failed. Please check your credentials and try again.',
    retryable: false
  },
  'AUTH_EXPIRED': {
    category: ErrorCategory.AUTH,
    severity: ErrorSeverity.MEDIUM,
    code: 'AUTH_EXPIRED',
    message: 'Authentication expired',
    userMessage: 'Your authentication has expired. Please reauthenticate to continue.',
    retryable: false
  },
  'PERMISSION_DENIED': {
    category: ErrorCategory.AUTH,
    severity: ErrorSeverity.HIGH,
    code: 'PERMISSION_DENIED',
    message: 'Permission denied',
    userMessage: 'You don\'t have permission to perform this action.',
    retryable: false
  },
  
  // Model errors
  'MODEL_UNAVAILABLE': {
    category: ErrorCategory.MODEL,
    severity: ErrorSeverity.MEDIUM,
    code: 'MODEL_UNAVAILABLE',
    message: 'Model unavailable',
    userMessage: 'The requested model is currently unavailable. Please try again later or switch to an alternative model.',
    retryable: true
  },
  'MODEL_OVERLOADED': {
    category: ErrorCategory.MODEL,
    severity: ErrorSeverity.MEDIUM,
    code: 'MODEL_OVERLOADED',
    message: 'Model overloaded',
    userMessage: 'The model is currently experiencing high demand. Please try again in a few minutes.',
    retryable: true
  },
  'MODEL_DEPRECATED': {
    category: ErrorCategory.MODEL,
    severity: ErrorSeverity.MEDIUM,
    code: 'MODEL_DEPRECATED',
    message: 'Model deprecated',
    userMessage: 'This model has been deprecated. Please switch to an alternative model.',
    retryable: false
  },
  
  // System errors
  'SYSTEM_ERROR': {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.CRITICAL,
    code: 'SYSTEM_ERROR',
    message: 'System error',
    userMessage: 'A system error occurred. Please try again or contact support if the issue persists.',
    retryable: false
  },
  'UNKNOWN_ERROR': {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.HIGH,
    code: 'UNKNOWN_ERROR',
    message: 'Unknown error',
    userMessage: 'An unexpected error occurred. Please try again.',
    retryable: true
  }
};

/**
 * Generate a short correlation ID for error tracking and debugging.
 * Uses crypto.randomUUID when available (browser/node ≥19) and falls
 * back to a Date+Math.random combination otherwise.
 */
function generateCorrelationId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a basic error context from an error code.
 *
 * Resolution order for each field:
 *   1. overrides (caller-provided)
 *   2. ERROR_CODES table entry for `code`
 *   3. safe default
 *
 * `correlationId` is always generated unless explicitly overridden.
 */
export function createErrorContext(
  code: string,
  overrides: Partial<ErrorContext> = {}
): ErrorContext {
  // Only treat the lookup as a "base" when the code is actually registered.
  // For unknown codes, fall back to defaults so we don't bleed UNKNOWN_ERROR's
  // severity/userMessage into a caller-supplied context.
  const baseError = ERROR_CODES[code] ?? {};

  return {
    category: overrides.category ?? baseError.category ?? ErrorCategory.SYSTEM,
    severity: overrides.severity ?? baseError.severity ?? ErrorSeverity.MEDIUM,
    code: overrides.code ?? baseError.code ?? code,
    message: overrides.message ?? baseError.message ?? 'Unknown error',
    userMessage: overrides.userMessage ?? baseError.userMessage ?? 'An error occurred',
    technicalDetails: overrides.technicalDetails ?? baseError.technicalDetails,
    suggestedActions: overrides.suggestedActions ?? baseError.suggestedActions ?? [],
    retryable: overrides.retryable ?? baseError.retryable ?? false,
    retryStrategy: overrides.retryStrategy ?? baseError.retryStrategy,
    timestamp: overrides.timestamp ?? Date.now(),
    sessionId: overrides.sessionId,
    messageId: overrides.messageId,
    correlationId: overrides.correlationId ?? generateCorrelationId(),
  };
}

/**
 * Check if an error context is retryable
 */
export function isRetryable(error: ErrorContext): boolean {
  return error.retryable && error.retryStrategy?.type !== RetryStrategyType.NONE;
}

/**
 * Get the suggested actions attached to an error context.
 *
 * Returns the context's `suggestedActions` verbatim — including an empty
 * array if none were attached. Callers that want category-based default
 * actions (Retry / View Usage / Dismiss) should call `getDefaultActions`
 * instead; this function is a pure accessor so consumers can distinguish
 * "no actions" from "default actions."
 */
export function getSuggestedActions(error: ErrorContext): ErrorAction[] {
  return error.suggestedActions ?? [];
}

/**
 * Synthesize a set of default actions based on the error's category and
 * retryability. Use when an error has no explicit suggestedActions and you
 * still need something for the UI to render.
 */
export function getDefaultActions(error: ErrorContext): ErrorAction[] {
  const actions: ErrorAction[] = [];

  if (error.retryable) {
    actions.push({ label: 'Retry', action: 'retry', primary: true });
  }
  if (error.category === ErrorCategory.USAGE) {
    actions.push({ label: 'View Usage', action: 'view_details' });
  }
  if (error.category === ErrorCategory.GENERATION) {
    const genError = error as GenerationErrorContext;
    if (genError.canEditPrompt) {
      actions.push({ label: 'Edit Prompt', action: 'edit' });
    }
  }
  actions.push({ label: 'Dismiss', action: 'dismiss' });

  return actions;
}

/**
 * Type-safe discriminated union error payload structures for IPC boundary propagation.
 */
export type WebviewErrorCategory = 'network' | 'usage' | 'generation' | 'auth' | 'model' | 'context' | 'system';
export type WebviewErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BaseErrorPayload {
  sessionId: string;
  correlationId: string;
  timestamp: number;
  code: string;
  userMessage: string;
  technicalDetails?: string;
  retryable: boolean;
  providerID?: string;       // Provider that caused the error
}

export interface AuthErrorPayload extends BaseErrorPayload {
  type: 'auth_error';
  category: 'auth';
  severity: 'high' | 'critical';
  authSettingsUrl?: string;
}

export interface QuotaErrorPayload extends BaseErrorPayload {
  type: 'quota_error';
  category: 'usage';
  severity: 'high';
  resetAtMs?: number;
  upgradeUrl?: string;
}

export interface InfrastructureErrorPayload extends BaseErrorPayload {
  type: 'infra_error';
  category: 'network' | 'system';
  severity: 'high' | 'critical';
  autoRetryCount: number;
}

export interface LocalStreamErrorPayload extends BaseErrorPayload {
  type: 'stream_error';
  category: 'generation' | 'context' | 'model';
  severity: 'low' | 'medium';
  partialContentSaved?: string;
}

export type WebviewErrorPayload = 
  | AuthErrorPayload
  | QuotaErrorPayload
  | InfrastructureErrorPayload
  | LocalStreamErrorPayload;

/**
 * Maps an ErrorContext to a type-safe WebviewErrorPayload for serialization across the IPC boundary.
 */
export function toWebviewErrorPayload(error: ErrorContext): WebviewErrorPayload {
  const base: BaseErrorPayload = {
    sessionId: error.sessionId || '',
    correlationId: error.correlationId || '',
    timestamp: error.timestamp || Date.now(),
    code: error.code,
    userMessage: error.userMessage,
    technicalDetails: error.technicalDetails,
    retryable: error.retryable,
    providerID: error.providerID,
  };

  if (error.category === ErrorCategory.AUTH) {
    return {
      ...base,
      type: 'auth_error',
      category: 'auth',
      severity: error.severity === ErrorSeverity.CRITICAL ? 'critical' : 'high',
      authSettingsUrl: (error.suggestedActions?.find(a => a.action === 'edit')?.metadata?.url as string | undefined)
    };
  } else if (error.category === ErrorCategory.USAGE) {
    const usageCtx = error as UsageErrorContext;
    return {
      ...base,
      type: 'quota_error',
      category: 'usage',
      severity: 'high',
      resetAtMs: usageCtx.quotaState?.resetAt ? new Date(usageCtx.quotaState.resetAt).getTime() : undefined,
      upgradeUrl: (error.suggestedActions?.find(a => a.action === 'upgrade_plan')?.metadata?.url as string | undefined)
    };
  } else if (error.category === ErrorCategory.NETWORK || error.category === ErrorCategory.SYSTEM) {
    return {
      ...base,
      type: 'infra_error',
      category: error.category === ErrorCategory.NETWORK ? 'network' : 'system',
      severity: error.severity === ErrorSeverity.CRITICAL ? 'critical' : 'high',
      autoRetryCount: 0
    };
  } else {
    const genCtx = error as GenerationErrorContext;
    return {
      ...base,
      type: 'stream_error',
      category: error.category === ErrorCategory.CONTEXT ? 'context' : error.category === ErrorCategory.MODEL ? 'model' : 'generation',
      severity: error.severity === ErrorSeverity.LOW ? 'low' : 'medium',
      partialContentSaved: genCtx.partialResponse
    };
  }
}

/**
 * Maps a type-safe WebviewErrorPayload back to an ErrorContext inside the webview.
 */
export function toErrorContext(payload: WebviewErrorPayload): ErrorContext {
  const actions: ErrorAction[] = [];
  
  if (payload.retryable) {
    actions.push({ label: 'Retry', action: 'retry', primary: true });
  }

  if (payload.type === 'auth_error') {
    if (payload.authSettingsUrl) {
      actions.push({
        label: 'Open auth settings',
        action: 'edit',
        primary: !payload.retryable,
        metadata: { url: payload.authSettingsUrl }
      });
    }
    actions.push({ label: 'Switch provider', action: 'switch_model' });
  } else if (payload.type === 'quota_error') {
    actions.push({ label: 'Switch provider', action: 'switch_model', primary: true });
    if (payload.upgradeUrl) {
      actions.push({
        label: 'Open billing',
        action: 'upgrade_plan',
        metadata: { url: payload.upgradeUrl }
      });
    }
  }
  
  actions.push({ label: 'Dismiss', action: 'dismiss' });

  let category = ErrorCategory.SYSTEM;
  if (payload.category === 'network') category = ErrorCategory.NETWORK;
  else if (payload.category === 'usage') category = ErrorCategory.USAGE;
  else if (payload.category === 'generation') category = ErrorCategory.GENERATION;
  else if (payload.category === 'auth') category = ErrorCategory.AUTH;
  else if (payload.category === 'model') category = ErrorCategory.MODEL;
  else if (payload.category === 'context') category = ErrorCategory.CONTEXT;

  let severity = ErrorSeverity.MEDIUM;
  if (payload.severity === 'low') severity = ErrorSeverity.LOW;
  else if (payload.severity === 'high') severity = ErrorSeverity.HIGH;
  else if (payload.severity === 'critical') severity = ErrorSeverity.CRITICAL;

  const context: ErrorContext = {
    category,
    severity,
    code: payload.code,
    message: payload.userMessage,
    userMessage: payload.userMessage,
    technicalDetails: payload.technicalDetails,
    suggestedActions: actions,
    retryable: payload.retryable,
    timestamp: payload.timestamp,
    sessionId: payload.sessionId,
    correlationId: payload.correlationId,
    providerID: payload.providerID,
  };

  if (payload.type === 'quota_error' && payload.resetAtMs) {
    const quotaCtx = context as UsageErrorContext;
    quotaCtx.quotaState = {
      remainingTokens: 0,
      limitTokens: 0,
      remainingRequests: 0,
      limitRequests: 0,
      resetAt: new Date(payload.resetAtMs),
      warningThreshold: 0
    };
  } else if (payload.type === 'stream_error' && payload.partialContentSaved) {
    const genCtx = context as GenerationErrorContext;
    genCtx.partialResponse = payload.partialContentSaved;
  } else if (payload.type === 'infra_error') {
    const netCtx = context as NetworkErrorContext;
    netCtx.networkStatus = 'offline';
  }

  return context;
}



