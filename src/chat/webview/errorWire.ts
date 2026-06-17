/**
 * Type-safe IPC boundary for error propagation (host ↔ webview).
 *
 * This module is the SOLE authority for how error payloads cross the
 * `webview.postMessage` boundary. It guarantees two invariants required by
 * the frontend error-receiving infrastructure:
 *
 *   1. No trivial pass-throughs: every inbound value is validated, never
 *      trusted via a TypeScript `as` cast. Malformed payloads (`null`,
 *      `"[object Object]"`, partial objects) normalize to a safe fallback
 *      instead of crashing the renderer.
 *   2. Spatial routing is deterministic: each normalized error carries an
 *      `ErrorTier` ('A' | 'B' | 'C') derived from a single pure function,
 *      never guessed per call-site.
 *
 * The underlying discriminated payload union (`WebviewErrorPayload`) and its
 * round-trip mappers (`toWebviewErrorPayload` / `toErrorContext`) live in
 * `errorTypes.ts`. This module wraps them with boundary validation and tier
 * derivation; it does not duplicate the payload shape.
 */

import {
  ErrorCategory,
  ErrorSeverity,
  type ErrorContext,
  type WebviewErrorPayload,
  createErrorContext,
  toErrorContext,
} from "./errorTypes"

/**
 * Spatial-containment tier. Drives WHICH component renders the error:
 *   - 'A' Hard Block      → composer-anchored, disables input (account/quota/auth)
 *   - 'B' Infrastructure  → ambient top-edge global banner (network/system, retryable)
 *   - 'C' Local Stream    → inline system turn in the conversation thread
 */
export type ErrorTier = "A" | "B" | "C"

/** The four discriminated payload `type` literals from `WebviewErrorPayload`. */
export const ERROR_PAYLOAD_TYPES = [
  "auth_error",
  "quota_error",
  "infra_error",
  "stream_error",
] as const
export type ErrorPayloadType = (typeof ERROR_PAYLOAD_TYPES)[number]

export function isErrorPayloadType(s: unknown): s is ErrorPayloadType {
  return typeof s === "string" && (ERROR_PAYLOAD_TYPES as readonly string[]).includes(s)
}

/**
 * Host-side envelope for rapid-fire multi-stream failure bursts. The host
 * batcher emits ONE `error_batch` per flush window instead of N individual
 * payloads, preventing DOM flood on the webview.
 */
export interface ErrorBatchEnvelope {
  type: "error_batch"
  sessionId?: string
  contexts: WebviewErrorPayload[]
}

/**
 * Host → webview signal to dismiss live Tier-B banners (abrupt connection
 * restoration while a banner is actively drawn). Tier-A state is NOT cleared
 * by this (hard caps survive reconnect).
 */
export interface ErrorClearedEnvelope {
  type: "error_cleared"
  sessionId?: string
  correlationIds: string[]
}

/** Discriminated union of every error-bearing envelope that crosses the wire. */
export type ErrorEnvelope = WebviewErrorPayload | ErrorBatchEnvelope | ErrorClearedEnvelope

export function isErrorBatchEnvelope(e: unknown): e is ErrorBatchEnvelope {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<string, unknown>).type === "error_batch" &&
    Array.isArray((e as { contexts?: unknown }).contexts)
  )
}

export function isErrorClearedEnvelope(e: unknown): e is ErrorClearedEnvelope {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<string, unknown>).type === "error_cleared" &&
    Array.isArray((e as { correlationIds?: unknown }).correlationIds)
  )
}

/** How a normalized error was derived — used for telemetry on contract drift. */
export type NormalizationSource =
  | "typed-payload" // host sent a validated WebviewErrorPayload
  | "legacy-context" // host sent a raw ErrorContext (pre-typed-wire emitters)
  | "parsed-string" // a JSON or plain string was parsed into a context
  | "normalized-fallback" // malformed input; safe fallback applied

export interface NormalizedError {
  context: ErrorContext
  tier: ErrorTier
  source: NormalizationSource
}

/**
 * Derive the spatial tier from an {@link ErrorContext}. Pure and total — the
 * ONLY place tier routing is decided when starting from a context.
 *
 * Matrix (see PLAN.md §2):
 *   - USAGE non-retryable + (HIGH|CRITICAL)          → A  (quota cap)
 *   - AUTH   non-retryable + (HIGH|CRITICAL)         → A  (must re-authenticate)
 *   - SYSTEM non-retryable + CRITICAL                → A  (unusable system state)
 *   - NETWORK|SYSTEM retryable                       → B  (transient infra)
 *   - everything else                                → C  (local stream fault)
 */
