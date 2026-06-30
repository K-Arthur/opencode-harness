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
  /**
   * The actual SDK error union nests its payload here, e.g.
   *   ApiError          = { name, data: { message, statusCode?, isRetryable, responseBody? } }
   *   ProviderAuthError = { name, data: { providerID, message } }
   * (see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts). We accept both
   * the nested and the flat shapes so callers can pass either.
   */
  data?: {
    message?: string
    providerID?: string
    statusCode?: number
    isRetryable?: boolean
    responseBody?: string
  }
}

/** Flatten the SDK error (top-level OR nested under `.data`) into one shape. */
function normalize(err: OpencodeError) {
  const d = err.data ?? {}
  const message = err.message ?? d.message ?? ""
  // Prefer the richest raw detail available for the disclosure panel.
  const technical = d.responseBody ?? message
  return {
    name: err.name ?? "",
    message,
    technical,
    providerID: err.providerID ?? d.providerID,
    statusCode: err.statusCode ?? d.statusCode,
    isRetryable: err.isRetryable ?? d.isRetryable,
  }
}

/** Minimal action descriptor — keep in sync with errorTypes.ErrorAction. */
interface MapperAction {
  label: string
  action: "retry" | "edit" | "contact_support" | "view_details" | "dismiss" | "regenerate" | "switch_model" | "upgrade_plan" | "wait_for_reset" | "pick_model"
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

  const { name, message, technical, providerID, statusCode, isRetryable } = normalize(err)

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  if (name === "ProviderAuthError" || /unauthori[sz]ed|invalid api key|missing credential/i.test(message)) {
    const provider = providerID || "the provider"
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
      technical,
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
      technical,
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
      technical,
    })
  }

  // ── 3b. Image decode failure (ImageDecodeError) ───────────────────────────
  // Server-side: the Image.normalize step in SessionPrompt.createUserMessage
  // throws when it cannot decode a file part as an image. The image may be
  // corrupted, in an unsupported format, or have a MIME-vs-content mismatch.
  if (name === "ImageDecodeError" || /image (could not be decoded|decoding failed|decode error)/i.test(message)) {
    return makeContext({
      code: "IMAGE_DECODE_FAILED",
      category: ErrorCategory.GENERATION,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: "One or more attached images could not be decoded. Try a different image format (PNG, JPEG, GIF, WebP) or re-capture the image.",
      actions: [
        { label: "Edit prompt", action: "edit", primary: true },
      ],
      retryable: false,
      technical,
    })
  }

  // ── 4. APIError (HTTP-level) ──────────────────────────────────────────────
  if (name === "APIError" || typeof statusCode === "number") {
    return mapApiError(statusCode ?? 0, message, isRetryable, technical)
  }

  // ── 4b. No model selected ─────────────────────────────────────────────
  if (/no model selected|pick a model/i.test(message)) {
    return makeContext({
      code: "NO_MODEL_SELECTED",
      category: ErrorCategory.MODEL,
      severity: ErrorSeverity.MEDIUM,
      message,
      userMessage: message || "No model is selected. Pick a model to continue.",
      actions: [
        { label: "Pick model", action: "pick_model", primary: true },
        { label: "Configure provider", action: "edit" },
      ],
      retryable: false,
      technical,
    })
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
      technical,
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
    retryable: isRetryable ?? true,
    technical,
  })
}

function mapApiError(status: number, rawMessage: string, isRetryable: boolean | undefined, technical: string): ErrorContext {
  const message = rawMessage || `HTTP ${status}`
  const retryable = isRetryable ?? (status >= 500 || status === 429 || status === 0)

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
      technical,
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
      technical,
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
      technical,
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
      technical,
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
    technical,
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
  /** Raw technical detail for the disclosure panel; omitted when it would duplicate userMessage. */
  technical?: string
}): ErrorContext {
  const technicalDetails = p.technical && p.technical !== p.userMessage ? p.technical : undefined
  return {
    category: p.category,
    severity: p.severity,
    code: p.code,
    message: p.message,
    userMessage: p.userMessage,
    technicalDetails,
    suggestedActions: p.actions,
    retryable: p.retryable,
    timestamp: Date.now(),
  } as ErrorContext
}
