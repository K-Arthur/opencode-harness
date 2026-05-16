/**
 * opencode-specific error mapper.
 *
 * Maps the actual error event types emitted by @opencode-ai/sdk
 * (see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts) into the
 * normalised ErrorContext shape consumed by the webview's error renderer.
 *
 * Replaces backendErrorMapping.ts which mapped provider-specific codes
 * (`invalid_api_key`, `insufficient_quota`) that opencode never emits.
 *
 * The 5 failure modes we care about (per the production-readiness audit):
 *   1. Auth expiry / credential failure       → ProviderAuthError
 *   2. Quota / usage-limit reached            → ApiError 429 / 402
 *   3. Network down / opencode unreachable    → ApiError 0 / 503 / fetch failure
 *   4. Generation stuck / no response         → TTFB timeout (handled upstream)
 *   5. Output too long for the model          → MessageOutputLengthError
 */

import { ErrorCategory, ErrorSeverity, type ErrorContext } from "./errorTypes"

/** Shape of an opencode SDK error payload as it flows into the webview. */
export interface OpencodeError {
  /** Discriminator from the SDK (e.g. "ProviderAuthError", "APIError"). */
  name?: string
  /** Free-form message for technical detail. */
  message?: string
  /** Provider identifier when present (anthropic, openai, opencode). */
  providerID?: string
  /** HTTP status when this came from a fetch path. */
  statusCode?: number
  /** Whether the SDK marked this retryable (ApiError). */
  isRetryable?: boolean
  /** Cause / fetch failure context. */
  cause?: unknown
}

/** Minimal action descriptor — keep in sync with errorTypes.ErrorAction. */
interface MapperAction {
  label: string
  action: "retry" | "edit" | "contact_support" | "view_details" | "dismiss" | "regenerate" | "switch_model" | "upgrade_plan" | "wait_for_reset"
  primary?: boolean
}

/**
 * Map an opencode SDK error into a normalised ErrorContext suitable for the
 * webview error renderer. Always returns a value; unknown shapes fall back to
 * a generic "system" error with the original message preserved for support.
 */
export function mapOpencodeError(err: OpencodeError | undefined | null): ErrorContext {
  if (!err) {
    return makeContext({
      code: "UNKNOWN",
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      message: "Unknown error",
      userMessage: "Something went wrong. Try again or check the OpenCode output channel for details.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  const name = err.name || ""
  const message = err.message || ""

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  if (name === "ProviderAuthError" || /unauthori[sz]ed|invalid api key|missing credential/i.test(message)) {
    const provider = err.providerID || "the provider"
    return makeContext({
      code: "AUTH_FAILED",
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: `Authentication failed for ${provider}. Check your API key in opencode auth.`,
      actions: [
        { label: "Open auth settings", action: "edit", primary: true },
        { label: "Switch provider", action: "switch_model" },
      ],
      retryable: false,
    })
  }

  // ── 2. Output / context length ─────────────────────────────────────────────
  if (name === "MessageOutputLengthError" || /max_tokens|output.*length|too many tokens/i.test(message)) {
    return makeContext({
      code: "OUTPUT_LENGTH_EXCEEDED",
      category: ErrorCategory.CONTEXT,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: "The model hit its output limit before finishing. Try a shorter prompt, switch to a model with a larger output budget, or ask the model to continue.",
      actions: [
        { label: "Continue", action: "regenerate", primary: true },
        { label: "Switch model", action: "switch_model" },
      ],
      retryable: true,
    })
  }

  // ── 3. Aborted ─────────────────────────────────────────────────────────────
  if (name === "MessageAbortedError" || /aborted|cancell?ed/i.test(message)) {
    return makeContext({
      code: "MESSAGE_ABORTED",
      category: ErrorCategory.GENERATION,
      severity: ErrorSeverity.LOW,
      message,
      userMessage: "The request was cancelled.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  // ── 4. APIError (HTTP-level) ──────────────────────────────────────────────
  if (name === "APIError" || typeof err.statusCode === "number") {
    return mapApiError(err)
  }

  // ── 5. Network / connection (no statusCode means we never reached the wire) ─
  if (/fetch failed|econnrefused|enotfound|network|opencode server/i.test(message)) {
    return makeContext({
      code: "NETWORK_UNREACHABLE",
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: "Can't reach the OpenCode server. Make sure it's running on localhost:4096, then retry.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable: true,
    })
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return makeContext({
    code: name || "UNKNOWN",
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    message,
    userMessage: message || "An unexpected error occurred.",
    actions: [{ label: "Retry", action: "retry", primary: true }],
    retryable: err.isRetryable ?? true,
  })
}

function mapApiError(err: OpencodeError): ErrorContext {
  const status = err.statusCode ?? 0
  const message = err.message || `HTTP ${status}`
  const retryable = err.isRetryable ?? (status >= 500 || status === 429 || status === 0)

  // 401 / 403 → auth
  if (status === 401 || status === 403) {
    return makeContext({
      code: "AUTH_FAILED",
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: "The server rejected the request as unauthorised. Re-check your provider credentials.",
      actions: [{ label: "Open auth settings", action: "edit", primary: true }],
      retryable: false,
    })
  }

  // 402 → payment / quota
  if (status === 402) {
    return makeContext({
      code: "QUOTA_EXCEEDED",
      category: ErrorCategory.USAGE,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: "Your usage quota for this provider is exhausted. Top up the account or switch to a different provider.",
      actions: [
        { label: "Switch provider", action: "switch_model", primary: true },
        { label: "Open billing", action: "upgrade_plan" },
      ],
      retryable: false,
    })
  }

  // 429 → rate limit
  if (status === 429) {
    return makeContext({
      code: "RATE_LIMITED",
      category: ErrorCategory.USAGE,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: "The provider is rate-limiting requests. Wait a moment, then retry.",
      actions: [
        { label: "Wait & retry", action: "wait_for_reset", primary: true },
        { label: "Switch model", action: "switch_model" },
      ],
      retryable: true,
    })
  }

  // 0 or 5xx → server unreachable / server error
  if (status === 0 || status >= 500) {
    return makeContext({
      code: status === 0 ? "NETWORK_UNREACHABLE" : "SERVER_ERROR",
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      message,
      userMessage: status === 0
        ? "Can't reach the OpenCode server. Make sure it's running on localhost:4096."
        : "The OpenCode server returned an error. Retry, or check its logs.",
      actions: [{ label: "Retry", action: "retry", primary: true }],
      retryable,
    })
  }

  // 4xx (other) → bad request
  return makeContext({
    code: "BAD_REQUEST",
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    message,
    userMessage: `Request failed: ${message}`,
    actions: [{ label: "Retry", action: "retry", primary: true }],
    retryable,
  })
}

function makeContext(p: {
  code: string
  category: ErrorCategory
  severity: ErrorSeverity
  message: string
  userMessage: string
  actions: MapperAction[]
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
