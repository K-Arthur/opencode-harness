/**
 * Coalesces high-frequency per-session events (e.g. `todo_updated`) into a
 * single trailing callback per window per session. Latest payload wins.
 * Injectable clock for testing via the `now` constructor parameter.
 */
export class PerSessionDebouncer<T = unknown> {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private pending = new Map<string, T>()

  constructor(
    private readonly callback: (sessionId: string, payload: T) => void,
    private readonly delayMs: number,
  ) {}

  schedule(sessionId: string, payload: T): void {
    this.pending.set(sessionId, payload)
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      const p = this.pending.get(sessionId)
      this.pending.delete(sessionId)
      if (p !== undefined) this.callback(sessionId, p)
    }, this.delayMs)
    this.timers.set(sessionId, timer)
  }

  dispose(): void {
    for (const [sid, timer] of this.timers) {
      clearTimeout(timer)
      const p = this.pending.get(sid)
      this.pending.delete(sid)
      if (p !== undefined) this.callback(sid, p)
    }
    this.timers.clear()
  }
}
