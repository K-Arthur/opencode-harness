import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mapOpencodeError } from "./opencodeErrorMapper"
import { ErrorCategory, ErrorSeverity } from "./errorTypes"

describe("mapOpencodeError — grounded in actual @opencode-ai/sdk error types", () => {
  // ── ProviderAuthError ────────────────────────────────────────────────────
  it("ProviderAuthError → AUTH_FAILED, severity HIGH, not retryable", () => {
    const ctx = mapOpencodeError({ name: "ProviderAuthError", message: "401 invalid token", providerID: "anthropic" })
    assert.equal(ctx.code, "AUTH_FAILED")
    assert.equal(ctx.category, ErrorCategory.AUTH)
    assert.equal(ctx.severity, ErrorSeverity.HIGH)
    assert.equal(ctx.retryable, false)
    assert.match(ctx.userMessage, /anthropic/)
  })

  it("'invalid api key' message → AUTH_FAILED even without an explicit name", () => {
    const ctx = mapOpencodeError({ message: "401 invalid api key" })
    assert.equal(ctx.code, "AUTH_FAILED")
  })

  // ── MessageOutputLengthError ─────────────────────────────────────────────
  it("MessageOutputLengthError → OUTPUT_LENGTH_EXCEEDED, suggests Continue + Switch model", () => {
    const ctx = mapOpencodeError({ name: "MessageOutputLengthError", message: "exceeded max_tokens=8192" })
    assert.equal(ctx.code, "OUTPUT_LENGTH_EXCEEDED")
    assert.equal(ctx.category, ErrorCategory.CONTEXT)
    const labels = ctx.suggestedActions.map(a => a.label)
    assert.ok(labels.includes("Continue"))
    assert.ok(labels.includes("Switch model"))
  })

  // ── MessageAbortedError ──────────────────────────────────────────────────
  it("MessageAbortedError → MESSAGE_ABORTED, severity LOW, retryable", () => {
    const ctx = mapOpencodeError({ name: "MessageAbortedError", message: "aborted by user" })
    assert.equal(ctx.code, "MESSAGE_ABORTED")
    assert.equal(ctx.severity, ErrorSeverity.LOW)
    assert.equal(ctx.retryable, true)
  })

  // ── APIError: status code dispatch ───────────────────────────────────────
  it("APIError statusCode=401 → AUTH_FAILED", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 401, message: "Unauthorized" })
    assert.equal(ctx.code, "AUTH_FAILED")
    assert.equal(ctx.retryable, false)
  })

  it("APIError statusCode=402 → QUOTA_EXCEEDED (USAGE category)", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 402, message: "Payment Required" })
    assert.equal(ctx.code, "QUOTA_EXCEEDED")
    assert.equal(ctx.category, ErrorCategory.USAGE)
    assert.equal(ctx.retryable, false)
  })

  it("APIError statusCode=429 → RATE_LIMITED with wait_for_reset action", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 429, message: "Too Many Requests" })
    assert.equal(ctx.code, "RATE_LIMITED")
    assert.equal(ctx.category, ErrorCategory.USAGE)
    assert.equal(ctx.retryable, true)
    assert.ok(ctx.suggestedActions.some(a => a.action === "wait_for_reset"))
  })

  it("APIError statusCode=500 → SERVER_ERROR, retryable", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 500, message: "Internal Server Error" })
    assert.equal(ctx.code, "SERVER_ERROR")
    assert.equal(ctx.category, ErrorCategory.NETWORK)
    assert.equal(ctx.retryable, true)
  })

  it("APIError statusCode=0 → NETWORK_UNREACHABLE", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 0, message: "fetch failed" })
    assert.equal(ctx.code, "NETWORK_UNREACHABLE")
  })

  it("APIError statusCode=400 → BAD_REQUEST (system)", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 400, message: "Invalid prompt" })
    assert.equal(ctx.code, "BAD_REQUEST")
  })

  // ── Network errors (no statusCode, fetch-failure message) ────────────────
  it("'fetch failed' → NETWORK_UNREACHABLE", () => {
    const ctx = mapOpencodeError({ message: "fetch failed: ECONNREFUSED" })
    assert.equal(ctx.code, "NETWORK_UNREACHABLE")
    assert.match(ctx.userMessage, /localhost:4096/)
  })

  // ── ImageDecodeError ────────────────────────────────────────────────────
  it("ImageDecodeError → IMAGE_DECODE_FAILED, severity MEDIUM, not retryable", () => {
    const ctx = mapOpencodeError({ name: "ImageDecodeError", message: "Image could not be decoded" })
    assert.equal(ctx.code, "IMAGE_DECODE_FAILED")
    assert.equal(ctx.category, ErrorCategory.GENERATION)
    assert.equal(ctx.severity, ErrorSeverity.MEDIUM)
    assert.equal(ctx.retryable, false)
    assert.match(ctx.userMessage, /image/i)
    assert.ok(ctx.suggestedActions.some(a => a.action === "edit"))
  })

  it("'image could not be decoded' message → IMAGE_DECODE_FAILED without explicit name", () => {
    const ctx = mapOpencodeError({ message: "image could not be decoded" })
    assert.equal(ctx.code, "IMAGE_DECODE_FAILED")
    assert.equal(ctx.retryable, false)
  })

  // ── UnknownError / fallback ──────────────────────────────────────────────
  it("UnknownError → SYSTEM/medium, preserves original message", () => {
    const ctx = mapOpencodeError({ name: "UnknownError", message: "something exploded" })
    assert.equal(ctx.category, ErrorCategory.SYSTEM)
    assert.equal(ctx.message, "something exploded")
  })

  it("null/undefined input → SYSTEM/UNKNOWN", () => {
    const ctx = mapOpencodeError(null)
    assert.equal(ctx.code, "UNKNOWN")
    assert.equal(ctx.retryable, true)
  })

  // ── Retryable flag is honoured when the SDK provides it ──────────────────
  it("APIError honours SDK-provided isRetryable=false for 5xx", () => {
    const ctx = mapOpencodeError({ name: "APIError", statusCode: 500, isRetryable: false, message: "fatal" })
    assert.equal(ctx.retryable, false)
  })
})

