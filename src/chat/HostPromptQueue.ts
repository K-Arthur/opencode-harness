import * as vscode from "vscode"
import type { Attachment } from "./webview/types"

const crypto = globalThis.crypto

export type QueuedPromptState = "queued" | "sending" | "completed" | "failed"

export interface QueuedPrompt {
  id: string
  text: string
  sessionId: string
  attachments: Attachment[]
  mode: "interrupt" | "queue"
  isSteerPrompt: boolean
  state: QueuedPromptState
  createdAt: number
  error?: string
  /** ID of the user message in SessionStore, set at queue-time for dedup at drain-time. */
  userMessageId?: string
}

/**
 * Host-side prompt queue for FIFO processing.
 * Persisted to workspaceState — survives webview and VS Code reloads.
 * Each session has its own independent FIFO queue.
 */
export class HostPromptQueue {
  private static readonly STORAGE_KEY = "opencode.hostPromptQueue"
  private static readonly MAX_QUEUED_PER_SESSION = 50

  private queues = new Map<string, QueuedPrompt[]>()
  private readonly storage: vscode.Memento
  public drainAfterAbort: boolean

  constructor(
    storage: vscode.Memento,
    drainAfterAbort = false,
  ) {
    this.storage = storage
    this.drainAfterAbort = drainAfterAbort
  }

  /**
   * Enqueue a prompt. Returns the assigned ID.
   * Rejects (returns null) if the session already has MAX_QUEUED_PER_SESSION items.
   * Prunes completed/failed items before rejecting.
   */
  enqueue(sessionId: string, item: Omit<QueuedPrompt, "id" | "state" | "createdAt">): string | null {
    let queue = this.queues.get(sessionId) ?? []
    if (queue.length >= HostPromptQueue.MAX_QUEUED_PER_SESSION) {
      const before = queue.length
      queue = queue.filter(q => q.state === "queued" || q.state === "sending")
      if (queue.length < before) {
        this.queues.set(sessionId, queue)
        this.persist()
      }
      if (queue.length >= HostPromptQueue.MAX_QUEUED_PER_SESSION) {
        return null
      }
    }
    const id = `qp-${crypto.randomUUID()}`
    const prompt: QueuedPrompt = {
      ...item,
      id,
      state: "queued",
      createdAt: Date.now(),
    }
    queue.push(prompt)
    this.queues.set(sessionId, queue)
    this.persist()
    return id
  }

  /**
   * Dequeue the next queued prompt for a session.
   * Marks state="sending" in-place — item stays in the array until
   * confirmCompleted or confirmFailed is called.
   * Returns undefined if the queue is empty or no item is in "queued" state.
   */
  dequeue(sessionId: string): QueuedPrompt | undefined {
    const queue = this.queues.get(sessionId)
    if (!queue || queue.length === 0) return undefined
    const item = queue.find(i => i.state === "queued")
    if (!item) return undefined
    item.state = "sending"
    this.persist()
    return item
  }

  /**
   * Confirm a dequeued item completed successfully — removes it from the array.
   */
  confirmCompleted(sessionId: string, id: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    const idx = queue.findIndex(i => i.id === id)
    if (idx === -1) return false
    queue.splice(idx, 1)
    if (queue.length === 0) {
      this.queues.delete(sessionId)
    }
    this.persist()
    return true
  }

  /**
   * Peek at the next queued item without dequeuing.
   * Returns the first item in state "queued", or undefined if none.
   */
  peek(sessionId: string): QueuedPrompt | undefined {
    const queue = this.queues.get(sessionId)
    if (!queue || queue.length === 0) return undefined
    return queue.find(i => i.state === "queued")
  }

  /**
   * Remove a specific queued prompt by ID.
   */
  remove(sessionId: string, id: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    const idx = queue.findIndex(i => i.id === id)
    if (idx === -1) return false
    queue.splice(idx, 1)
    if (queue.length === 0) {
      this.queues.delete(sessionId)
    }
    this.persist()
    return true
  }

