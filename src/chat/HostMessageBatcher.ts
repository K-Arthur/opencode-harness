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
  maxPayloadBytes?: number
  dedupWindow?: number
  now?: () => number
}

export type BatchableHostMessage = Record<string, unknown> & { type: string }
type StreamChunkMessage = Record<string, unknown> & { type: "stream_chunk"; sessionId: string; text: string; messageId?: string; seq?: number }
interface BufferedChunk {
  text: string
  messageId?: string
  seq?: number
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
  "prompt_accepted",
  "prompt_send_failed",
  "request_error",
  "webview_request_error",
  "prompt_rejected",
  "unknown_server_event",
  "rate_limit_exhausted",
  "compaction_started",
  "session_compacted",
  "clear_messages",
  "resume_session_data",
  "more_messages",
  "force_rerender",
  "command_list",
  "workspace_files",
])

function batchMessageReducer(existing: BatchableHostMessage[] | undefined, value: BatchableHostMessage): BatchableHostMessage[] {
  return [...(existing ?? []), value]
}

function chunkReducer(existing: BufferedChunk | undefined, value: StreamChunkMessage): BufferedChunk {
  return {
    text: `${existing?.text ?? ""}${value.text}`,
    messageId: value.messageId ?? existing?.messageId,
    seq: typeof value.seq === "number" ? value.seq : existing?.seq,
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
  private readonly maxPayloadBytes: number
  private readonly dedupWindow: number
  private readonly now: () => number
  private firstChunkBufferedAt = 0
  private charsInWindow = 0
  private windowStartedAt = 0
  private scheduledChunkFlushAt = 0
  private disposed = false
  private pausedSessions = new Set<string>()
  private dedupCount = 0
  private dedupFingerprint = ""

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
    this.maxPayloadBytes = options.maxPayloadBytes ?? 256 * 1024
    this.dedupWindow = options.dedupWindow ?? 16
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
      return this.dispatch(msg) !== false
    }

    // F8: per-payload size guard. A single batchable message bigger than
    // maxPayloadBytes is dropped with a warning — it would otherwise
    // dominate the webview's message queue and stall the UI.
    if (this.maxPayloadBytes > 0) {
      const size = payloadSize(msg)
      if (size > this.maxPayloadBytes) {
        this.log?.(
          `[HostMessageBatcher] dropped oversized payload type=${String(msg.type)} size=${size}B > maxPayloadBytes=${this.maxPayloadBytes}B`,
        )
        return false
      }
    }

    // F8: dedup identical consecutive batched payloads beyond dedupWindow.
    // Identical-fingerprint batching is rare in practice but a single bug
    // (e.g. an emitter that posts the same context_usage every tick) can
    // flood the queue; this guard limits the damage.
    const fp = stableFingerprint(msg)
    if (fp === this.dedupFingerprint) {
      this.dedupCount++
      if (this.dedupCount > this.dedupWindow) {
        // F8: dedup drops are normal operation during subagent-heavy streams.
        // Log the first drop, then every 100th, to avoid flooding the output channel.
        const logEvery = 100
        if (this.dedupCount === this.dedupWindow + 1 || this.dedupCount % logEvery === 0) {
          this.log?.(
            `[HostMessageBatcher] dropped duplicate type=${String(msg.type)} (window=${this.dedupWindow}, count=${this.dedupCount})`,
          )
        }
        return false
      }
    } else {
      this.dedupFingerprint = fp
      this.dedupCount = 1
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
    this.chunkQueue.flush()
    if (this.chunkQueue.size > 0) {
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
      const combined = chunkReducer(existing, msg)
      const result = this.dispatchChunk(msg.sessionId, combined)
      if (result === false) {
        this.chunkQueue.add(msg.sessionId, msg)
        this.log?.(`[HostMessageBatcher] size-limit chunk flush failed for ${msg.sessionId}; retaining chunk for retry`)
        this.scheduleChunkFlush(this.computeChunkFlushDelay(now))
        return
      }
      if (result && typeof (result as PromiseLike<boolean | void>).then === "function") {
        ;(result as PromiseLike<boolean | void>).then(
          (ok) => {
            if (ok === false) {
              this.chunkQueue.add(msg.sessionId, msg)
              this.scheduleChunkFlush(this.computeChunkFlushDelay(this.now()))
              return
            }
            if (Object.is(this.chunkQueue.get(msg.sessionId), existing)) {
              this.chunkQueue.delete(msg.sessionId)
            }
          },
          () => {
            this.chunkQueue.add(msg.sessionId, msg)
            this.scheduleChunkFlush(this.computeChunkFlushDelay(this.now()))
          },
        )
        return
      }
      if (Object.is(this.chunkQueue.get(msg.sessionId), existing)) {
        this.chunkQueue.delete(msg.sessionId)
      }
      return
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

  private dispatchChunk(sessionId: string, chunk: BufferedChunk): MaybeThenable<boolean | void> {
    return this.dispatch({
      type: "stream_chunk",
      sessionId,
      text: chunk.text,
      messageId: chunk.messageId,
      seq: chunk.seq,
    })
  }

  private dispatch(msg: Record<string, unknown>): MaybeThenable<boolean | void> {
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
      return result ?? true
    } catch (err) {
      this.log?.(`[HostMessageBatcher] delegate threw for ${String(msg.type)}: ${String(err)}`)
      return false
    }
  }
}

// ── F8 helpers ─────────────────────────────────────────────────────────────

function payloadSize(msg: Record<string, unknown>): number {
  try {
    return JSON.stringify(msg).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function stableFingerprint(msg: Record<string, unknown>): string {
  // Cheap fingerprint: type + JSON length. Enough to detect a runaway loop
  // emitting the same payload every tick (the dominant failure mode in
  // practice). NOT cryptographic; collision-acceptable for dedup.
  const len = payloadSize(msg)
  return `${String(msg.type)}\u0000${len}`
}
