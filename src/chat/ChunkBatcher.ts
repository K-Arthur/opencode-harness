/** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
export class ChunkBatcher {
  private buffer = new Map<string, string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly FLUSH_MS = 75
  private flushCount = 0

  constructor(
    private readonly delegate: (msg: Record<string, unknown>) => void,
    private readonly log?: (msg: string) => void,
  ) {}

  add(sessionId: string, text: string): void {
    const existing = this.buffer.get(sessionId) || ""
    this.buffer.set(sessionId, existing + text)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), ChunkBatcher.FLUSH_MS)
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.buffer.size === 0) return
    this.flushCount++
    for (const [sessionId, text] of this.buffer) {
      this.log?.(`[ChunkBatcher] flush #${this.flushCount} sessionId=${sessionId} len=${text.length} preview=${JSON.stringify(text.slice(0, 60))}`)
      this.delegate({ type: "stream_chunk", sessionId, text })
    }
    this.buffer.clear()
  }

  clear(): void {
    this.buffer.clear()
  }

  dispose(): void {
    this.flush()
    this.buffer.clear()
  }
}
