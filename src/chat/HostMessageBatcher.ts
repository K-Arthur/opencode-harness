import { BatchEngine } from "./BatchEngine"

type MaybeThenable<T> = T | PromiseLike<T>

export interface HostMessageBatcherOptions {
  flushMs?: number
  maxBatchSize?: number
  minChunkFlushMs?: number
  baseChunkFlushMs?: number
  maxChunkFlushMs?: number
  lowVelocityCharsPerMs?: number
  highVelocityCharsPerMs?: number
  maxChunkBatchSize?: number
  now?: () => number
}

export type BatchableHostMessage = Record<string, unknown> & { type: string }
type StreamChunkMessage = Record<string, unknown> & { type: "stream_chunk"; sessionId: string; text: string; messageId?: string }
interface BufferedChunk {
  text: string
  messageId?: string
}

const IMMEDIATE_TYPES = new Set([
  "init_state",
  "session_deleted",
  "session_renamed",
  "active_session_changed",
  "stream_start",
  "stream_end",
  "stream_ping",
  "stream_ack",
  "stream_tool_start",
  "stream_tool_end",
  "stream_tool_unresolved",
  "streaming_state",
  "permission_request",
  "request_error",
  "webview_request_error",
  "prompt_rejected",
  "rate_limit_exhausted",
  "compaction_started",
  "session_compacted",
  "clear_messages",
  "resume_session_data",
  "more_messages",
  "force_rerender",
])

function batchMessageReducer(existing: BatchableHostMessage[] | undefined, value: BatchableHostMessage): BatchableHostMessage[] {
  return [...(existing ?? []), value]
}

function chunkReducer(existing: BufferedChunk | undefined, value: StreamChunkMessage): BufferedChunk {
  return {
    text: `${existing?.text ?? ""}${value.text}`,
    messageId: value.messageId ?? existing?.messageId,
  }
}

export class HostMessageBatcher {
  private engine: BatchEngine<string, BatchableHostMessage[], BatchableHostMessage>
  private chunkQueue: BatchEngine<string, BufferedChunk, StreamChunkMessage>
  private chunkFlushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly minChunkFlushMs: number
  private readonly baseChunkFlushMs: number
  private readonly maxChunkFlushMs: number
  private readonly lowVelocityCharsPerMs: number
  private readonly highVelocityCharsPerMs: number
  private readonly maxChunkBatchSize: number
  private readonly now: () => number
  private firstChunkBufferedAt = 0
  private charsInWindow = 0
  private windowStartedAt = 0
  private scheduledChunkFlushAt = 0
  private disposed = false
  private pausedSessions = new Set<string>()

  constructor(
    private readonly delegate: (msg: Record<string, unknown>) => MaybeThenable<boolean | void>,
    private readonly log?: (msg: string) => void,
    options: HostMessageBatcherOptions = {},
  ) {
    this.minChunkFlushMs = options.minChunkFlushMs ?? 35
    this.baseChunkFlushMs = options.baseChunkFlushMs ?? 75
    this.maxChunkFlushMs = options.maxChunkFlushMs ?? 150
    this.lowVelocityCharsPerMs = options.lowVelocityCharsPerMs ?? 0.08
    this.highVelocityCharsPerMs = options.highVelocityCharsPerMs ?? 2
    this.maxChunkBatchSize = options.maxChunkBatchSize ?? 10 * 1024
    this.now = options.now ?? (() => Date.now())

    this.engine = new BatchEngine(
      batchMessageReducer,
      (_key, messages) => this.delegate({ type: "host_message_batch", messages }),
      log,
      { flushMs: options.flushMs ?? 16, maxBatchSize: options.maxBatchSize ?? 25 },
    )
    this.chunkQueue = new BatchEngine(
      chunkReducer,
      (sessionId, chunk) => this.dispatchChunk(sessionId, chunk),
      log,
      {
        flushMs: 0,
        maxBatchSize: Number.MAX_SAFE_INTEGER,
        skipKey: (sessionId) => this.pausedSessions.has(sessionId),
      },
    )
  }

  static isBatchable(msg: Record<string, unknown>): msg is BatchableHostMessage {
    const type = typeof msg.type === "string" ? msg.type : ""
    return Boolean(type && !IMMEDIATE_TYPES.has(type))
  }

  post(msg: Record<string, unknown>): boolean {
    if (this.disposed) return false

    if (this.isStreamChunk(msg)) {
      this.postChunk(msg)
      return true
    }

    if (msg.type === "stream_end") {
      this.flushChunks()
    }

    if (!HostMessageBatcher.isBatchable(msg)) {
      return this.dispatch(msg)
    }

    this.engine.add("main", msg)
    return true
  }

  flush(): void {
    this.flushChunks()
    this.engine.flush()
  }