  /**
   * Clear all queued prompts for a session.
   */
  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.persist()
  }

  /**
   * Get all items for a session (in order).
   * Returns a copy to prevent accidental mutation.
   */
  getAll(sessionId: string): QueuedPrompt[] {
    return Array.from(this.queues.get(sessionId) ?? [])
  }

  /**
   * Check if any queued items exist (not in sending/completed state).
   */
  hasQueued(sessionId: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    return queue.some(i => i.state === "queued")
  }

  /**
   * Return all session IDs that have items in the queue.
   */
  getActiveSessionIds(): string[] {
    const ids: string[] = []
    for (const [sid, queue] of this.queues.entries()) {
      if (queue.some(i => i.state === "queued" || i.state === "sending")) {
        ids.push(sid)
      }
    }
    return ids
  }

  /**
   * Count queued items for a session.
   */
  queuedCount(sessionId: string): number {
    return this.queues.get(sessionId)?.filter(i => i.state === "queued").length ?? 0
  }

  /**
   * Mark any stuck "sending" items back to "queued" for retry.
   * Called on stream end to recover from interrupted sends.
   */
  markStuckSendingAsQueued(sessionId: string): void {
    const queue = this.queues.get(sessionId)
    if (!queue) return
    let changed = false
    for (const item of queue) {
      if (item.state === "sending") {
        item.state = "queued"
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /**
   * Set an item's state to failed with an error message.
   */
  markFailed(sessionId: string, id: string, error: string): void {
    const queue = this.queues.get(sessionId)
    if (!queue) return
    const item = queue.find(i => i.id === id)
    if (!item) return
    item.state = "failed"
    item.error = error
    this.persist()
  }

  /**
   * Edit the text of a queued item.
   */
  edit(sessionId: string, id: string, text: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    const item = queue.find(i => i.id === id)
    if (!item || item.state !== "queued") return false
    item.text = text
    this.persist()
    return true
  }

  /**
   * Retry a failed item — sets state back to "queued" and clears error.
   */
  retry(sessionId: string, id: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    const item = queue.find(i => i.id === id)
    if (!item || item.state !== "failed") return false
    item.state = "queued"
    item.error = undefined
    this.persist()
    return true
  }

  /**
   * Reorder items. Swaps item at fromIdx with toIdx.
   */
  reorder(sessionId: string, fromIdx: number, toIdx: number): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue || fromIdx < 0 || fromIdx >= queue.length || toIdx < 0 || toIdx >= queue.length) {
      return false
    }
    const item = queue.splice(fromIdx, 1)[0]
    if (!item) return false
    queue.splice(toIdx, 0, item)
    this.queues.set(sessionId, queue)
    this.persist()
    return true
  }

  /**
   * Snapshot for persistence.
   * Includes "sending" items so they survive crashes and can be recovered
   * via markStuckSendingAsQueued on restore.
   */
  snapshot(): Record<string, QueuedPrompt[]> {
    const result: Record<string, QueuedPrompt[]> = {}
    for (const [sid, queue] of this.queues.entries()) {
      const filtered = queue.filter(i => i.state === "queued" || i.state === "failed" || i.state === "sending")
      if (filtered.length > 0) result[sid] = filtered
    }
    return result
  }

  /**
   * Persist to workspaceState.
   */
  persist(): void {
    const snapshot = this.snapshot()
    if (Object.keys(snapshot).length === 0) {
      this.storage.update(HostPromptQueue.STORAGE_KEY, undefined)
    } else {
      this.storage.update(HostPromptQueue.STORAGE_KEY, snapshot)
    }
  }

  /**
   * Restore from workspaceState.
   * Recovers any "sending" items back to "queued" immediately on restore.
   */
  restore(): void {
    const data = this.storage.get<Record<string, QueuedPrompt[]>>(HostPromptQueue.STORAGE_KEY)
    if (!data) return
    for (const [sid, items] of Object.entries(data)) {
      if (!Array.isArray(items) || items.length === 0) continue
      this.queues.set(sid, items)
      this.markStuckSendingAsQueued(sid)
    }
  }

  /**
   * Clear all queues entirely.
   */
  clearAll(): void {
    this.queues.clear()
    this.persist()
  }
}
