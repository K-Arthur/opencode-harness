import { toUserErrorMessage as toUserErrorMessagePure, errorValueToMessage as errorValueToMessagePure } from "./chatUtils"
import { log } from "../utils/outputChannel"

export const CRITICAL_MESSAGE_TYPES = new Set([
  "stream_start", "stream_end", "stream_chunk", "stream_tool_start", "stream_tool_end",
  "stream_error", "streaming_state",
  "error", "webview_ready", "request_error",
])

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [100, 500, 1000]
const MAX_RETRY_QUEUE_SIZE = 50

export interface RetryQueueDeps {
  postRawMessage: (msg: Record<string, unknown>) => boolean | Thenable<boolean> | undefined
  resumeSession: (sessionId: string) => void
  pauseSession: (sessionId: string) => void
}

export class RetryQueueService {
  private retryQueue: Array<{ msg: Record<string, unknown>; attempts: number; lastAttempt: number }> = []
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private postMessageRejectedConsecutive = 0
  private postMessageRejectedTotal = 0
  private lastBackpressureLogAt = 0

  constructor(private deps: RetryQueueDeps) {}

  recordPostMessageRejected(msg: Record<string, unknown>): void {
    this.postMessageRejectedConsecutive++
    this.postMessageRejectedTotal++
    const now = Date.now()
    if (now - this.lastBackpressureLogAt > 1000) {
      this.lastBackpressureLogAt = now
      log.warn(
        `Webview postMessage refused ${this.postMessageRejectedConsecutive} message(s) (total ${this.postMessageRejectedTotal}); latest type=${String(msg.type)}`,
      )
    }
    if (CRITICAL_MESSAGE_TYPES.has(msg.type as string)) {
      const sid = typeof msg.sessionId === "string" ? msg.sessionId : undefined
      if (sid && (msg.type === "stream_start" || msg.type === "stream_tool_start")) {
        this.deps.pauseSession(sid)
      }
      this.scheduleRetry(msg)
    }
  }

  scheduleRetry(msg: Record<string, unknown>): void {
    if (this.retryQueue.length >= MAX_RETRY_QUEUE_SIZE) {
      const oldestNonCriticalIdx = this.retryQueue.findIndex(
        (item) => !CRITICAL_MESSAGE_TYPES.has(item.msg.type as string),
      )
      if (oldestNonCriticalIdx >= 0) {
        this.retryQueue.splice(oldestNonCriticalIdx, 1)
        log.warn(`Retry queue at capacity (${MAX_RETRY_QUEUE_SIZE}), dropped oldest non-critical retry`)
      } else {
        log.warn(
          `Retry queue at capacity with all critical messages — dropping oldest to enqueue ${String(msg.type)}`,
        )
        this.retryQueue.shift()
      }
    }
    const retryItem = { msg, attempts: 0, lastAttempt: Date.now() }
    this.retryQueue.push(retryItem)
    this.processRetryQueue()
  }

  processRetryQueue(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }

    while (this.retryQueue.length > 0) {
      const now = Date.now()
      const nextRetry = this.retryQueue.find((item) => {
        const delayIndex = Math.min(item.attempts, RETRY_DELAYS_MS.length - 1)
        const delayMs = RETRY_DELAYS_MS[delayIndex] ?? 1000
        return now - item.lastAttempt >= delayMs
      })

      if (!nextRetry) {
        const firstItem = this.retryQueue[0]
        if (firstItem) {
          const delayIndex = Math.min(firstItem.attempts, RETRY_DELAYS_MS.length - 1)
          const delayMs = RETRY_DELAYS_MS[delayIndex] ?? 1000
          const timeUntilNext = delayMs - (now - firstItem.lastAttempt)
          this.retryTimer = setTimeout(() => this.processRetryQueue(), timeUntilNext)
        }
        return
      }

      const postResult = this.deps.postRawMessage(nextRetry.msg)

      if (postResult === undefined) {
        log.warn(`Retry skipped — webview disposed; type=${String(nextRetry.msg.type)}`)
        nextRetry.attempts++
        nextRetry.lastAttempt = Date.now()
        if (nextRetry.attempts >= MAX_RETRIES) {
          log.error(`Max retries exceeded (no view) for message type: ${nextRetry.msg.type}`)
          const index = this.retryQueue.indexOf(nextRetry)
          if (index > -1) this.retryQueue.splice(index, 1)
        }
        const firstItem = this.retryQueue[0]
        if (firstItem) {
          const delayIndex = Math.min(firstItem.attempts, RETRY_DELAYS_MS.length - 1)
          const delayMs = RETRY_DELAYS_MS[delayIndex] ?? 1000
          this.retryTimer = setTimeout(() => this.processRetryQueue(), delayMs)
        }
        return
      }

      try {
        const index = this.retryQueue.indexOf(nextRetry)
        if (index > -1) {
          this.retryQueue.splice(index, 1)
        }
        const sid = typeof nextRetry.msg.sessionId === "string" ? nextRetry.msg.sessionId : undefined
        if (sid && (nextRetry.msg.type === "stream_start" || nextRetry.msg.type === "stream_tool_start")) {
          this.deps.resumeSession(sid)
        }
        log.info(`Successfully retried message of type: ${nextRetry.msg.type}`)
      } catch (err) {
        log.warn(
          `Retry post failed for ${String(nextRetry.msg.type)}: ${err instanceof Error ? err.message : String(err)}`,
        )
        nextRetry.attempts++
        nextRetry.lastAttempt = Date.now()
        if (nextRetry.attempts >= MAX_RETRIES) {
          log.error(`Max retries exceeded for message type: ${nextRetry.msg.type}`)
          const index = this.retryQueue.indexOf(nextRetry)
          if (index > -1) {
            this.retryQueue.splice(index, 1)
          }
          const sid = typeof nextRetry.msg.sessionId === "string" ? nextRetry.msg.sessionId : undefined
          if (sid && (nextRetry.msg.type === "stream_start" || nextRetry.msg.type === "stream_tool_start")) {
            this.deps.resumeSession(sid)
          }
        }
      }
    }
  }

  toUserErrorMessage(message: string): string {
    return toUserErrorMessagePure(message)
  }

  errorValueToMessage(value: unknown): string {
    return errorValueToMessagePure(value)
  }

  clear(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.retryQueue = []
  }

  dispose(): void {
    this.clear()
  }
}
