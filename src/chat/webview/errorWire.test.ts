/**
 * TDD contract tests for the error IPC boundary (`errorWire.ts`).
 *
 * These specify the invariants the frontend error-receiving infrastructure
 * depends on:
 *   - `deriveTier` is a pure total function matching the PLAN.md §2 matrix.
 *   - `normalizeIncomingError` never throws and never lets a malformed
 *     payload (`null`, `"[object Object]"`, partial object) reach a renderer.
 *   - Round-trip host→wire→webview preserves the intended tier.
 *
 * Run: `npx tsx --test "src/chat/webview/errorWire.test.ts"`
 */

import { describe, it } from "node:test"
import * as assert from "node:assert/strict"

import {
  ErrorCategory,
  ErrorSeverity,
  type ErrorContext,
  type WebviewErrorPayload,
  createErrorContext,
  toWebviewErrorPayload,
} from "./errorTypes"
import {
  deriveTier,
  deriveTierFromPayload,
  normalizeIncomingError,
  isErrorBatchEnvelope,
  isErrorClearedEnvelope,
  isErrorPayloadType,
  type ErrorTier,
} from "./errorWire"

// ---------- fixtures ----------

function ctx(overrides: Partial<ErrorContext>): ErrorContext {
  return createErrorContext("TEST_ERROR", {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    message: "m",
    userMessage: "u",
    retryable: false,
    ...overrides,
  })
}

const FIXTURES = {
  usageCap: ctx({
    category: ErrorCategory.USAGE,
    severity: ErrorSeverity.CRITICAL,
    retryable: false,
  }),
  usageHigh: ctx({
    category: ErrorCategory.USAGE,
    severity: ErrorSeverity.HIGH,
    retryable: false,
  }),
  usageRetryableLow: ctx({
    category: ErrorCategory.USAGE,
    severity: ErrorSeverity.LOW,
    retryable: true,
  }),
  authHard: ctx({
    category: ErrorCategory.AUTH,
    severity: ErrorSeverity.HIGH,
    retryable: false,
  }),
  systemCritical: ctx({
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.CRITICAL,
    retryable: false,
  }),
  networkTransient: ctx({
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    retryable: true,
  }),
  systemRetryable: ctx({
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.HIGH,
    retryable: true,
  }),
  generationFault: ctx({
    category: ErrorCategory.GENERATION,
    severity: ErrorSeverity.MEDIUM,
    retryable: true,
  }),
  contextOverflow: ctx({
    category: ErrorCategory.CONTEXT,
    severity: ErrorSeverity.MEDIUM,
    retryable: false,
  }),
  modelFault: ctx({
    category: ErrorCategory.MODEL,
    severity: ErrorSeverity.LOW,
    retryable: true,
  }),
} as const

// ---------- deriveTier matrix ----------

describe("deriveTier", () => {
  it("USAGE non-retryable CRITICAL → A (quota cap)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.usageCap), "A")
  })

  it("USAGE non-retryable HIGH → A (quota cap, not just critical)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.usageHigh), "A")
  })

  it("USAGE retryable LOW → C (transient throttle is not a hard cap)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.usageRetryableLow), "C")
  })

  it("AUTH non-retryable HIGH → A (must re-authenticate)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.authHard), "A")
  })

  it("SYSTEM non-retryable CRITICAL → A (unusable system)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.systemCritical), "A")
  })

  it("NETWORK retryable → B (transient infra)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.networkTransient), "B")
  })

  it("SYSTEM retryable HIGH → B (transient infra)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.systemRetryable), "B")
  })

  it("GENERATION fault → C (local stream)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.generationFault), "C")
  })

  it("CONTEXT overflow → C (local stream)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.contextOverflow), "C")
  })

  it("MODEL fault → C (local stream)", () => {
    assert.strictEqual<ErrorTier>(deriveTier(FIXTURES.modelFault), "C")
  })
})

// ---------- deriveTierFromPayload ----------

describe("deriveTierFromPayload", () => {
  function payloadFor(fixture: ErrorContext): WebviewErrorPayload {
    return toWebviewErrorPayload(fixture)
  }

  it("auth_error → A", () => {
    assert.strictEqual(deriveTierFromPayload(payloadFor(FIXTURES.authHard)), "A")
  })

  it("quota_error → A", () => {
    assert.strictEqual(deriveTierFromPayload(payloadFor(FIXTURES.usageCap)), "A")
  })

  it("infra_error → B", () => {
    assert.strictEqual(deriveTierFromPayload(payloadFor(FIXTURES.networkTransient)), "B")
  })

  it("stream_error → C", () => {
    assert.strictEqual(deriveTierFromPayload(payloadFor(FIXTURES.generationFault)), "C")
  })
})

