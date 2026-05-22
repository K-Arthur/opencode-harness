type MaybeThenable<T> = T | PromiseLike<T>

export interface ChunkBatcherOptions {
  minFlushMs?: number
  baseFlushMs?: number
  maxFlushMs?: number
  lowVelocityCharsPerMs?: number
  highVelocityCharsPerMs?: number
  maxBatchSize?: number
  now?: () => number
}

/** R2: Chunk batching — buffers text_chunks and adapts flush timing to stream velocity. */
export class ChunkBatcher {
  private buffer = new Map<string, string>()
  private messageIds = new Map<string, string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly DEFAULT_FLUSH_MS = 75
  private static readonly DEFAULT_MAX_BATCH_SIZE = 10 * 1024 // 10KB max batch size per session
  private readonly minFlushMs: number
  private readonly baseFlushMs: number
  private readonly maxFlushMs: number
  private readonly lowVelocityCharsPerMs: number
  private readonly highVelocityCharsPerMs: number
  private readonly maxBatchSize: number
  private readonly now: () => number
  private firstBufferedAt = 0
  private lastAddAt = 0
  private charsInWindow = 0
  private windowStartedAt = 0
  private scheduledFlushAt = 0
  private flushCount = 0
  private disposed = false
  /** O3: Sessions whose chunk flush is paused while a higher-priority message (e.g. stream_start) is retrying. */
  private pausedSessions = new Set<string>()

  constructor(
    private readonly delegate: (msg: Record<string, unknown>) => MaybeThenable<boolean | void>,
    private readonly log?: (msg: string) => void,
    options: ChunkBatcherOptions = {},
  ) {
    this.minFlushMs = options.minFlushMs ?? 35
    this.baseFlushMs = options.baseFlushMs ?? ChunkBatcher.DEFAULT_FLUSH_MS
    this.maxFlushMs = options.maxFlushMs ?? 150
    this.lowVelocityCharsPerMs = options.lowVelocityCharsPerMs ?? 0.08
    this.highVelocityCharsPerMs = options.highVelocityCharsPerMs ?? 2
    this.maxBatchSize = options.maxBatchSize ?? ChunkBatcher.DEFAULT_MAX_BATCH_SIZE
    this.now = options.now ?? (() => Date.now())
  }

  add(sessionId: string, text: string, messageId?: string): void {
    if (this.disposed) {
      return
    }
    const now = this.now()
    this.recordVelocity(text.length, now)
    let existing = this.buffer.get(sessionId) || ""
    
    // Check if adding this text would exceed max batch size
    if (existing.length > 0 && existing.length + text.length > this.maxBatchSize) {
      // Flush existing buffer for this session before adding new text
      const ok = this.flushSession(sessionId, existing, this.messageIds.get(sessionId))
      if (!ok) {
        this.log?.(`[ChunkBatcher] size-limit flush failed for ${sessionId}; retaining chunk for retry`)
        this.scheduleFlush(this.computeFlushDelay(now))
        return
      }
      this.buffer.delete(sessionId)
      this.messageIds.delete(sessionId)
      existing = ""
    }
    
    this.buffer.set(sessionId, existing + text)
    if (messageId) this.messageIds.set(sessionId, messageId)
    if (!this.firstBufferedAt) this.firstBufferedAt = now
    this.scheduleFlush(this.computeFlushDelay(now))
  }

