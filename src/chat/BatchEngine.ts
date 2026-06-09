type MaybeThenable<T> = T | PromiseLike<T>

export interface BatchEngineOptions<K = unknown, V = unknown> {
  flushMs?: number
  maxBatchSize?: number
  now?: () => number
  skipKey?: (key: K, value: V) => boolean
}

export class BatchEngine<K, V, T = V> {
  private buffer = new Map<K, V>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flushMs: number
  private readonly maxBatchSize: number
  private readonly now: () => number
  private scheduledFlushAt = 0
  private disposed = false
  private inFlight = new Set<K>()

  private readonly skipKey?: (key: K, value: V) => boolean

  constructor(
    private readonly reducer: (existing: V | undefined, value: T) => V,
    private readonly flushEach: (key: K, value: V) => MaybeThenable<boolean | void>,
    private readonly log?: (msg: string) => void,
    options: BatchEngineOptions<K, V> = {},
  ) {
    this.flushMs = options.flushMs ?? 16
    this.maxBatchSize = options.maxBatchSize ?? 25
    this.now = options.now ?? (() => Date.now())
    this.skipKey = options.skipKey
  }

  add(key: K, value: T): void {
    if (this.disposed) return
    const existing = this.buffer.get(key)
    this.buffer.set(key, this.reducer(existing, value))
    if (this.buffer.size >= this.maxBatchSize) {
      this.flush()
    } else {
      this.scheduleFlush(this.flushMs)
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.size === 0) return

    const succeeded: K[] = []
    for (const [key, value] of this.buffer) {
      if (this.inFlight.has(key)) continue
      if (this.skipKey?.(key, value)) continue
      try {
        const result = this.flushEach(key, value)
        if (result === false) continue
        if (result && typeof (result as PromiseLike<boolean | void>).then === "function") {
          this.inFlight.add(key)
          ;(result as PromiseLike<boolean | void>).then(
            (ok) => {
              this.inFlight.delete(key)
              if (this.disposed) return
              if (ok === false) {
                this.log?.(`[BatchEngine] flushEach returned false for ${String(key)}`)
                this.scheduleFlush(this.flushMs)
                return
              }
              if (Object.is(this.buffer.get(key), value)) {
                this.buffer.delete(key)
              }
              if (this.buffer.size > 0) {
                this.scheduleFlush(this.flushMs)
              }
            },
            (err) => {
              this.inFlight.delete(key)
              this.log?.(`[BatchEngine] flushEach rejected for ${String(key)}: ${String(err)}`)
              if (!this.disposed) {
                this.scheduleFlush(this.flushMs)
              }
            },
          )
          continue
        }
        succeeded.push(key)
      } catch (err) {
        this.log?.(`[BatchEngine] flushEach threw for ${String(key)}, retaining: ${String(err)}`)
      }
    }
    for (const key of succeeded) {
      this.buffer.delete(key)
    }
    if (this.buffer.size > 0) {
      this.scheduleFlush(this.flushMs)
    }
  }

  get size(): number {
    return this.buffer.size
  }

  has(key: K): boolean {
    return this.buffer.has(key)
  }

  keys(): IterableIterator<K> {
    return this.buffer.keys()
  }

  get(key: K): V | undefined {
    return this.buffer.get(key)
  }

  delete(key: K): boolean {
    return this.buffer.delete(key)
  }

  clear(): void {
    this.buffer.clear()
    this.inFlight.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.scheduledFlushAt = 0
  }

  dispose(): void {
    this.disposed = true
    try { this.flush() } catch { /* dispose must not throw */ }
    this.clear()
  }

  private scheduleFlush(delayMs: number): void {
    if (this.disposed || this.buffer.size === 0 || delayMs <= 0) return
    const dueAt = this.now() + delayMs
    if (this.timer && this.scheduledFlushAt <= dueAt) return
    if (this.timer) clearTimeout(this.timer)
    this.scheduledFlushAt = dueAt
    this.timer = setTimeout(() => this.flush(), delayMs)
  }
}