// ---------- type guards ----------

describe("envelope type guards", () => {
  it("isErrorPayloadType accepts the 4 known types only", () => {
    assert.equal(isErrorPayloadType("auth_error"), true)
    assert.equal(isErrorPayloadType("quota_error"), true)
    assert.equal(isErrorPayloadType("infra_error"), true)
    assert.equal(isErrorPayloadType("stream_error"), true)
    assert.equal(isErrorPayloadType("request_error"), false)
    assert.equal(isErrorPayloadType(undefined), false)
    assert.equal(isErrorPayloadType(123), false)
  })

  it("isErrorBatchEnvelope validates shape", () => {
    assert.equal(
      isErrorBatchEnvelope({ type: "error_batch", contexts: [] }),
      true,
    )
    assert.equal(
      isErrorBatchEnvelope({ type: "error_batch" }),
      false,
    )
    assert.equal(isErrorBatchEnvelope({ type: "error", contexts: [] }), false)
    assert.equal(isErrorBatchEnvelope(null), false)
  })

  it("isErrorClearedEnvelope validates shape", () => {
    assert.equal(
      isErrorClearedEnvelope({ type: "error_cleared", correlationIds: ["a"] }),
      true,
    )
    assert.equal(
      isErrorClearedEnvelope({ type: "error_cleared" }),
      false,
    )
    assert.equal(isErrorClearedEnvelope({ type: "error", correlationIds: [] }), false)
  })
})

// ---------- normalizeIncomingError: malformed inputs never throw ----------

describe("normalizeIncomingError — graceful degradation", () => {
  it("null → fallback tier C, never throws", () => {
    const r = normalizeIncomingError(null)
    assert.equal(r.tier, "C")
    assert.equal(r.source, "normalized-fallback")
    assert.equal(r.context.code, "UNKNOWN_INBOUND")
    assert.equal(r.context.category, ErrorCategory.SYSTEM)
    assert.equal(r.context.retryable, false)
  })

  it("undefined → fallback tier C", () => {
    const r = normalizeIncomingError(undefined)
    assert.equal(r.tier, "C")
    assert.equal(r.source, "normalized-fallback")
  })

  it('plain "[object Object]" string → parsed-string fallback, never rendered as-is', () => {
    const r = normalizeIncomingError("[object Object]")
    // not valid JSON → treated as plain message, surfaced honestly as a message
    // but classified as a generic SYSTEM error, never as a structured payload.
    assert.equal(r.source, "parsed-string")
    assert.equal(r.tier, "C")
    assert.equal(r.context.userMessage, "[object Object]")
  })

  it("empty string → fallback", () => {
    const r = normalizeIncomingError("   ")
    assert.equal(r.source, "normalized-fallback")
    assert.equal(r.tier, "C")
  })

  it("number primitive → fallback", () => {
    const r = normalizeIncomingError(42)
    assert.equal(r.source, "normalized-fallback")
    assert.equal(r.tier, "C")
  })

  it("boolean primitive → fallback", () => {
    const r = normalizeIncomingError(true)
    assert.equal(r.source, "normalized-fallback")
  })

  it("object with no type/category/severity → fallback", () => {
    const r = normalizeIncomingError({ foo: "bar", baz: 1 })
    assert.equal(r.source, "normalized-fallback")
    assert.equal(r.tier, "C")
  })

  it("tagged payload missing required code/userMessage → fallback (not a blind cast)", () => {
    const r = normalizeIncomingError({ type: "auth_error", sessionId: "s" })
    assert.equal(r.source, "normalized-fallback")
    assert.equal(r.tier, "C")
  })

  it("sessionId is threaded into the fallback context", () => {
    const r = normalizeIncomingError(null, "sess-123")
    assert.equal(r.context.sessionId, "sess-123")
  })
})

// ---------- normalizeIncomingError: happy paths ----------