  /** O3: Pause flushing for a sessionId until resumeSession is called. Buffered chunks remain in memory. */
  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId)
  }

  /** O3: Resume flushing for a sessionId and immediately flush any buffered chunks for it. */
  resumeSession(sessionId: string): void {
    if (!this.pausedSessions.delete(sessionId)) return
    const text = this.buffer.get(sessionId)
    if (text === undefined) return
    const messageId = this.messageIds.get(sessionId)
    this.buffer.delete(sessionId)
    this.messageIds.delete(sessionId)
    try {
      this.delegate({ type: "stream_chunk", sessionId, text, messageId })
    } catch (err) {
      this.log?.(`[ChunkBatcher] resume delegate failed for ${sessionId}: ${String(err)}`)
    }
  }

  /**
   * O2: Per-entry try/catch — one failing delegate must not strand other sessions' chunks
   * or leave the buffer in a half-cleared state. Skips paused sessions.
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.buffer.size === 0) return
    this.flushCount++
    const succeeded: string[] = []
    for (const [sessionId, text] of this.buffer) {
      if (this.pausedSessions.has(sessionId)) continue
      const messageId = this.messageIds.get(sessionId)
      if (this.flushCount <= 1) {
        this.log?.(`[ChunkBatcher] flush #${this.flushCount} sessionId=${sessionId} len=${text.length}`)
      }
      if (this.flushSession(sessionId, text, messageId)) {
        succeeded.push(sessionId)
      }
    }
    for (const sid of succeeded) {
      this.buffer.delete(sid)
      this.messageIds.delete(sid)
    }
    if (this.buffer.size === 0) {
      this.firstBufferedAt = 0
    } else {
      this.scheduleFlush(this.baseFlushMs)
    }
  }

  clear(): void {
    this.buffer.clear()
    this.messageIds.clear()
    this.pausedSessions.clear()
    this.firstBufferedAt = 0
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  dispose(): void {
    this.disposed = true
    try { this.flush() } catch { /* dispose must not throw */ }
    this.buffer.clear()
    this.messageIds.clear()
    this.pausedSessions.clear()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private recordVelocity(chars: number, now: number): void {
    if (!this.windowStartedAt || now - this.windowStartedAt > 1000) {
      this.windowStartedAt = now
      this.charsInWindow = 0
    }
    this.charsInWindow += Math.max(0, chars)
    this.lastAddAt = now
  }

  private computeFlushDelay(now: number): number {
    const windowMs = Math.max(1, now - this.windowStartedAt)
    const velocity = this.charsInWindow / windowMs
    let desired = this.baseFlushMs
    if (velocity <= this.lowVelocityCharsPerMs) {
      desired = this.minFlushMs
    } else if (velocity >= this.highVelocityCharsPerMs) {
      desired = this.maxFlushMs
    } else {
      const ratio = (velocity - this.lowVelocityCharsPerMs) / (this.highVelocityCharsPerMs - this.lowVelocityCharsPerMs)
      desired = this.minFlushMs + ratio * (this.maxFlushMs - this.minFlushMs)
    }

    if (this.firstBufferedAt) {
      const age = now - this.firstBufferedAt
      desired = Math.min(desired, Math.max(0, this.maxFlushMs - age))
    }
    return Math.max(this.minFlushMs, Math.min(this.maxFlushMs, Math.round(desired)))
  }

  private scheduleFlush(delayMs: number): void {
    if (this.disposed || this.buffer.size === 0) return
    const dueAt = this.now() + delayMs
    if (this.flushTimer && this.scheduledFlushAt <= dueAt) return
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.scheduledFlushAt = dueAt
    this.flushTimer = setTimeout(() => this.flush(), delayMs)
  }

  private flushSession(sessionId: string, text: string, messageId?: string): boolean {
    try {
      const result = this.delegate({ type: "stream_chunk", sessionId, text, messageId })
      if (result === false) return false
      if (result && typeof (result as PromiseLike<boolean | void>).then === "function") {
        ;(result as PromiseLike<boolean | void>).then((ok) => {
          if (ok === false) this.log?.(`[ChunkBatcher] delegate returned false for ${sessionId}`)
        }, (err) => {
          this.log?.(`[ChunkBatcher] delegate rejected for ${sessionId}: ${String(err)}`)
        })
      }
      return true
    } catch (err) {
      this.log?.(`[ChunkBatcher] delegate threw for ${sessionId}, retaining chunk for retry: ${String(err)}`)
      return false
    }
  }
}
