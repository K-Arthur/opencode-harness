export class RenderQueue {
  private readonly renderCallback: (text: string) => void
  private buffer = ""
  private rafId: number | null = null
  private fallbackId: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private chunkCount = 0
  private flushCount = 0
  private totalBytesIn = 0
  static readonly MAX_BUFFER_SIZE = 1024 * 1024
  private static readonly FALLBACK_MS = 50

  constructor(renderCallback: (text: string) => void, private readonly onFlush?: () => void) {
    this.renderCallback = renderCallback
  }

  enqueue(text: string): void {
    if (this.destroyed) return
    this.buffer += text
    this.chunkCount++
    this.totalBytesIn += text.length

    if (this.buffer.length >= RenderQueue.MAX_BUFFER_SIZE) {
      this.cancelPending()
      this.flush()
      return
    }

    if (this.rafId === null && this.fallbackId === null) {
      this.scheduleFlush()
    }
  }

  forceFlush(): void {
    if (this.destroyed) return
    this.cancelPending()
    this.flush()
  }

  destroy(): void {
    this.destroyed = true
    this.cancelPending()
    this.buffer = ""
  }

  getStats(): { chunkCount: number; flushCount: number; totalBytesIn: number; pendingBytes: number } {
    return {
      chunkCount: this.chunkCount,
      flushCount: this.flushCount,
      totalBytesIn: this.totalBytesIn,
      pendingBytes: this.buffer.length,
    }
  }

  private scheduleFlush(): void {
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      if (this.fallbackId !== null) {
        clearTimeout(this.fallbackId)
        this.fallbackId = null
      }
      this.flush()
    })
    this.fallbackId = setTimeout(() => {
      this.fallbackId = null
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this.flush()
    }, RenderQueue.FALLBACK_MS)
  }

  private flush(): void {
    if (this.buffer.length === 0) return
    const text = this.buffer
    this.buffer = ""
    this.flushCount++
    this.renderCallback(text)
    this.onFlush?.()
  }

  private cancelPending(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.fallbackId !== null) {
      clearTimeout(this.fallbackId)
      this.fallbackId = null
    }
  }
}
