/** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
export class ChunkBatcher {
  private buffer = new Map<string, string>()
  private messageIds = new Map<string, string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly FLUSH_MS = 75
  private static readonly MAX_BATCH_SIZE = 10 * 1024 // 10KB max batch size per session
  private flushCount = 0
  private disposed = false
  /** O3: Sessions whose chunk flush is paused while a higher-priority message (e.g. stream_start) is retrying. */
  private pausedSessions = new Set<string>()

  constructor(
    private readonly delegate: (msg: Record<string, unknown>) => void,
    private readonly log?: (msg: string) => void,
  ) {}

  add(sessionId: string, text: string, messageId?: string): void {
    if (this.disposed) {
      return
    }
    const existing = this.buffer.get(sessionId) || ""
    
    // Check if adding this text would exceed max batch size
    if (existing.length + text.length > ChunkBatcher.MAX_BATCH_SIZE) {
      // Flush existing buffer for this session before adding new text
      const currentMessageId = this.messageIds.get(sessionId)
      try {
        this.delegate({ type: "stream_chunk", sessionId, text: existing, messageId: currentMessageId })
      } catch (err) {
        this.log?.(`[ChunkBatcher] delegate threw for ${sessionId} during size-limit flush: ${String(err)}`)
      }
      this.buffer.delete(sessionId)
      this.messageIds.delete(sessionId)
    }
    
    this.buffer.set(sessionId, existing + text)
    if (messageId) this.messageIds.set(sessionId, messageId)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), ChunkBatcher.FLUSH_MS)
    }
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
    const flushed: string[] = []
    for (const [sessionId, text] of this.buffer) {
      if (this.pausedSessions.has(sessionId)) continue
      const messageId = this.messageIds.get(sessionId)
      // First flush per session: log to confirm wiring; subsequent flushes are silent.
      if (this.flushCount <= 1) {
        this.log?.(`[ChunkBatcher] flush #${this.flushCount} sessionId=${sessionId} len=${text.length}`)
      }
      try {
        this.delegate({ type: "stream_chunk", sessionId, text, messageId })
      } catch (err) {
        this.log?.(`[ChunkBatcher] delegate threw for ${sessionId}, dropping chunk: ${String(err)}`)
      }
      flushed.push(sessionId)
    }
    for (const sid of flushed) {
      this.buffer.delete(sid)
      this.messageIds.delete(sid)
    }
  }

  clear(): void {
    this.buffer.clear()
    this.messageIds.clear()
    this.pausedSessions.clear()
  }

  dispose(): void {
    this.disposed = true
    try { this.flush() } catch { /* dispose must not throw */ }
    this.buffer.clear()
    this.messageIds.clear()
    this.pausedSessions.clear()
  }
}
