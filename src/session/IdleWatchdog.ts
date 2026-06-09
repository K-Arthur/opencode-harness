/**
 * Tracks idle timeout for an event stream. Fires the abort callback when
 * no activity is detected within the configured window, indicating a
 * half-open TCP connection or server-side stall.
 *
 * vscode-free — testable in isolation.
 */

export interface IdleWatchdogOptions {
  timeoutMs: number
  onTimeout: () => void
}

export class IdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly timeoutMs: number
  private readonly onTimeout: () => void
  private _timedOut = false

  constructor(opts: IdleWatchdogOptions) {
    this.timeoutMs = opts.timeoutMs
    this.onTimeout = opts.onTimeout
  }

  get timedOut(): boolean {
    return this._timedOut
  }

  arm(): void {
    this.clear()
    this.timer = setTimeout(() => {
      this._timedOut = true
      this.onTimeout()
    }, this.timeoutMs)
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}