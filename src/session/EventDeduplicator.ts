/**
 * Stateless-on-reconnect deduplication for SSE events.
 *
 * Intentionally has NO reset() method — the instance must survive SSE
 * reconnects so that events replayed by the server after reconnect are
 * correctly identified as duplicates and dropped. Creating a new
 * EventNormalizer on reconnect is safe because it handles shape
 * transformation only; deduplication lives here.
 *
 * TTL-based eviction prevents unbounded growth in long-running sessions.
 */
export class EventDeduplicator {
  private readonly seen = new Map<string, number>()

  constructor(private readonly ttlMs = 30_000) {}

  /**
   * Returns true if the event id was seen within the TTL window.
   * Always returns false for empty/falsy ids (non-deduplicable frames).
   * Side effect: records the id if not a duplicate.
   */
  isDuplicate(id: string): boolean {
    if (!id) return false

    const now = Date.now()
    const ts = this.seen.get(id)
    if (ts !== undefined && now - ts < this.ttlMs) return true

    this.seen.set(id, now)
    this.evict(now)
    return false
  }

  private evict(now: number): void {
    // Amortised O(n) eviction — only runs on every insert.
    // For typical session event rates (< 10 events/s) the map stays small.
    for (const [id, ts] of this.seen) {
      if (now - ts >= this.ttlMs) this.seen.delete(id)
    }
  }
}
