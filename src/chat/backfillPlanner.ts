import { isLocalPlaceholderSessionId } from "../session/sessionUtils"

/**
 * Pure backfill planning helpers (no vscode imports) so they can be unit-tested
 * directly. BackfillService delegates the decisions here.
 */

export interface BackfillCandidate {
  id: string
  cliSessionId?: string
  messages: unknown[]
  needsBackfill?: boolean
}

/**
 * Sessions that still need a history backfill: flagged, backed by a real CLI
 * session (not a local placeholder), and currently empty.
 */
export function selectPendingBackfill<T extends BackfillCandidate>(sessions: readonly T[]): T[] {
  return sessions.filter(
    (s) =>
      s.needsBackfill === true &&
      !!s.cliSessionId &&
      !isLocalPlaceholderSessionId(s.cliSessionId) &&
      s.messages.length === 0,
  )
}

/**
 * Coalesces concurrent async work by key so the same key never runs twice in
 * parallel — concurrent callers share the one in-flight promise (B3). The entry
 * is removed once settled so a later call re-runs.
 */
export class SingleFlight<T> {
  private readonly inflight = new Map<string, Promise<T>>()

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing
    const p = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  has(key: string): boolean {
    return this.inflight.has(key)
  }
}
