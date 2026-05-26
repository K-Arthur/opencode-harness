class BatchEngine {
  buffer = new Map()
  timer = null
  scheduledFlushAt = 0
  disposed = false
  skipKey

  constructor(reducer, flushEach, log, options = {}) {
    this.reducer = reducer
    this.flushEach = flushEach
    this.log = log
    this.flushMs = options.flushMs ?? 16
    this.maxBatchSize = options.maxBatchSize ?? 25
    this.now = options.now ?? (() => Date.now())
    this.skipKey = options.skipKey
  }

  add(key, value) {
    if (this.disposed) return
    const existing = this.buffer.get(key)
    this.buffer.set(key, this.reducer(existing, value))
    if (this.buffer.size >= this.maxBatchSize) {
      this.flush()
    } else {
      this.scheduleFlush(this.flushMs)
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.size === 0) return

    const succeeded = []
    for (const [key, value] of this.buffer) {
      if (this.skipKey?.(key, value)) continue
      try {
        const result = this.flushEach(key, value)
        if (result === false) continue
        if (result && typeof result.then === "function") {
          result.then(
            (ok) => {
              if (ok === false) this.log?.(`[BatchEngine] flushEach returned false for ${String(key)}`)
            },
            (err) => {
              this.log?.(`[BatchEngine] flushEach rejected for ${String(key)}: ${String(err)}`)
            },
          )
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

  get size() {
    return this.buffer.size
  }

  has(key) {
    return this.buffer.has(key)
  }

  keys() {
    return this.buffer.keys()
  }

  get(key) {
    return this.buffer.get(key)
  }

  delete(key) {
    return this.buffer.delete(key)
  }

  clear() {
    this.buffer.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.scheduledFlushAt = 0
  }

  dispose() {
    this.disposed = true
    try { this.flush() } catch {}
    this.clear()
  }

  scheduleFlush(delayMs) {
    if (this.disposed || this.buffer.size === 0 || delayMs <= 0) return
    const dueAt = this.now() + delayMs
    if (this.timer && this.scheduledFlushAt <= dueAt) return
    if (this.timer) clearTimeout(this.timer)
    this.scheduledFlushAt = dueAt
    this.timer = setTimeout(() => this.flush(), delayMs)
  }
}

exports.BatchEngine = BatchEngine