describe("normalizeIncomingError — typed payloads", () => {
  it("validated auth_error payload → tier A via payload derivation", () => {
    const payload = toWebviewErrorPayload(FIXTURES.authHard)
    const r = normalizeIncomingError(payload)
    assert.equal(r.source, "typed-payload")
    assert.equal(r.tier, "A")
    assert.equal(r.context.category, ErrorCategory.AUTH)
  })

  it("validated quota_error payload → tier A", () => {
    const payload = toWebviewErrorPayload(FIXTURES.usageCap)
    const r = normalizeIncomingError(payload)
    assert.equal(r.source, "typed-payload")
    assert.equal(r.tier, "A")
  })

  it("validated infra_error payload → tier B", () => {
    const payload = toWebviewErrorPayload(FIXTURES.networkTransient)
    const r = normalizeIncomingError(payload)
    assert.equal(r.source, "typed-payload")
    assert.equal(r.tier, "B")
  })

  it("validated stream_error payload → tier C", () => {
    const payload = toWebviewErrorPayload(FIXTURES.generationFault)
    const r = normalizeIncomingError(payload)
    assert.equal(r.source, "typed-payload")
    assert.equal(r.tier, "C")
  })
})

describe("normalizeIncomingError — legacy ErrorContext", () => {
  it("raw ErrorContext (no `type`) → legacy-context, tier derived from fields", () => {
    const r = normalizeIncomingError(FIXTURES.usageCap)
    assert.equal(r.source, "legacy-context")
    assert.equal(r.tier, "A")
    assert.equal(r.context.category, ErrorCategory.USAGE)
  })

  it("legacy network context → tier B", () => {
    const r = normalizeIncomingError(FIXTURES.networkTransient)
    assert.equal(r.source, "legacy-context")
    assert.equal(r.tier, "B")
  })

  it("hydrates missing optional fields (suggestedActions, timestamp)", () => {
    // Simulate a context that lost fields during serialization.
    const partial = {
      category: "network",
      severity: "high",
      code: "NET_500",
      retryable: true,
      // no suggestedActions, no timestamp, no message/userMessage
    }
    const r = normalizeIncomingError(partial)
    assert.equal(r.source, "legacy-context")
    assert.ok(Array.isArray(r.context.suggestedActions))
    assert.equal(r.context.suggestedActions.length, 0)
    assert.ok(typeof r.context.timestamp === "number")
    assert.equal(r.context.userMessage, "NET_500") // falls back to code
  })
})

describe("normalizeIncomingError — JSON strings", () => {
  it("JSON string of a typed payload → typed-payload", () => {
    const payload = toWebviewErrorPayload(FIXTURES.networkTransient)
    const r = normalizeIncomingError(JSON.stringify(payload))
    assert.equal(r.source, "typed-payload")
    assert.equal(r.tier, "B")
  })

  it("JSON string of a legacy context → legacy-context", () => {
    const r = normalizeIncomingError(JSON.stringify(FIXTURES.usageCap))
    assert.equal(r.source, "legacy-context")
    assert.equal(r.tier, "A")
  })

  it("non-JSON plain string → parsed-string tier C", () => {
    const r = normalizeIncomingError("Connection reset by peer")
    assert.equal(r.source, "parsed-string")
    assert.equal(r.tier, "C")
    assert.equal(r.context.userMessage, "Connection reset by peer")
  })

  it("invalid JSON starting with { → parsed-string (does not throw)", () => {
    const r = normalizeIncomingError("{not valid json")
    assert.equal(r.source, "parsed-string")
    assert.equal(r.tier, "C")
  })
})

// ---------- round-trip: the real host→wire→webview contract ----------

describe("host → wire → webview round-trip preserves tier", () => {
  const cases: Array<{ name: string; fixture: ErrorContext; expected: ErrorTier }> = [
    { name: "usage cap", fixture: FIXTURES.usageCap, expected: "A" },
    { name: "auth hard block", fixture: FIXTURES.authHard, expected: "A" },
    { name: "network transient", fixture: FIXTURES.networkTransient, expected: "B" },
    { name: "generation fault", fixture: FIXTURES.generationFault, expected: "C" },
    { name: "context overflow", fixture: FIXTURES.contextOverflow, expected: "C" },
  ]

  for (const { name, fixture, expected } of cases) {
    it(`${name}: ErrorContext → toWebviewErrorPayload → normalizeIncomingError → tier ${expected}`, () => {
      const payload = toWebviewErrorPayload(fixture)
      const wireForm = JSON.parse(JSON.stringify(payload)) as unknown // simulate postMessage serialization
      const result = normalizeIncomingError(wireForm)
      assert.equal(result.tier, expected, `tier mismatch for ${name}`)
      assert.equal(result.source, "typed-payload")
    })
  }
})
