/**
 * Quota monitor — thin state holder for the latest rate-limit snapshot.
 *
 * Background: the original module was a 527-line class with a 30-second
 * interval timer, threshold-based warning generation, and a callback
 * subscription API. The interval timer is still active (`startMonitoring`
 * is called once at init), but no consumer ever subscribes to
 * `onQuotaWarning`, so the timer does no useful work — it just polls
 * internal state and discards the result.
 *
 * The host pushes `rate_limit_state` on every change, and `tokenCostDisplay.ts`
 * renders the bar via `updateQuotaBar` synchronously. The monitor's only
 * remaining job is to keep the most recent snapshot around in case a future
 * UI surface (toast, proactive warning banner, etc.) needs it.
 *
 * If you add a real warning consumer later, restore the interval timer and
 * the threshold logic at that point — don't speculate.
 */
import type { QuotaState } from "./errorTypes"

export interface QuotaSnapshot {
  remainingTokens: number
  limitTokens: number
  remainingRequests: number
  limitRequests: number
  resetAt: Date | null
}

function emptySnapshot(): QuotaSnapshot {
  return {
    remainingTokens: 0,
    limitTokens: 0,
    remainingRequests: 0,
    limitRequests: 0,
    resetAt: null,
  }
}

class QuotaMonitor {
  private state: QuotaSnapshot = emptySnapshot()

  updateQuotaState(data: {
    remainingTokens: number
    limitTokens: number
    remainingRequests: number
    limitRequests: number
    resetAt: string
  }): void {
    const resetAt = new Date(data.resetAt)
    this.state = {
      remainingTokens: data.remainingTokens,
      limitTokens: data.limitTokens,
      remainingRequests: data.remainingRequests,
      limitRequests: data.limitRequests,
      resetAt: Number.isNaN(resetAt.getTime()) ? null : resetAt,
    }
  }

  getState(): QuotaSnapshot {
    return { ...this.state }
  }

  /**
   * No-op retained for API compatibility with the original class. The
   * proactive-warning interval has no consumer; see the module docstring.
   */
  startMonitoring(): void {}

  stopMonitoring(): void {}

  destroy(): void {
    this.state = emptySnapshot()
  }
}

export { QuotaMonitor }

let globalMonitor: QuotaMonitor | null = null

export function getQuotaMonitor(): QuotaMonitor {
  if (!globalMonitor) globalMonitor = new QuotaMonitor()
  return globalMonitor
}

export function resetQuotaMonitor(): void {
  if (globalMonitor) {
    globalMonitor.destroy()
    globalMonitor = null
  }
}

export type { QuotaState }
