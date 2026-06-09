/**
 * Holds server events whose target tab has not yet registered its cliSessionId.
 *
 * Per the Akka Actor Model, child session events (text_chunk, tool_start) are
 * internal to the child and should NOT be routed to the parent — the parent only
 * needs lifecycle notifications (heartbeat) and summary info (subagent_update on
 * the parent stream). Child sessions are discovered by SubagentHeartbeat within
 * ~5 seconds; the short TTL covers this race window and drops orphans quickly.
 *
 * Primary use case: the ~5ms race between session.create and setCliSessionId
 * during the first prompt in a new tab.
 */

export const BUFFER_TTL_MS = 10_000  // 10s — covers heartbeat race window; orphans expire fast

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
  /** Time-to-live for buffered events, in ms (default 10s). */
  ttlMs?: number
  /** Max events held per sessionId (default 200). Oldest dropped when exceeded. */
  maxPerSession?: number
  log?: PendingBufferLogger
}

interface Entry {
  events: BufferedServerEvent[]
  timer: ReturnType<typeof setTimeout> | null
}

export class PendingEventBuffer {
  private readonly ttlMs: number
  private readonly maxPerSession: number
  private readonly log: PendingBufferLogger
  private readonly byCli = new Map<string, Entry>()
  private disposed = false

  constructor(opts: PendingEventBufferOptions = {}) {
    this.ttlMs = opts.ttlMs ?? BUFFER_TTL_MS
    this.maxPerSession = opts.maxPerSession ?? 200
    this.log = opts.log ?? { warn: () => {}, info: () => {} }
  }

  add(cliSessionId: string, event: BufferedServerEvent): void {
    if (this.disposed) return
    if (!cliSessionId) return

    let entry = this.byCli.get(cliSessionId)
    if (!entry) {
      entry = { events: [], timer: null }
      this.byCli.set(cliSessionId, entry)
    }

    if (!this.coalesceWithLastEvent(entry, event)) {
      entry.events.push(event)
    }
    if (entry.events.length > this.maxPerSession) {
      entry.events.splice(0, entry.events.length - this.maxPerSession)
    }

    // Arm expiry timer on first event for this session
    if (!entry.timer) {
      entry.timer = setTimeout(() => this.expire(cliSessionId), this.ttlMs)
    }
  }

  drain(cliSessionId: string): BufferedServerEvent[] {
    if (!cliSessionId) return []
    const entry = this.byCli.get(cliSessionId)
    if (!entry) return []
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    const events = entry.events
    this.byCli.delete(cliSessionId)
    return events
  }

  /** How many events are buffered for the given session (0 if none). */
  size(cliSessionId: string): number {
    return this.byCli.get(cliSessionId)?.events.length ?? 0
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.byCli.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.byCli.clear()
  }

  private expire(cliSessionId: string): void {
    const entry = this.byCli.get(cliSessionId)
    if (!entry) return
    this.byCli.delete(cliSessionId)
    this.log.warn(
      `[PendingEventBuffer] Dropped ${entry.events.length} buffered event(s) for cliSessionId "${cliSessionId}" — TTL (${this.ttlMs}ms) expired before tab mapping was registered.`,
    )
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
