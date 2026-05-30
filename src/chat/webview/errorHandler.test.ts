import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ErrorHandler } from "./errorHandler"
import { ErrorCategory, ErrorSeverity, RetryStrategyType } from "./errorTypes"

describe("ErrorHandler", () => {
  describe("classifyError", () => {
    it("classifies network errors by message", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(new Error("network timeout"))
      assert.equal(ctx.category, ErrorCategory.NETWORK)
    })

    it("classifies rate limit errors by message", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(new Error("rate limit exceeded"))
      assert.equal(ctx.category, ErrorCategory.USAGE)
    })

    it("classifies auth errors by message", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(new Error("unauthorized access"))
      assert.equal(ctx.category, ErrorCategory.AUTH)
    })

    it("classifies context errors by message", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(new Error("context length exceeded"))
      assert.equal(ctx.category, ErrorCategory.CONTEXT)
    })

    it("falls back to SYSTEM for unknown errors", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(new Error("something weird happened"))
      assert.equal(ctx.category, ErrorCategory.SYSTEM)
    })

    it("handles string errors", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError("rate limit quota exceeded")
      assert.equal(ctx.category, ErrorCategory.USAGE)
    })

    it("handles null/undefined errors gracefully", () => {
      const handler = new ErrorHandler()
      const ctx = handler.classifyError(null)
      assert.equal(ctx.category, ErrorCategory.SYSTEM)
      assert.equal(ctx.code, "UNKNOWN_ERROR")
    })
  })

  describe("handleError", () => {
    it("routes through opencode mapper when error has name/statusCode", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError({ name: "APIError", statusCode: 429, message: "Too Many Requests" })
      assert.equal(ctx.code, "RATE_LIMITED")
      assert.equal(ctx.category, ErrorCategory.USAGE)
    })

    it("falls back to classifyError for plain Error objects", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError(new Error("connection refused"))
      assert.equal(ctx.category, ErrorCategory.NETWORK)
    })

    it("attaches session/message IDs from options", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError(new Error("test"), { sessionId: "sess_1", messageId: "msg_1" })
      assert.equal((ctx as { sessionId?: string }).sessionId, "sess_1")
      assert.equal((ctx as { messageId?: string }).messageId, "msg_1")
    })

    it("suppresses default actions when requested", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError(new Error("test"), { suppressDefaultActions: true })
      assert.deepEqual(ctx.suggestedActions, [])
    })
  })

  describe("retryWithBackoff", () => {
    it("succeeds on first attempt", async () => {
      const handler = new ErrorHandler()
      const operation = async () => "success"
      const result = await handler.retryWithBackoff(operation, {
        type: RetryStrategyType.EXPONENTIAL_BACKOFF,
        maxAttempts: 3,
      })
      assert.equal(result.success, true)
      assert.equal(result.attempts, 1)
      assert.equal(result.result, "success")
    })

    it("retries on failure up to maxAttempts", async () => {
      const handler = new ErrorHandler()
      let attempts = 0
      const operation = async () => {
        attempts++
        throw new Error(`fail ${attempts}`)
      }
      const result = await handler.retryWithBackoff(operation, {
        type: RetryStrategyType.EXPONENTIAL_BACKOFF,
        maxAttempts: 4,
        delayMs: 5,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      })
      assert.equal(result.success, false)
      assert.equal(result.attempts, 4)
    })

    it("does not exceed maxDelayMs with jitter enabled", async () => {
      const handler = new ErrorHandler()
      let lastDelay = 0
      ;(handler as any).delay = (ms: number) => {
        lastDelay = ms
        return Promise.resolve()
      }

      await handler.retryWithBackoff(
        () => { throw new Error("fail") },
        {
          type: RetryStrategyType.EXPONENTIAL_BACKOFF,
          maxAttempts: 5,
          delayMs: 1000,
          maxDelayMs: 8000,
          backoffMultiplier: 2,
          jitter: true,
        }
      )
      assert.ok(lastDelay <= 8000, `expected delay <= 8000, got ${lastDelay}`)
    })

    it("skips retry when strategy is NONE", async () => {
      const handler = new ErrorHandler()
      const operation = async () => { throw new Error("no retry") }
      const result = await handler.retryWithBackoff(operation, {
        type: RetryStrategyType.NONE,
      })
      assert.equal(result.success, false)
      assert.equal(result.attempts, 1)
    })

    it("does not retry when enableRetry is false", async () => {
      const handler = new ErrorHandler({ enableRetry: false })
      const operation = async () => { throw new Error("retry disabled") }
      const result = await handler.retryWithBackoff(operation, {
        type: RetryStrategyType.EXPONENTIAL_BACKOFF,
        maxAttempts: 5,
      })
      assert.equal(result.success, false)
      assert.equal(result.attempts, 1)
    })
  })

  describe("generateCorrelationId", () => {
    it("generates unique IDs under rapid succession", () => {
      const handler = new ErrorHandler()
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add((handler as any).generateCorrelationId())
      }
      assert.equal(ids.size, 1000)
    })
  })

  describe("error history", () => {
    it("tracks errors in history", () => {
      const handler = new ErrorHandler()
      handler.handleError(new Error("test1"))
      handler.handleError(new Error("test2"))
      assert.equal(handler.getErrorHistory().length, 2)
    })

    it("supports marking error as handled", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError(new Error("test"))
      handler.markErrorHandled(ctx.correlationId!, true)
      const history = handler.getErrorHistory()
      assert.equal(history[0]?.handled, true)
    })

    it("supports marking recovery attempt", () => {
      const handler = new ErrorHandler()
      const ctx = handler.handleError(new Error("test"))
      handler.markRecoveryAttempt(ctx.correlationId!, true)
      const history = handler.getErrorHistory()
      assert.equal(history[0]?.recoveryAttempted, true)
      assert.equal(history[0]?.recoverySuccessful, true)
    })

    it("limits history size", () => {
      const handler = new ErrorHandler({ maxHistorySize: 5 })
      for (let i = 0; i < 10; i++) {
        handler.handleError(new Error(`test ${i}`))
      }
      assert.equal(handler.getErrorHistory().length, 5)
    })
  })

  describe("getErrorStats", () => {
    it("returns correct statistics", () => {
      const handler = new ErrorHandler()
      handler.handleError(new Error("network timeout"))
      handler.handleError(new Error("rate limit"))
      handler.handleError(new Error("auth failure"))

      const stats = handler.getErrorStats()
      assert.equal(stats.totalErrors, 3)
      assert.equal(stats.byCategory[ErrorCategory.NETWORK], 1)
      assert.equal(stats.byCategory[ErrorCategory.USAGE], 1)
      assert.equal(stats.byCategory[ErrorCategory.AUTH], 1)
    })
  })

  describe("configuration", () => {
    it("allows runtime config updates", () => {
      const handler = new ErrorHandler()
      handler.updateConfig({ enableLogging: false, maxRetryAttempts: 5 })
      const config = handler.getConfig()
      assert.equal(config.enableLogging, false)
      assert.equal(config.maxRetryAttempts, 5)
    })

    it("clears retry registry when maxRetryAttempts changes", () => {
      const handler = new ErrorHandler()
      ;(handler as any).retryRegistry.set("TEST", 3)
      handler.updateConfig({ maxRetryAttempts: 5 })
      assert.equal((handler as any).retryRegistry.size, 0)
    })
  })
})
