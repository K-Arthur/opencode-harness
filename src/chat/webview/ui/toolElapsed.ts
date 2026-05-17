import { timers } from "../timerRegistry"

export class ToolElapsedTracker {
  private startTimes = new Map<string, number>()
  private intervalId: ReturnType<typeof setInterval> | null = null

  registerStart(toolId: string): void {
    this.startTimes.set(toolId, Date.now())
    this.startInterval()
  }

  unregisterEnd(toolId: string, finalMs?: number): void {
    const startedAt = this.startTimes.get(toolId)
    this.startTimes.delete(toolId)
    const el = document.querySelector<HTMLSpanElement>(`.tool-elapsed[data-block-id="${CSS.escape(toolId)}"]`)
    if (!el) return
    const durationMs = (typeof finalMs === "number" && finalMs >= 0)
      ? finalMs
      : startedAt != null ? Date.now() - startedAt : 0
    el.textContent = formatElapsed(durationMs)
    el.classList.add("tool-elapsed--final")
  }

  stop(): void {
    if (this.intervalId) {
      timers.clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  clearForPrefix(prefix: string): void {
    for (const key of [...this.startTimes.keys()]) {
      if (key.startsWith(prefix + ":")) {
        this.startTimes.delete(key)
      }
    }
    if (this.startTimes.size === 0) this.stop()
  }

  clearAll(): void {
    this.startTimes.clear()
    this.stop()
  }

  private startInterval(): void {
    if (this.intervalId) return
    this.intervalId = timers.setInterval(() => {
      const now = Date.now()
      for (const [toolId, startTime] of this.startTimes) {
        const el = document.querySelector<HTMLSpanElement>(`.tool-elapsed[data-block-id="${CSS.escape(toolId)}"]`)
        if (!el) continue
        el.textContent = formatElapsed(now - startTime)
      }
      if (this.startTimes.size === 0) {
        this.stop()
      }
    }, 1000)
  }
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`
}
