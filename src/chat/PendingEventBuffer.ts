/**
 * Holds server events whose target tab has not yet registered its cliSessionId
 * (first-prompt race) OR whose child-session-to-tab mapping hasn't yet been
 * registered by SubagentHeartbeat (subagent creation race).
 *
 * Events persist until explicitly drained — there is no TTL. This is by design:
 * child sessions for models like Minimax can run 30–45 minutes, and their events
 * must not expire before the heartbeat discovers the child session mapping.
 *
 * A periodic `sweep()` removes truly orphaned entries (sessions that were created
 * but never mapped, e.g. prompt aborted mid-flight).
 */

export interface BufferedServerEvent {
  type: string
  sessionId?: string
  data?: unknown
}

export interface PendingBufferLogger {
  warn: (msg: string) => void
  info: (msg: string) => void
}

export interface PendingEventBufferOptions {
  /** Max events held per sessionId (default 200). Oldest dropped when exceeded. */
  maxPerSession?: number
  log?: PendingBufferLogger
}

interface Entry {
  events: BufferedServerEvent[]
}

export class PendingEventBuffer {
  private readonly maxPerSession: number
  private readonly log: PendingBufferLogger
  private readonly byCli = new Map<string, Entry>()
  private disposed = false

  constructor(opts: PendingEventBufferOptions = {}) {
    this.maxPerSession = opts.maxPerSession ?? 200
    this.log = opts.log ?? { warn: () => {}, info: () => {} }
  }

  add(cliSessionId: string, event: BufferedServerEvent): void {
    if (this.disposed) return
    if (!cliSessionId) return

    let entry = this.byCli.get(cliSessionId)
    if (!entry) {
      entry = { events: [] }
      this.byCli.set(cliSessionId, entry)
    }

    if (!this.coalesceWithLastEvent(entry, event)) {
      entry.events.push(event)
    }
    if (entry.events.length > this.maxPerSession) {
      entry.events.splice(0, entry.events.length - this.maxPerSession)
    }
  }

  drain(cliSessionId: string): BufferedServerEvent[] {
    if (!cliSessionId) return []
    const entry = this.byCli.get(cliSessionId)
    if (!entry) return []
    const events = entry.events
    this.byCli.delete(cliSessionId)
    return events
  }

  /** How many events are buffered for the given session (0 if none). */
  size(cliSessionId: string): number {
    return this.byCli.get(cliSessionId)?.events.length ?? 0
  }

  /**
   * Remove orphaned entries that have been sitting unclaimed indefinitely.
   * Orphaned sessions are ones where the user aborted the prompt or the server
   * emitted events for a session that never registered a tab mapping.
   * Returns the number of sessions pruned.
   */
  sweep(hint?: { minAgeMs?: number; now?: number }): number {
    if (this.disposed) return 0
    const now = hint?.now ?? Date.now()
    const minAge = hint?.minAgeMs ?? 1_800_000  // default: 30 min (matches STREAM_STUCK_MS safety margin)
    let pruned = 0
    for (const [key, entry] of this.byCli) {
      // If the first event is older than minAge, this is likely orphaned.
      const first = entry.events[0]
      if (first && typeof (first as any).ts === "number" && now - (first as any).ts > minAge) {
        this.byCli.delete(key)
        pruned++
      }
    }
    return pruned
  }

  dispose(): void {
    this.disposed = true
    this.byCli.clear()
  }

  private coalesceWithLastEvent(entry: Entry, event: BufferedServerEvent): boolean {
    if (event.type !== "text_chunk") return false
    const last = entry.events[entry.events.length - 1]
    if (!last || last.type !== "text_chunk") return false

    const lastData = last.data
    const nextData = event.data
    if (!isTextChunkData(lastData) || !isTextChunkData(nextData)) return false

    last.data = {
      ...lastData,
      ...nextData,
      text: lastData.text + nextData.text,
      messageId: nextData.messageId ?? lastData.messageId,
    }
    return true
  }
}

function isTextChunkData(data: unknown): data is { text: string; messageId?: string } {
  return typeof data === "object" &&
    data !== null &&
    typeof (data as { text?: unknown }).text === "string"
}
