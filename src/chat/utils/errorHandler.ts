import { log } from "../../utils/outputChannel"

/**
 * Error severity classification
 */
export enum ErrorSeverity {
  /** Transient errors that may resolve on retry (network timeouts, rate limits) */
  TRANSIENT = "transient",
  /** Permanent errors that won't resolve on retry (invalid data, permissions) */
  PERMANENT = "permanent",
  /** Unknown or unclassified errors */
  UNKNOWN = "unknown",
}

/**
 * Error context information
 */
export interface ErrorContext {
  /** The component or service where the error occurred */
  component: string
  /** The operation being performed */
  operation?: string
  /** Session ID if applicable */
  sessionId?: string
  /** Additional context data */
  metadata?: Record<string, unknown>
}

/**
 * Standardized error information
 */
export interface StandardError {
  /** Original error object or message */
  original: Error | string
  /** User-friendly error message */
  message: string
  /** Error severity for routing */
  severity: ErrorSeverity
  /** Whether the error is retryable */
  retryable: boolean
  /** Context information */
  context?: ErrorContext
  /** Timestamp when error occurred */
  timestamp: number
}

/**
 * Create a standardized error from an Error object or string
 */
export function createStandardError(
  error: Error | string,
  context?: ErrorContext,
  severity: ErrorSeverity = ErrorSeverity.UNKNOWN
): StandardError {
  const original = typeof error === "string" ? new Error(error) : error
  const message = original.message || String(error)
  
  // Auto-detect retryability based on error message patterns
  let retryable = severity === ErrorSeverity.TRANSIENT
  if (!retryable) {
    const lowerMessage = message.toLowerCase()
    retryable = lowerMessage.includes("timeout") ||
                 lowerMessage.includes("rate limit") ||
                 lowerMessage.includes("network") ||
                 lowerMessage.includes("econnreset") ||
                 lowerMessage.includes("etimedout")
  }

  return {
    original,
    message,
    severity,
    retryable,
    context,
    timestamp: Date.now(),
  }
}

/**
 * Log a standardized error with appropriate severity
 */
export function logStandardError(error: StandardError): void {
  const { message, severity, context, original } = error
  
  const contextStr = context 
    ? `[${context.component}${context.operation ? `::${context.operation}` : ""}${context.sessionId ? `::${context.sessionId.slice(0, 8)}...` : ""}]`
    : ""
  
  const logMessage = `${contextStr} ${message}`
  
  switch (severity) {
    case ErrorSeverity.TRANSIENT:
      log.warn(logMessage, original)
      break
    case ErrorSeverity.PERMANENT:
      log.error(logMessage, original)
      break
    default:
      log.error(logMessage, original)
  }
}

/**
 * Handle an error in a webview message handler
 */
export function handleWebviewError(
  error: Error | unknown,
  msgType: string,
  sessionId?: string,
  postRequestError?: (message: string, sessionId?: string) => void
): void {
  const errorObj = error instanceof Error ? error : new Error(String(error))
  
  log.error(`Error handling webview message "${msgType}"${sessionId ? ` for session ${sessionId.slice(0, 8)}...` : ""}`, errorObj)
  
  if (postRequestError) {
    const userMessage = errorObj.message || "An unexpected error occurred"
    postRequestError(`Failed to handle "${msgType}": ${userMessage}`, sessionId)
  }
}

/**
 * Wrap an async handler with standardized error handling
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
  context: ErrorContext,
  postRequestError?: (message: string, sessionId?: string) => void
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await handler(...args)
    } catch (error) {
      handleWebviewError(error, context.operation || "unknown", context.sessionId, postRequestError)
    }
  }
}
