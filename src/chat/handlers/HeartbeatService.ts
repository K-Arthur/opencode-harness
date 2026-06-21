import type { TabManager } from "../TabManager"
import type { StreamCallbacks } from "./StreamCoordinatorTypes"
import { log } from "../../utils/outputChannel"

/** Entry in the deferred-chunk coalescing buffer. */
export interface DeferredChunkEntry {
  text: string
  messageId?: string
  callbacks: StreamCallbacks
  timer: ReturnType<typeof setTimeout>
}

/** Dependencies shared by reference from StreamCoordinator. */
export interface HeartbeatDeps {
  tabManager: TabManager
  heartbeatSeqs: Map<string, number>
  heartbeatAckedSeqs: Map<string, number>
  heartbeatAckedChunkSeqs: Map<string, number>
  heartbeatTimers: Map<string, ReturnType<typeof setInterval>>
  lastForceRerenderSeqs: Map<string, number>
  postedChunkSeqs: Map<string, number>
  deferredChunks: Map<string, DeferredChunkEntry>
  readonly MAX_UNACKED_STREAM_CHUNKS: number
  readonly MAX_STREAM_DEFER_MS: number
}

/**
 * Manages per-tab heartbeat pings, rendered-chunk ACK backpressure, and
 * deferred chunk coalescing. Extracted from StreamCoordinator to isolate
 * the timing/ack logic from stream content assembly.
 */
export class HeartbeatService {
  constructor(private readonly deps: HeartbeatDeps) {}

  private nextChunkSeq(tabId: string): number {
    const seq = (this.deps.postedChunkSeqs.get(tabId) || 0) + 1
    this.deps.postedChunkSeqs.set(tabId, seq)
    return seq
  }

  startHeartbeat(tabId: string, callbacks: StreamCallbacks): void {
    this.stopHeartbeat(tabId)
    this.deps.heartbeatSeqs.set(tabId, 0)
    this.deps.heartbeatAckedSeqs.set(tabId, 0)
    const timer = setInterval(() => {
      const tab = this.deps.tabManager.getTab(tabId)
      if (!tab?.isStreaming) {
        this.stopHeartbeat(tabId)
        return
      }
      const seq = (this.deps.heartbeatSeqs.get(tabId) || 0) + 1
      this.deps.heartbeatSeqs.set(tabId, seq)
      callbacks.postMessage({
        type: "stream_ping",
        sessionId: tabId,
        seq,
      })
      const ackedSeq = this.deps.heartbeatAckedSeqs.get(tabId) || 0
      const lastRerenderSeq = this.deps.lastForceRerenderSeqs.get(tabId) || 0
      if (seq - ackedSeq > 2 && seq > lastRerenderSeq) {
        if (seq - ackedSeq === 3) {
          log.warn(`Heartbeat: tab ${tabId} missed ${seq - ackedSeq} pings, sending force_rerender (seq=${seq})`)
        }
        const fullText = tab.streamingBuffer || ""
        callbacks.postMessage({
          type: "force_rerender",
          sessionId: tabId,
          text: fullText,
        })
        this.deps.lastForceRerenderSeqs.set(tabId, seq)
      } else if (seq - ackedSeq <= 2) {
        this.deps.lastForceRerenderSeqs.set(tabId, 0)
      }
    }, 5000)
    this.deps.heartbeatTimers.set(tabId, timer)
  }

  stopHeartbeat(tabId: string): void {
    const timer = this.deps.heartbeatTimers.get(tabId)
    if (timer) {
      clearInterval(timer)
      this.deps.heartbeatTimers.delete(tabId)
    }
    this.deps.heartbeatSeqs.delete(tabId)
    this.deps.heartbeatAckedSeqs.delete(tabId)
    this.deps.heartbeatAckedChunkSeqs.delete(tabId)
    this.deps.lastForceRerenderSeqs.delete(tabId)
  }

  handleStreamAck(tabId: string, seq: number, lastRenderedChunkSeq?: number): void {
    if (seq > 0) this.deps.heartbeatAckedSeqs.set(tabId, seq)
    if (lastRenderedChunkSeq !== undefined) {
      this.deps.heartbeatAckedChunkSeqs.set(tabId, lastRenderedChunkSeq)
    }
    this.drainDeferredChunk(tabId)
  }

  private unackedStreamChunkCount(tabId: string): number {
    const posted = this.deps.postedChunkSeqs.get(tabId) || 0
    const rendered = this.deps.heartbeatAckedChunkSeqs.get(tabId) || 0
    return Math.max(0, posted - rendered)
  }

  private shouldDeferStreamChunk(tabId: string): boolean {
    return this.unackedStreamChunkCount(tabId) >= this.deps.MAX_UNACKED_STREAM_CHUNKS
  }

  private postChunkToWebview(tabId: string, text: string, callbacks: StreamCallbacks, messageId?: string): void {
    callbacks.postMessage({
      type: "stream_chunk",
      sessionId: tabId,
      text,
      messageId,
      seq: this.nextChunkSeq(tabId),
    })
  }

  postOrDeferChunk(tabId: string, text: string, callbacks: StreamCallbacks, messageId?: string): void {
    if (!this.shouldDeferStreamChunk(tabId)) {
      this.postChunkToWebview(tabId, text, callbacks, messageId)
      return
    }

    const existing = this.deps.deferredChunks.get(tabId)
    if (existing) {
      existing.text += text
      existing.callbacks = callbacks
      existing.messageId = messageId ?? existing.messageId
      return
    }

    const timer = setTimeout(() => this.drainDeferredChunk(tabId, true), this.deps.MAX_STREAM_DEFER_MS)
    this.deps.deferredChunks.set(tabId, { text, messageId, callbacks, timer })
  }

  drainDeferredChunk(tabId: string, force = false): void {
    const deferred = this.deps.deferredChunks.get(tabId)
    if (!deferred) return
    if (!force && this.shouldDeferStreamChunk(tabId)) return

    clearTimeout(deferred.timer)
    this.deps.deferredChunks.delete(tabId)
    this.postChunkToWebview(tabId, deferred.text, deferred.callbacks, deferred.messageId)
  }

  clearDeferredChunk(tabId: string): void {
    const deferred = this.deps.deferredChunks.get(tabId)
    if (deferred) {
      clearTimeout(deferred.timer)
      this.deps.deferredChunks.delete(tabId)
    }
  }

  /** Clear all timers and state — called from StreamCoordinator.dispose. */
  dispose(): void {
    for (const timer of this.deps.heartbeatTimers.values()) {
      clearInterval(timer)
    }
    this.deps.heartbeatTimers.clear()
    this.deps.heartbeatSeqs.clear()
    this.deps.heartbeatAckedSeqs.clear()
    this.deps.heartbeatAckedChunkSeqs.clear()
    this.deps.lastForceRerenderSeqs.clear()
    this.deps.postedChunkSeqs.clear()
    for (const deferred of this.deps.deferredChunks.values()) {
      clearTimeout(deferred.timer)
    }
    this.deps.deferredChunks.clear()
  }
}
