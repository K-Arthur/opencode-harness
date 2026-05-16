/**
 * Session Status Error Mapper
 * 
 * Maps OpenCode server session.status events to user-friendly error messages.
 * This is DIFFERENT from opencodeErrorMapper.ts which handles SDK errors.
 * 
 * Session status events come from the server via SSE and contain action.reason/action.provider
 * which are not present in SDK error objects.
 * 
 * Actual structure from logs:
 * session.status props={"sessionID":"ses_1dc032998ffe2gkCaKPyamSZq3","status":{"type":"retry","attempt":1,"message":"Free usage exceeded, subscribe to Go","action":{"reason":"free_tier_limit","provider":"opencode","title":"Subscribe to Go"}}}
 */

import { ErrorCategory, ErrorSeverity, type ErrorContext } from "./errorTypes"

/**
 * Represents a session status error from server event
 */
export interface SessionStatusError {
  type?: string
  message?: string
  attempt?: number
  action?: {
    reason?: string
    provider?: string
    title?: string
    url?: string
  }
}

/**
 * Extract session status error from server event data.
 * I6: Logs a warning on malformed (non-null) input so the host's swallow-and-return-null
 * path is observable. null/undefined are treated as legit absence and stay silent.
 */
export function extractSessionStatusError(data: unknown): SessionStatusError | null {
  if (data === null || data === undefined) {
    return null
  }
  if (typeof data !== "object") {
    try { console.warn("[sessionStatusMapper] malformed input — expected object, got", typeof data) } catch { /* console may be absent in tests */ }
    return null
  }

  const obj = data as Record<string, unknown>
  
  // Handle nested status structure (actual format from logs)
  if (obj.status && typeof obj.status === 'object') {
    const status = obj.status as Record<string, unknown>
    return {
      type: typeof status.type === 'string' ? status.type : undefined,
      message: typeof status.message === 'string' ? status.message : undefined,
      attempt: typeof status.attempt === 'number' ? status.attempt : undefined,
      action: status.action && typeof status.action === 'object' 
        ? {
            reason: typeof (status.action as Record<string, unknown>).reason === 'string' 
              ? (status.action as Record<string, unknown>).reason 
              : undefined,
            provider: typeof (status.action as Record<string, unknown>).provider === 'string' 
              ? (status.action as Record<string, unknown>).provider 
              : undefined,
            title: typeof (status.action as Record<string, unknown>).title === 'string' 
              ? (status.action as Record<string, unknown>).title 
              : undefined,
            url: typeof (status.action as Record<string, unknown>).url === 'string' 
              ? (status.action as Record<string, unknown>).url 
              : undefined,
          } as { reason?: string; provider?: string; title?: string; url?: string }
        : undefined,
    }
  }
  
  // Handle flat structure (fallback)
  return {
    type: typeof obj.type === 'string' ? obj.type : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
    attempt: typeof obj.attempt === 'number' ? obj.attempt : undefined,
  }
}

/**
 * Map session status error to user-friendly error context
 */
export function mapSessionStatusError(error: SessionStatusError): ErrorContext {
  const reason = error.action?.reason || ""
  const provider = error.action?.provider || ""
  const title = error.action?.title || ""
  const message = error.message || ""
  const type = error.type || ""

  // ── Free tier limit ───────────────────────────────────────────────────────
  if (reason === "free_tier_limit" || message.toLowerCase().includes("free usage") || message.toLowerCase().includes("free tier")) {
    const userMessage = title 
      ? `${message}. ${title} to continue.`
      : message
    
    return makeContext({
      code: "FREE_TIER_LIMIT",
      category: ErrorCategory.USAGE,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage,
      actions: title 
        ? [{ label: title, action: "upgrade_plan", primary: true, metadata: { url: error.action?.url } }]
        : [{ label: "Upgrade Plan", action: "upgrade_plan", primary: true }],
      retryable: false,
    })
  }

  // ── Rate limit ──────────────────────────────────────────────────────────────
  if (reason === "rate_limit" || message.toLowerCase().includes("rate limit") || message.toLowerCase().includes("too many requests")) {
    return makeContext({
      code: "RATE_LIMITED",
      category: ErrorCategory.USAGE,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: message.includes("rate") ? message : `Rate limit: ${message}`,
      actions: [
        { label: "Wait & Retry", action: "wait_for_reset", primary: true },
        { label: "Switch Model", action: "switch_model" },
      ],
      retryable: true,
    })
  }

  // ── Auth required ────────────────────────────────────────────────────────────
  if (reason === "auth_required" || message.toLowerCase().includes("auth") || message.toLowerCase().includes("authentication")) {
    return makeContext({
      code: "AUTH_REQUIRED",
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: message.toLowerCase().includes("auth") ? message : `Authentication: ${message}`,
      actions: [
        { label: "Configure Credentials", action: "edit", primary: true },
        { label: "Switch Provider", action: "switch_model" },
      ],
      retryable: false,
    })
  }

  // ── Model unavailable ─────────────────────────────────────────────────────────
  if (reason === "model_unavailable" || message.toLowerCase().includes("model") && (message.toLowerCase().includes("unavailable") || message.toLowerCase().includes("overload"))) {
    return makeContext({
      code: "MODEL_UNAVAILABLE",
      category: ErrorCategory.MODEL,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: `${message}. Try again later or switch to a different model.`,
      actions: [
        { label: "Switch Model", action: "switch_model", primary: true },
        { label: "Retry", action: "retry" },
      ],
      retryable: true,
    })
  }

  // ── Timeout ──────────────────────────────────────────────────────────────────
  if (type === "error" && message.toLowerCase().includes("timeout")) {
    return makeContext({
      code: "TIMEOUT",
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: `${message}. Please check your connection and try again.`,
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  // ── Network error ────────────────────────────────────────────────────────────
  if (type === "error" && (message.toLowerCase().includes("network") || message.toLowerCase().includes("connection"))) {
    return makeContext({
      code: "NETWORK_ERROR",
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: message,
      actions: [
        { label: "Retry", action: "retry", primary: true },
        { label: "Check Connection", action: "view_details" },
      ],
      retryable: true,
    })
  }

  // ── Generic retry ────────────────────────────────────────────────────────────
  if (type === "retry") {
    return makeContext({
      code: reason ? `RETRY_${reason.toUpperCase()}` : "RETRY_STATUS",
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      message: message || "Request failed",
      userMessage: message || "The request failed. Please try again.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  // ── Generic error ─────────────────────────────────────────────────────────────
  if (type === "error") {
    return makeContext({
      code: "ERROR_STATUS",
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.HIGH,
      message: message || "Unknown error",
      userMessage: message || "An error occurred. Please try again.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  // ── Unknown status ─────────────────────────────────────────────────────────────
  return makeContext({
    code: "UNKNOWN_STATUS",
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.LOW,
    message: message || type || "Unknown status",
    userMessage: message ? `${message} (unknown status)` : type ? `${type} (unknown status)` : "unknown status",
    actions: [{ label: "Retry", action: "retry", primary: true }],
    retryable: true,
  })
}

function makeContext(p: {
  code: string
  category: ErrorCategory
  severity: ErrorSeverity
  message: string
  userMessage: string
  actions: Array<{ label: string; action: string; primary?: boolean; metadata?: Record<string, unknown> }>
  retryable: boolean
}): ErrorContext {
  return {
    category: p.category,
    severity: p.severity,
    code: p.code,
    message: p.message,
    userMessage: p.userMessage,
    suggestedActions: p.actions,
    retryable: p.retryable,
    timestamp: Date.now(),
  } as ErrorContext
}
