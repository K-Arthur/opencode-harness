import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  categorizeQuestionReplyError,
  isQuestionExpired,
  STALENESS_WARNING_MS,
  type QuestionExpiryContext,
} from "./QuestionExpiryDetector"

describe("QuestionExpiryDetector", () => {
  describe("categorizeQuestionReplyError", () => {
    it("categorizes 'Question request not found' as expired", () => {
      const err = new Error('Question reply failed: "Question request not found"')
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "expired")
      assert.equal(result.userFacingMessage, "This question has expired on the server. The model can continue without your answer.")
      assert.equal(result.retryable, false)
    })

    it("categorizes 'not found' with requestID context as expired", () => {
      const err = new Error('Question reply failed: {"error":"request not found","requestID":"que_abc123"}')
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "expired")
      assert.equal(result.retryable, false)
    })

    it("categorizes 'unknown request' as expired", () => {
      const err = new Error('Question reply failed: "unknown request"')
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "expired")
    })

    it("categorizes network errors as transient", () => {
      const err = new Error("fetch failed: ECONNREFUSED")
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "transient")
      assert.equal(result.retryable, true)
      assert.ok(result.userFacingMessage.includes("retry"))
    })

    it("categorizes timeout errors as transient", () => {
      const err = new Error("request timeout after 30000ms")
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "transient")
      assert.equal(result.retryable, true)
    })

    it("categorizes 4xx server errors as server_rejected", () => {
      const err = new Error("Question reject failed: 400 Bad Request")
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "server_rejected")
      assert.equal(result.retryable, false)
    })

    it("categorizes 5xx server errors as transient", () => {
      const err = new Error("Question reply failed: 500 Internal Server Error")
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "transient")
      assert.equal(result.retryable, true)
    })

    it("categorizes unknown errors as unknown", () => {
      const err = new Error("something weird happened")
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "unknown")
      assert.equal(result.retryable, false)
    })

    it("handles null/undefined errors gracefully", () => {
      const result1 = categorizeQuestionReplyError(null)
      assert.equal(result1.category, "unknown")
      const result2 = categorizeQuestionReplyError(undefined)
      assert.equal(result2.category, "unknown")
    })

    it("handles string errors", () => {
      const result = categorizeQuestionReplyError("Question request not found")
      assert.equal(result.category, "expired")
    })

    it("handles error objects with nested JSON error field", () => {
      const err = new Error('Question reply failed: {"code":"NOT_FOUND","message":"Question request not found"}')
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "expired")
    })

    it("categorizes Effect-style Question.NotFoundError as expired", () => {
      const err = new Error('Question reply failed: {"_tag":"Question.NotFoundError","requestID":"que_abc123"}')
      const result = categorizeQuestionReplyError(err)
      assert.equal(result.category, "expired")
      assert.equal(result.retryable, false)
      assert.ok(result.userFacingMessage.includes("expired"))
    })
  })

  describe("isQuestionExpired", () => {
    it("returns false for a recently created question", () => {
      const ctx: QuestionExpiryContext = {
        createdAt: Date.now() - 1000, // 1 second ago
        answered: false,
      }
      assert.equal(isQuestionExpired(ctx), false)
    })

    it("returns true when question exceeds staleness warning threshold", () => {
      const ctx: QuestionExpiryContext = {
        createdAt: Date.now() - STALENESS_WARNING_MS - 1000,
        answered: false,
      }
      assert.equal(isQuestionExpired(ctx), true)
    })

    it("returns false for answered questions regardless of age", () => {
      const ctx: QuestionExpiryContext = {
        createdAt: Date.now() - STALENESS_WARNING_MS * 3,
        answered: true,
      }
      assert.equal(isQuestionExpired(ctx), false)
    })

    it("returns false when createdAt is 0 (unknown age)", () => {
      const ctx: QuestionExpiryContext = {
        createdAt: 0,
        answered: false,
      }
      assert.equal(isQuestionExpired(ctx), false)
    })

    it("uses custom threshold when provided", () => {
      const ctx: QuestionExpiryContext = {
        createdAt: Date.now() - 60_000, // 1 minute ago
        answered: false,
      }
      assert.equal(isQuestionExpired(ctx, 30_000), true) // 30s threshold
      assert.equal(isQuestionExpired(ctx, 120_000), false) // 2min threshold
    })
  })

  describe("STALENESS_WARNING_MS", () => {
    it("is 5 minutes", () => {
      assert.equal(STALENESS_WARNING_MS, 5 * 60 * 1000)
    })
  })
})
