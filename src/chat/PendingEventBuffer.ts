/**
 * Holds server events whose target tab has not yet registered its cliSessionId.
 *
 * Why: when the user sends a first message in a new tab, the opencode server
 * may emit SSE events (file_edited, tool_start, message_complete, etc.) before
 * `TabManager.setCliSessionId` runs. Without buffering, those events were
 * silently dropped by ChatProvider.handleServerEvent, leaving the tab frozen
 * with no visible response.
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
  /** Time-to-live for a single buffered event, in ms. Default 5000. */
  ttlMs?: number
  /** Max events held per sessionId. Default 100. */
  maxPerSession?: number
  log?: PendingBufferLogger
}

interface Entry {
  events: BufferedServerEvent[]
  timer: ReturnType<typeof setTimeout> | null
  expiredOnce: boolean
}

export class PendingEventBuffer {
  private readonly ttlMs: number
  private readonly maxPerSession: number
  private readonly log: PendingBufferLogger
  private readonly byCli = new Map<string, Entry>()
  private disposed = false

  constructor(opts: PendingEventBufferOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5_000
    this.maxPerSession = opts.maxPerSession ?? 100
    this.log = opts.log ?? { warn: () => {}, info: () => {} }
  }

  add(cliSessionId: string, event: BufferedServerEvent): void {
    if (this.disposed) return
    if (!cliSessionId) return

    let entry = this.byCli.get(cliSessionId)
    if (!entry) {
      entry = { events: [], timer: null, expiredOnce: false }
      this.byCli.set(cliSessionId, entry)
    }

    entry.events.push(event)
    if (entry.events.length > this.maxPerSession) {
      entry.events.splice(0, entry.events.length - this.maxPerSession)
    }

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
    const count = entry.events.length
    this.byCli.delete(cliSessionId)
    if (!entry.expiredOnce) {
      entry.expiredOnce = true
      this.log.warn(
        `[PendingEventBuffer] Dropped ${count} buffered event(s) for cliSessionId "${cliSessionId}" — TTL expired before tab mapping was registered.`,
      )
    }
  }
}
