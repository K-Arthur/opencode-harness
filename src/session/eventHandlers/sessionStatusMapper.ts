interface ErrorAction {
  label: string
  action: string
  primary?: boolean
  metadata?: Record<string, unknown>
}

interface ErrorContextLike {
  category: "network" | "usage" | "generation" | "auth" | "model" | "context" | "system"
  severity: "low" | "medium" | "high" | "critical"
  code: string
  message: string
  userMessage: string
  technicalDetails?: string
  suggestedActions: ErrorAction[]
  retryable: boolean
  timestamp: number
}

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

export function extractSessionStatusError(data: unknown): SessionStatusError | null {
  if (data === null || data === undefined) return null
  if (typeof data !== "object") {
    try { console.warn("[sessionStatusMapper] malformed input — expected object, got", typeof data) } catch { /* console may be absent in tests */ }
    return null
  }

  const obj = data as Record<string, unknown>
  if (obj.status && typeof obj.status === "object") {
    const status = obj.status as Record<string, unknown>
    const action = status.action && typeof status.action === "object"
      ? status.action as Record<string, unknown>
      : undefined
    return {
      type: typeof status.type === "string" ? status.type : undefined,
      message: typeof status.message === "string" ? status.message : undefined,
      attempt: typeof status.attempt === "number" ? status.attempt : undefined,
      action: action
        ? {
            reason: typeof action.reason === "string" ? action.reason : undefined,
            provider: typeof action.provider === "string" ? action.provider : undefined,
            title: typeof action.title === "string" ? action.title : undefined,
            url: typeof action.url === "string" ? action.url : undefined,
          }
        : undefined,
    }
  }

  return {
    type: typeof obj.type === "string" ? obj.type : undefined,
    message: typeof obj.message === "string" ? obj.message : undefined,
    attempt: typeof obj.attempt === "number" ? obj.attempt : undefined,
  }
}

export function mapSessionStatusError(error: SessionStatusError): ErrorContextLike {
  const reason = error.action?.reason || ""
  const title = error.action?.title || ""
  const message = error.message || ""
  const lower = message.toLowerCase()
  const type = error.type || ""

  if (reason === "free_tier_limit" || lower.includes("free usage") || lower.includes("free tier")) {
    return makeContext({
      code: "FREE_TIER_LIMIT",
      category: "usage",
      severity: "high",
      message,
      userMessage: title ? `${message}. ${title} to continue.` : message,
      actions: title
        ? [{ label: title, action: "upgrade_plan", primary: true, metadata: { url: error.action?.url } }]
        : [{ label: "Upgrade Plan", action: "upgrade_plan", primary: true }],
      retryable: false,
    })
  }

  if (reason === "rate_limit" || lower.includes("rate limit") || lower.includes("too many requests")) {
    return makeContext({
      code: "RATE_LIMITED",
      category: "usage",
      severity: "medium",
      message,
      userMessage: lower.includes("rate") ? message : `Rate limit: ${message}`,
      actions: [
        { label: "Wait & Retry", action: "wait_for_reset", primary: true },
        { label: "Switch Model", action: "switch_model" },
      ],
      retryable: true,
    })
  }

  if (reason === "auth_required" || lower.includes("auth") || lower.includes("authentication")) {
    return makeContext({
      code: "AUTH_REQUIRED",
      category: "auth",
      severity: "high",
      message,
      userMessage: lower.includes("auth") ? message : `Authentication: ${message}`,
      actions: [
        { label: "Configure Credentials", action: "edit", primary: true },
        { label: "Switch Provider", action: "switch_model" },
      ],
      retryable: false,
    })
  }

  if (reason === "model_unavailable" || lower.includes("model") && (lower.includes("unavailable") || lower.includes("overload"))) {
    return makeContext({
      code: "MODEL_UNAVAILABLE",
      category: "model",
      severity: "medium",
      message,
      userMessage: `${message}. Try again later or switch to a different model.`,
      actions: [
        { label: "Switch Model", action: "switch_model", primary: true },
        { label: "Retry", action: "retry" },
      ],
      retryable: true,
    })
  }

  if (type === "error" && lower.includes("timeout")) {
    return makeContext({
      code: "TIMEOUT",
      category: "network",
      severity: "medium",
      message,
      userMessage: `${message}. Please check your connection and try again.`,
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  if (type === "error" && (lower.includes("network") || lower.includes("connection"))) {
    return makeContext({
      code: "NETWORK_ERROR",
      category: "network",
      severity: "medium",
      message,
      userMessage: message,
      actions: [
        { label: "Retry", action: "retry", primary: true },
        { label: "Check Connection", action: "view_details" },
      ],
      retryable: true,
    })
  }

  if (type === "retry") {
    return makeContext({
      code: reason ? `RETRY_${reason.toUpperCase()}` : "RETRY_STATUS",
      category: "system",
      severity: "medium",
      message: message || "Request failed",
      userMessage: message || "The request failed. Please try again.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  if (type === "error") {
    return makeContext({
      code: "ERROR_STATUS",
      category: "system",
      severity: "high",
      message: message || "Unknown error",
      userMessage: message || "An error occurred. Please try again.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  return makeContext({
    code: "UNKNOWN_STATUS",
    category: "system",
    severity: "low",
    message: message || type || "Unknown status",
    userMessage: message ? `${message} (unknown status)` : type ? `${type} (unknown status)` : "unknown status",
    actions: [{ label: "Retry", action: "retry", primary: true }],
    retryable: true,
  })
}

function makeContext(p: {
  code: string
  category: ErrorContextLike["category"]
  severity: ErrorContextLike["severity"]
  message: string
  userMessage: string
  actions: ErrorAction[]
  retryable: boolean
}): ErrorContextLike {
  return {
    category: p.category,
    severity: p.severity,
    code: p.code,
    message: p.message,
    userMessage: p.userMessage,
    // Surface the raw server message behind progressive disclosure when it
    // differs from the (possibly augmented) user-facing message.
    technicalDetails: p.message && p.message !== p.userMessage ? p.message : undefined,
    suggestedActions: p.actions,
    retryable: p.retryable,
    timestamp: Date.now(),
  }
}
