/**
 * Decides whether an abort-category `server_error` is the *expected* echo of a
 * run the user intentionally aborted (Stop / interrupt-and-send) and should be
 * swallowed, versus a genuine failure that must surface.
 *
 * Why this exists: opencode emits a `MessageAbortedError` on the SSE stream a
 * beat after we call `abortSession`. Surfacing it would show a spurious
 * "The request was cancelled." card and can tear down a replacement run started
 * by interrupt-and-send.
 *
 * Policy (in priority order):
 *  1. **Server message-id correlation (timing-independent).** When we abort, we
 *     record the server `msg_…` id of the run being cancelled. The late error
 *     carries that same id, so we match precisely no matter how slow it lands —
 *     fixing the class of bug where a generous-but-finite time window still
 *     expired before the error arrived. The record is consumed on match.
 *  2. **Per-tab fallback window.** When the abort happened before any server
 *     message id was observed (no correlatable id), a short self-expiring window
 *     keyed by tab suppresses the late error, preserving the previous behavior
 *     with zero regression.
 *
 * Pure and clock-injected (`now` is passed in) so it is fully unit-testable and
 * is a clean seam for the future centralized stream reducer.
 */
export interface IntentionalAbortRegistryOptions {
  /** Self-expiring per-tab fallback window (ms) for late errors without a correlatable id. */
  windowMs?: number
  /** How long recorded message ids are retained before pruning (memory hygiene only — not correctness). */
  retentionMs?: number
}

const DEFAULT_WINDOW_MS = 8000
const DEFAULT_RETENTION_MS = 120_000

export class IntentionalAbortRegistry {
  private readonly windowMs: number
  private readonly retentionMs: number
  /** tabId → epoch ms at which the fallback window expires. */
  private readonly windowUntil = new Map<string, number>()
  /** server messageId → epoch ms recorded (used for retention pruning). */
  private readonly abortedMessageIds = new Map<string, number>()

  constructor(options: IntentionalAbortRegistryOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
  }

  /**
   * Record that the run on `tabId` was intentionally aborted. When the run's
   * server assistant message id is known it is registered for timing-independent
   * correlation; the per-tab fallback window is always opened so late errors that
   * lack a correlatable id are still suppressed.
   */
  recordAbort(tabId: string, serverMessageId: string | undefined, now: number): void {
    this.windowUntil.set(tabId, now + this.windowMs)
    if (serverMessageId) {
      this.pruneMessageIds(now)
      this.abortedMessageIds.set(serverMessageId, now)
    }
  }

  /**
   * True when an abort-category error for `tabId` (optionally carrying the server
   * `serverMessageId`) should be suppressed. A message-id match is consumed so a
   * single recorded abort suppresses exactly one error.
   */
  wasIntentional(tabId: string, serverMessageId: string | undefined, now: number): boolean {
    if (serverMessageId !== undefined && this.abortedMessageIds.has(serverMessageId)) {
      this.abortedMessageIds.delete(serverMessageId)
      return true
    }
    const until = this.windowUntil.get(tabId)
    if (until === undefined) return false
    if (now >= until) {
      this.windowUntil.delete(tabId)
      return false
    }
    return true
  }

  /** Drop all windows and recorded ids (called on dispose). */
  clear(): void {
    this.windowUntil.clear()
    this.abortedMessageIds.clear()
  }

  private pruneMessageIds(now: number): void {
    for (const [id, recordedAt] of this.abortedMessageIds) {
      if (now - recordedAt > this.retentionMs) this.abortedMessageIds.delete(id)
    }
  }
}