describe("mapOpencodeError — real @opencode-ai/sdk nested .data shape", () => {
  // The SDK emits { name, data: { statusCode, isRetryable, message, providerID } }
  // (see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts). The mapper must
  // read from .data, not only the top level, or every ApiError collapses to status 0.
  it("ApiError 429 nested under .data → RATE_LIMITED, not NETWORK_UNREACHABLE", () => {
    const ctx = mapOpencodeError({
      name: "APIError",
      data: { message: "Too Many Requests", statusCode: 429, isRetryable: true },
    })
    assert.equal(ctx.code, "RATE_LIMITED")
    assert.equal(ctx.category, ErrorCategory.USAGE)
    assert.equal(ctx.retryable, true)
  })

  it("ApiError 401 nested under .data → AUTH_FAILED", () => {
    const ctx = mapOpencodeError({ name: "APIError", data: { message: "Unauthorized", statusCode: 401, isRetryable: false } })
    assert.equal(ctx.code, "AUTH_FAILED")
    assert.equal(ctx.retryable, false)
  })

  it("ApiError 500 honours nested isRetryable=false", () => {
    const ctx = mapOpencodeError({ name: "APIError", data: { message: "boom", statusCode: 500, isRetryable: false } })
    assert.equal(ctx.code, "SERVER_ERROR")
    assert.equal(ctx.retryable, false)
  })

  it("ProviderAuthError nested .data → names the provider", () => {
    const ctx = mapOpencodeError({
      name: "ProviderAuthError",
      data: { providerID: "anthropic", message: "401 invalid token" },
    })
    assert.equal(ctx.code, "AUTH_FAILED")
    assert.match(ctx.userMessage, /anthropic/)
  })

  it("nested .data message is matched by the auth/network regex fallbacks", () => {
    const ctx = mapOpencodeError({ name: "UnknownError", data: { message: "fetch failed: ECONNREFUSED" } })
    assert.equal(ctx.code, "NETWORK_UNREACHABLE")
  })

  // ── technicalDetails preserved for progressive disclosure ──────────────────
  it("preserves the raw technical message in technicalDetails when the userMessage is canned", () => {
    const ctx = mapOpencodeError({ name: "APIError", data: { message: "stack trace: boom", statusCode: 500, isRetryable: true } })
    assert.equal(ctx.technicalDetails, "stack trace: boom")
  })

  it("prefers responseBody as technicalDetails when present", () => {
    const ctx = mapOpencodeError({
      name: "APIError",
      data: { message: "Bad Request", statusCode: 400, isRetryable: false, responseBody: '{"error":"detail"}' },
    })
    assert.equal(ctx.technicalDetails, '{"error":"detail"}')
  })

  it("does not duplicate userMessage in technicalDetails on the generic fallback", () => {
    // Fallback sets userMessage = message; there is nothing extra to disclose.
    const ctx = mapOpencodeError({ name: "WeirdError", message: "something odd" })
    assert.equal(ctx.userMessage, "something odd")
    assert.equal(ctx.technicalDetails, undefined)
  })
})
