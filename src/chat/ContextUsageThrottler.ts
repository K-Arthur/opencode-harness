/**
 * Throttles context usage updates to avoid flooding the webview with rapid changes.
 * Coalesces multiple updates within a debounce window (default 250ms) into a single emission.
 * Provides an immediate emit path for critical events (compaction, file add, stream boundaries).
 * Per-session tracking prevents cross-session interference.
 */

export interface ContextUsageData {
  percent: number
  tokens: number
  maxTokens?: number
  sessionId?: string
  breakdown?: {
    system: number
    history: number
    workspace: number
    queued?: number
    steer?: number
  }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
}

type EventListener<T> = (event: T) => void

class SimpleEventEmitter<T> {
  private listeners = new Set<EventListener<T>>()

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(event: T): void {
    for (const listener of this.listeners) listener(event)
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export class ContextUsageThrottler {
  private readonly onEmitEmitter = new SimpleEventEmitter<ContextUsageData>()
  private pendingUpdates = new Map<string, ContextUsageData>()
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  readonly onEmit = this.onEmitEmitter.event

  constructor(private readonly debounceMs: number = 250) {
    // debounceMs is now a parameter property
  }

  /**
   * Emit a context usage update, debounced per session.
   * Multiple rapid calls for the same session are coalesced into a single emission.
   */
  emit(data: ContextUsageData): void {
    if (this.disposed) return

    const sessionId = data.sessionId ?? "default"

    // Store the latest update for this session
    this.pendingUpdates.set(sessionId, data)

    // Clear existing timer for this session
    const existingTimer = this.pendingTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule debounced emission
    const timer = setTimeout(() => {
      this.flushSession(sessionId)
    }, this.debounceMs)

    this.pendingTimers.set(sessionId, timer)
  }

  /**
   * Emit immediately, bypassing the debounce window.
   * Use for critical events where immediate UI feedback is required.
   */
  emitImmediate(data: ContextUsageData): void {
    if (this.disposed) return

    // Cancel any pending debounced emit for this session
    const sessionId = data.sessionId ?? "default"
    const existingTimer = this.pendingTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.pendingTimers.delete(sessionId)
    }

    // Remove from pending updates to avoid duplicate emission
    this.pendingUpdates.delete(sessionId)

    // Emit immediately
    this.onEmitEmitter.fire(data)
  }

  /**
   * Flush a specific session's pending update immediately.
   */
  private flushSession(sessionId: string): void {
    if (this.disposed) return

    const data = this.pendingUpdates.get(sessionId)
    if (data) {
      this.pendingUpdates.delete(sessionId)
      this.onEmitEmitter.fire(data)
    }

    this.pendingTimers.delete(sessionId)
  }

  /**
   * Flush all pending updates immediately.
   */
  flushAll(): void {
    if (this.disposed) return

    for (const sessionId of this.pendingUpdates.keys()) {
      this.flushSession(sessionId)
    }
  }

  /**
   * Cleanup all timers and prevent further emissions.
   */
  dispose(): void {
    this.disposed = true

    // Clear all pending timers
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingTimers.clear()
    this.pendingUpdates.clear()
    this.onEmitEmitter.dispose()
  }
}
