export class TimerRegistry {
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private intervals = new Set<ReturnType<typeof setInterval>>()

  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
    return id
  }

  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = setInterval(fn, ms)
    this.intervals.add(id)
    return id
  }

  clearTimeout(id: ReturnType<typeof setTimeout> | null | undefined): void {
    if (id == null) return
    clearTimeout(id)
    this.timers.delete(id)
  }

  clearInterval(id: ReturnType<typeof setInterval> | null | undefined): void {
    if (id == null) return
    clearInterval(id)
    this.intervals.delete(id)
  }

  clearAll(): void {
    for (const id of this.timers) clearTimeout(id)
    for (const id of this.intervals) clearInterval(id)
    this.timers.clear()
    this.intervals.clear()
  }

  get pendingTimers(): number {
    return this.timers.size + this.intervals.size
  }
}

export const timers = new TimerRegistry()
