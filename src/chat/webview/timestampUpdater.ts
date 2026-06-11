/**
 * TimestampUpdater — keeps relative-time elements fresh without re-rendering
 * whole messages.
 *
 * Usage:
 *   const updater = new TimestampUpdater()
 *   updater.startTicking()   // call once in main.ts
 *
 *   // When rendering a timestamp element:
 *   el.dataset.timestamp = String(ts)
 *   el.title = formatExactTimestamp(ts)
 *   updater.register(el, ts)
 *
 * The updater queries the live DOM via `[data-timestamp]` on each tick so
 * elements removed from the DOM are automatically dropped.
 */

/** Format a unix-ms timestamp as a locale-aware exact date+time string. */
export function formatExactTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** Format a unix-ms timestamp as a short relative string ("just now", "3 min ago", etc.). */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export class TimestampUpdater {
  private readonly registered = new Map<HTMLElement, number>()
  private intervalId: ReturnType<typeof setInterval> | undefined

  /** Register an element for live relative-time updates. */
  register(el: HTMLElement, ts: number): void {
    this.registered.set(el, ts)
    el.textContent = formatRelativeTime(ts)
  }

  /** Number of elements currently tracked. Exposed for leak regression tests. */
  get registeredCount(): number {
    return this.registered.size
  }

  /** Refresh all registered elements and also pick up any new `[data-timestamp]` elements in the DOM. */
  tick(): void {
    // Update registered elements; drop ones removed from the DOM. Message
    // elements are replaced constantly (virtual-list pruning, streaming
    // re-renders, transcript rebuilds) — without this check the Map retained
    // every detached subtree for the lifetime of the webview.
    for (const [el, ts] of this.registered) {
      if (el.isConnected === false) {
        this.registered.delete(el)
        continue
      }
      el.textContent = formatRelativeTime(ts)
    }

    // Also scan the live DOM for elements with data-timestamp that weren't registered manually
    if (typeof document !== "undefined") {
      const els = document.querySelectorAll<HTMLElement>("[data-timestamp]:not([data-ts-wired])")
      for (const el of els) {
        const ts = Number(el.dataset.timestamp)
        if (!Number.isNaN(ts) && ts > 0) {
          el.dataset.tsWired = "1"
          this.registered.set(el, ts)
          el.textContent = formatRelativeTime(ts)
        }
      }
    }
  }

  /** Start ticking on an interval (default 60 seconds). */
  startTicking(intervalMs = 60_000): void {
    this.stopTicking()
    this.intervalId = setInterval(() => this.tick(), intervalMs)
  }

  /** Stop the interval. Safe to call multiple times. */
  stopTicking(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
  }
}