  clear(): void {
    this.engine.clear()
    this.chunkQueue.clear()
    this.pausedSessions.clear()
    this.firstChunkBufferedAt = 0
    this.charsInWindow = 0
    this.windowStartedAt = 0
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer)
      this.chunkFlushTimer = null
    }
    this.scheduledChunkFlushAt = 0
  }

  dispose(): void {
    this.disposed = true
    try { this.flush() } catch { /* dispose must not throw */ }
    this.engine.dispose()
    this.chunkQueue.dispose()
    this.clear()
  }

  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId)
  }

  resumeSession(sessionId: string): void {
    if (!this.pausedSessions.delete(sessionId)) return
    const chunk = this.chunkQueue.get(sessionId)
    if (!chunk) return
    if (this.dispatchChunk(sessionId, chunk)) {
      this.chunkQueue.delete(sessionId)
    } else {
      this.scheduleChunkFlush(this.baseChunkFlushMs)
    }
  }

  private isStreamChunk(msg: Record<string, unknown>): msg is StreamChunkMessage {
    return msg.type === "stream_chunk" && typeof msg.sessionId === "string" && typeof msg.text === "string"
  }

  private postChunk(msg: StreamChunkMessage): void {
    const now = this.now()
    this.recordVelocity(msg.text.length, now)

    const existing = this.chunkQueue.get(msg.sessionId)
    if (existing && existing.text.length + msg.text.length > this.maxChunkBatchSize) {
      if (!this.dispatchChunk(msg.sessionId, existing)) {
        this.log?.(`[HostMessageBatcher] size-limit chunk flush failed for ${msg.sessionId}; retaining chunk for retry`)
        this.scheduleChunkFlush(this.computeChunkFlushDelay(now))
        return
      }
      this.chunkQueue.delete(msg.sessionId)
    }

    this.chunkQueue.add(msg.sessionId, msg)
    if (!this.firstChunkBufferedAt) this.firstChunkBufferedAt = now
    this.scheduleChunkFlush(this.computeChunkFlushDelay(now))
  }

  private flushChunks(): void {
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer)
      this.chunkFlushTimer = null
    }
    if (this.chunkQueue.size === 0) return
    this.chunkQueue.flush()
    if (this.chunkQueue.size === 0) {
      this.firstChunkBufferedAt = 0
    } else {
      this.scheduleChunkFlush(this.baseChunkFlushMs)
    }
  }

  private recordVelocity(chars: number, now: number): void {
    if (!this.windowStartedAt || now - this.windowStartedAt > 1000) {
      this.windowStartedAt = now
      this.charsInWindow = 0
    }
    this.charsInWindow += Math.max(0, chars)
  }

  private computeChunkFlushDelay(now: number): number {
    const windowMs = Math.max(1, now - this.windowStartedAt)
    const velocity = this.charsInWindow / windowMs
    let desired = this.baseChunkFlushMs
    if (velocity <= this.lowVelocityCharsPerMs) {
      desired = this.minChunkFlushMs
    } else if (velocity >= this.highVelocityCharsPerMs) {
      desired = this.maxChunkFlushMs
    } else {
      const ratio = (velocity - this.lowVelocityCharsPerMs) / (this.highVelocityCharsPerMs - this.lowVelocityCharsPerMs)
      desired = this.minChunkFlushMs + ratio * (this.maxChunkFlushMs - this.minChunkFlushMs)
    }

    if (this.firstChunkBufferedAt) {
      const age = now - this.firstChunkBufferedAt
      desired = Math.min(desired, Math.max(0, this.maxChunkFlushMs - age))
    }
    return Math.max(this.minChunkFlushMs, Math.min(this.maxChunkFlushMs, Math.round(desired)))
  }

  private scheduleChunkFlush(delayMs: number): void {
    if (this.disposed || this.chunkQueue.size === 0) return
    const dueAt = this.now() + delayMs
    if (this.chunkFlushTimer && this.scheduledChunkFlushAt <= dueAt) return
    if (this.chunkFlushTimer) clearTimeout(this.chunkFlushTimer)
    this.scheduledChunkFlushAt = dueAt
    this.chunkFlushTimer = setTimeout(() => this.flushChunks(), delayMs)
  }

  private dispatchChunk(sessionId: string, chunk: BufferedChunk): boolean {
    return this.dispatch({
      type: "stream_chunk",
      sessionId,
      text: chunk.text,
      messageId: chunk.messageId,
    })
  }

  private dispatch(msg: Record<string, unknown>): boolean {
    try {
      const result = this.delegate(msg)
      if (result === false) return false
      if (result && typeof (result as PromiseLike<boolean | void>).then === "function") {
        ;(result as PromiseLike<boolean | void>).then((ok) => {
          if (ok === false) this.log?.(`[HostMessageBatcher] delegate returned false for ${String(msg.type)}`)
        }, (err) => {
          this.log?.(`[HostMessageBatcher] delegate rejected for ${String(msg.type)}: ${String(err)}`)
        })
      }
      return true
    } catch (err) {
      this.log?.(`[HostMessageBatcher] delegate threw for ${String(msg.type)}: ${String(err)}`)
      return false
    }
  }
}