export function deriveTier(ctx: ErrorContext): ErrorTier {
  const highOrCritical =
    ctx.severity === ErrorSeverity.HIGH || ctx.severity === ErrorSeverity.CRITICAL

  if (ctx.category === ErrorCategory.USAGE && !ctx.retryable && highOrCritical) return "A"
  if (ctx.category === ErrorCategory.AUTH && !ctx.retryable && highOrCritical) return "A"
  if (
    ctx.category === ErrorCategory.SYSTEM &&
    !ctx.retryable &&
    ctx.severity === ErrorSeverity.CRITICAL
  ) {
    return "A"
  }

  if (
    ctx.retryable &&
    (ctx.category === ErrorCategory.NETWORK || ctx.category === ErrorCategory.SYSTEM)
  ) {
    return "B"
  }

  return "C"
}

/**
 * Derive the tier directly from a validated {@link WebviewErrorPayload}. Used
 * at the webview boundary so the tier follows the host's payload-type
 * classification (which is authoritative once on the wire) rather than
 * re-deriving from fields that may have been dropped during serialization.
 *
 * Payload → tier mapping is intentionally coarser than {@link deriveTier}
 * because the payload `type` already encodes the host's classification:
 *   auth_error / quota_error → A, infra_error → B, stream_error → C.
 */
export function deriveTierFromPayload(p: WebviewErrorPayload): ErrorTier {
  switch (p.type) {
    case "auth_error":
      return "A"
    case "quota_error":
      return "A"
    case "infra_error":
      return "B"
    case "stream_error":
      return "C"
  }
}

/**
 * Validate and normalize an arbitrary inbound value into a renderable
 * {@link NormalizedError}. This is the boundary gate that replaces unsafe
 * `as WebviewErrorPayload` / `as ErrorContext` casts.
 *
 * Never throws. Every code path returns a usable {@link NormalizedError};
 * malformed input degrades gracefully to a Tier-C fallback context with code
 * `UNKNOWN_INBOUND` so the UI never renders `[object Object]` or crashes.
 *
 * @param raw       whatever arrived on the wire (often `error.errorContext`)
 * @param sessionId optional session scoping for the fallback context
 */
export function normalizeIncomingError(raw: unknown, sessionId?: string): NormalizedError {
  // 1. null / undefined
  if (raw === null || raw === undefined) {
    return fallback("Received no error details.", sessionId)
  }

  // 2. string — try JSON, else treat the string itself as the message
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed === "") return fallback("Received an empty error message.", sessionId)
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return normalizeIncomingError(JSON.parse(trimmed), sessionId)
      } catch {
        // not JSON — fall through to plain-string handling
      }
    }
    const context = createErrorContext("UNKNOWN_INBOUND", {
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      message: trimmed,
      userMessage: trimmed,
      retryable: false,
      sessionId,
    })
    return { context, tier: "C" as const, source: "parsed-string" as const }
  }

  // 3. primitives (number, boolean, symbol, bigint) — never a valid error
  if (typeof raw !== "object") {
    return fallback(`Unexpected error payload of type ${typeof raw}.`, sessionId)
  }

  const obj = raw as Record<string, unknown>

  // 4. typed payload — validate inner structure, not just the `type` tag
  if (isErrorPayloadType(obj.type)) {
    if (typeof obj.code === "string" && typeof obj.userMessage === "string") {
      const payload = obj as unknown as WebviewErrorPayload
      const context = toErrorContext(payload)
      return {
        context,
        tier: deriveTierFromPayload(payload),
        source: "typed-payload",
      }
    }
    // tagged but structurally incomplete — treat as malformed
    return fallback("Received a typed payload with missing fields.", sessionId)
  }

  // 5. legacy ErrorContext shape (host emitters not yet migrated)
  if (
    typeof obj.category === "string" &&
    typeof obj.severity === "string" &&
    typeof obj.code === "string"
  ) {
    const context = hydrateLegacyContext(obj as unknown as ErrorContext, sessionId)
    return { context, tier: deriveTier(context), source: "legacy-context" }
  }

  // 6. unrecognised object shape
  return fallback("Received a malformed error payload.", sessionId)
}

/**
 * Coerce a legacy/raw {@link ErrorContext}-like object into a fully-shaped
 * context, hydrating any fields that may have been dropped on the wire.
 * Required because `noUncheckedIndexedAccess` + partial objects would
 * otherwise leak `undefined` into the renderer.
 */
function hydrateLegacyContext(input: ErrorContext, sessionId?: string): ErrorContext {
  return {
    ...input,
    category: input.category,
    severity: input.severity,
    code: input.code,
    message: typeof input.message === "string" ? input.message : input.code,
    userMessage: typeof input.userMessage === "string" ? input.userMessage : input.code,
    suggestedActions: Array.isArray(input.suggestedActions) ? input.suggestedActions : [],
    retryable: typeof input.retryable === "boolean" ? input.retryable : false,
    timestamp: typeof input.timestamp === "number" ? input.timestamp : Date.now(),
    sessionId: input.sessionId ?? sessionId,
    correlationId: input.correlationId,
  }
}

function fallback(message: string, sessionId?: string): NormalizedError {
  const context = createErrorContext("UNKNOWN_INBOUND", {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    message,
    userMessage: "Something went wrong. Please try again.",
    retryable: false,
    sessionId,
  })
  return { context, tier: "C", source: "normalized-fallback" }
}
