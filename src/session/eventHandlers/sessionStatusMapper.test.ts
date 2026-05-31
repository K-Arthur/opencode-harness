/**
 * Session Status Mapper Tests
 *
 * Tests the live, host-side session.status mapper (this module is what
 * SessionHandlers wires into the SSE pipeline). Grounded in the actual
 * OpenCode server event structure from logs:
 *   session.status props={"sessionID":"ses_...","status":{"type":"retry","attempt":1,
 *     "message":"Free usage exceeded, subscribe to Go",
 *     "action":{"reason":"free_tier_limit","provider":"opencode","title":"Subscribe to Go"}}}
 *
 * This is DIFFERENT from SDK errors handled by opencodeErrorMapper.ts. Session
 * status events come from the server via SSE and carry action.reason/action.provider
 * which are not present in SDK error objects.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ErrorCategory, ErrorSeverity } from "../../chat/webview/errorTypes"
import { extractSessionStatusError, mapSessionStatusError } from "./sessionStatusMapper"

describe("Session Status Mapper — based on actual server events", () => {
  describe("extract session status error from server event", () => {
    it("should extract retry status with free_tier_limit action from actual log structure", () => {
      const serverEvent = {
        sessionID: "ses_1dc032998ffe2gkCaKPyamSZq3",
        status: {
          type: "retry",
          attempt: 1,
          message: "Free usage exceeded, subscribe to Go",
          action: {
            reason: "free_tier_limit",
            provider: "opencode",
            title: "Subscribe to Go",
          },
        },
      }

      const error = extractSessionStatusError(serverEvent)

      assert.ok(error)
      assert.equal(error?.type, "retry")
      assert.equal(error?.message, "Free usage exceeded, subscribe to Go")
      assert.equal(error?.attempt, 1)
      assert.equal(error?.action?.reason, "free_tier_limit")
      assert.equal(error?.action?.provider, "opencode")
      assert.equal(error?.action?.title, "Subscribe to Go")
    })

    it("should extract error status with message", () => {
      const serverEvent = {
        sessionID: "ses_test",
        status: {
          type: "error",
          message: "Network connection failed",
        },
      }

      const error = extractSessionStatusError(serverEvent)

      assert.ok(error)
      assert.equal(error?.type, "error")
      assert.equal(error?.message, "Network connection failed")
    })

    it("should handle missing optional fields", () => {
      const serverEvent = {
        sessionID: "ses_test",
        status: {
          type: "retry",
        },
      }

      const error = extractSessionStatusError(serverEvent)

      assert.ok(error)
      assert.equal(error?.type, "retry")
      assert.equal(error?.message, undefined)
      assert.equal(error?.action, undefined)
    })

    it("should handle null/undefined input", () => {
      assert.equal(extractSessionStatusError(null), null)
      assert.equal(extractSessionStatusError(undefined), null)
    })

    it("should handle malformed input gracefully", () => {
      assert.equal(extractSessionStatusError("invalid"), null)
      assert.equal(extractSessionStatusError(123), null)
    })
  })

  describe("map session status error to user-friendly message", () => {
    it("should map free_tier_limit to usage limit exceeded with subscription action", () => {
      const error = {
        type: "retry",
        message: "Free usage exceeded, subscribe to Go",
        action: {
          reason: "free_tier_limit",
          provider: "opencode",
          title: "Subscribe to Go",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "FREE_TIER_LIMIT")
      assert.equal(userMessage.category, ErrorCategory.USAGE)
      assert.equal(userMessage.severity, ErrorSeverity.HIGH)
      assert.equal(userMessage.retryable, false)
      assert.match(userMessage.userMessage, /Free usage exceeded/)
      assert.match(userMessage.userMessage, /Subscribe to Go/)
      assert.ok(userMessage.suggestedActions.some(a => a.action === "upgrade_plan"))
    })

    it("should map rate_limit to rate limited message with wait action", () => {
      const error = {
        type: "retry",
        message: "Too many requests",
        action: {
          reason: "rate_limit",
          provider: "openai",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "RATE_LIMITED")
      assert.equal(userMessage.category, ErrorCategory.USAGE)
      assert.equal(userMessage.retryable, true)
      assert.match(userMessage.userMessage.toLowerCase(), /rate/)
      assert.ok(userMessage.suggestedActions.some(a => a.action === "wait_for_reset"))
    })

    it("should map auth_required to authentication required message", () => {
      const error = {
        type: "retry",
        message: "Authentication required",
        action: {
          reason: "auth_required",
          provider: "supabase",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "AUTH_REQUIRED")
      assert.equal(userMessage.category, ErrorCategory.AUTH)
      assert.equal(userMessage.severity, ErrorSeverity.HIGH)
      assert.equal(userMessage.retryable, false)
      assert.match(userMessage.userMessage.toLowerCase(), /auth/)
      assert.ok(userMessage.suggestedActions.some(a => a.action === "edit"))
    })

    it("should map model_unavailable to model unavailable message", () => {
      const error = {
        type: "retry",
        message: "Model not available",
        action: {
          reason: "model_unavailable",
          provider: "anthropic",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "MODEL_UNAVAILABLE")
      assert.equal(userMessage.category, ErrorCategory.MODEL)
      assert.equal(userMessage.retryable, true)
      assert.match(userMessage.userMessage, /model/)
      assert.ok(userMessage.suggestedActions.some(a => a.action === "switch_model"))
    })

    it("should map timeout to timeout message", () => {
      const error = {
        type: "error",
        message: "Request timeout",
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "TIMEOUT")
      assert.equal(userMessage.category, ErrorCategory.NETWORK)
      assert.equal(userMessage.retryable, true)
      assert.match(userMessage.userMessage, /timeout/)
    })

    it("should map network error to network error message", () => {
      const error = {
        type: "error",
        message: "Network connection failed",
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "NETWORK_ERROR")
      assert.equal(userMessage.category, ErrorCategory.NETWORK)
      assert.equal(userMessage.retryable, true)
      assert.match(userMessage.userMessage.toLowerCase(), /network/)
    })

    it("should map unknown status to generic error message", () => {
      const error = {
        type: "unknown_status",
        message: "Something went wrong",
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "UNKNOWN_STATUS")
      assert.equal(userMessage.category, ErrorCategory.SYSTEM)
      assert.match(userMessage.userMessage.toLowerCase(), /unknown/)
    })

    it("should preserve action.title in suggested actions when available", () => {
      const error = {
        type: "retry",
        message: "Free usage exceeded",
        action: {
          reason: "free_tier_limit",
          provider: "opencode",
          title: "Subscribe to Go",
          url: "https://opencode.ai/subscribe",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.ok(userMessage.suggestedActions.some(a => a.label === "Subscribe to Go"))
      assert.ok(userMessage.suggestedActions.some(a => a.metadata?.url === "https://opencode.ai/subscribe"))
    })

    it("should handle missing action fields gracefully", () => {
      const error = {
        type: "retry",
        message: "Some error",
        action: {
          reason: "unknown_reason",
        },
      }

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "RETRY_UNKNOWN_REASON")
      assert.equal(userMessage.category, ErrorCategory.SYSTEM)
      assert.ok(userMessage.suggestedActions.length > 0)
    })

    it("should handle empty error object", () => {
      const error = {}

      const userMessage = mapSessionStatusError(error)

      assert.equal(userMessage.code, "UNKNOWN_STATUS")
      assert.equal(userMessage.category, ErrorCategory.SYSTEM)
      assert.match(userMessage.userMessage.toLowerCase(), /unknown/)
    })

    it("exposes the raw server message as technicalDetails when it differs from userMessage", () => {
      const error = {
        type: "retry",
        message: "Free usage exceeded, subscribe to Go",
        action: { reason: "free_tier_limit", provider: "opencode", title: "Subscribe to Go" },
      }

      const ctx = mapSessionStatusError(error)

      // userMessage is augmented ("… Subscribe to Go to continue."), so the raw
      // server message is preserved behind progressive disclosure.
      assert.notEqual(ctx.userMessage, error.message)
      assert.equal(ctx.technicalDetails, "Free usage exceeded, subscribe to Go")
    })
  })
})
