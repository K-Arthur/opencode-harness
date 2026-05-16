export type QueueItemState = "queued" | "sending" | "streaming" | "completed" | "failed"

export interface Attachment {
  data: string
  mimeType: string
}

export interface QueueItem {
  id: string
  text: string
  attachments: Attachment[]
  state: QueueItemState
  createdAt: number
  error?: string
  position: number
  isSteerPrompt?: boolean
  estimatedTokens?: number
}

export interface QueueNextResult {
  text: string
  attachments: Attachment[]
}

export interface PromptQueue {
  getItems: () => QueueItem[]
  enqueue: (text: string, attachments?: Attachment[]) => QueueItem | null
  remove: (id: string) => boolean
  edit: (id: string, text: string) => boolean
  processNext: () => QueueNextResult | null
  isNextReady: () => boolean
  clear: () => void
  /** Reorder a queued item from one position to another. Refuses to move
   *  items that are currently sending/streaming. Returns true on success. */
  reorder: (fromIndex: number, toIndex: number) => boolean
  moveToFront: (id: string) => boolean
  moveToBack: (id: string) => boolean
  /** Cheap sum of estimated tokens across all items. Used by the queue UI
   *  to warn users when a batched send will overflow the model's context. */
  getTotalEstimatedTokens: () => number
  markAsSteer: (id: string) => boolean
  /** Snapshot for persistence. Pair with restore(). */
  persist: () => QueueItem[]
  /** Hydrate from a previously persisted snapshot (e.g. after webview reload). */
  restore: (items: QueueItem[]) => void
}

// Approximate: 1 token ≈ 4 characters for English text. Cheap heuristic
// shared with the queue UI; an exact count is not worth the cost here.
function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function createPromptQueue(): PromptQueue {
  const items: QueueItem[] = []

  function getItems(): QueueItem[] {
    return items.slice()
  }

  function enqueue(text: string, attachments?: Attachment[]): QueueItem | null {
    const trimmed = text.trim()
    if (!trimmed && (!attachments || attachments.length === 0)) return null
    const item: QueueItem = {
      id: `q-${crypto.randomUUID()}`,
      text: trimmed,
      attachments: attachments || [],
      state: "queued",
      createdAt: Date.now(),
      position: items.length,
      estimatedTokens: estimateTextTokens(trimmed),
    }
    items.push(item)
    return item
  }

  function getTotalEstimatedTokens(): number {
    return items.reduce((sum, item) => sum + (item.estimatedTokens || 0), 0)
  }

  function canMove(idx: number): boolean {
    const it = items[idx]
    if (!it) return false
    // Only queued + failed items can move. Sending/streaming/completed items
    // are positional anchors — reordering them would lie about send order.
    return it.state === "queued" || it.state === "failed"
  }

  function compactPositions(): void {
    items.forEach((item, i) => (item.position = i))
  }

  function reorder(fromIndex: number, toIndex: number): boolean {
    if (fromIndex === toIndex) return false
    if (fromIndex < 0 || fromIndex >= items.length) return false
    if (toIndex < 0 || toIndex >= items.length) return false
    if (!canMove(fromIndex)) return false
    // Target slot must also be a movable item (don't bury queued items
    // behind already-sending ones).
    if (!canMove(toIndex)) return false
    const moved = items[fromIndex]
    if (!moved) return false
    items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)
    compactPositions()
    return true
  }

  function moveToFront(id: string): boolean {
    const idx = items.findIndex(i => i.id === id)
    if (idx <= 0) return false
    // Find the first movable slot; queued items can only jump ahead of
    // other queued/failed items, not in front of one already sending.
    let target = 0
    while (target < idx && !canMove(target)) target += 1
    return reorder(idx, target)
  }

  function moveToBack(id: string): boolean {
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1 || idx === items.length - 1) return false
    return reorder(idx, items.length - 1)
  }

  function markAsSteer(id: string): boolean {
    const item = items.find(i => i.id === id)
    if (!item) return false
    item.isSteerPrompt = true
    return true
  }

  function persist(): QueueItem[] {
    return items.slice()
  }

  function restore(savedItems: QueueItem[]): void {
    items.length = 0
    items.push(...savedItems)
  }

  function remove(id: string): boolean {
    const idx = items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    if (items[idx]!.state === "sending" || items[idx]!.state === "streaming") return false
    items.splice(idx, 1)
    // Compact positions so persisted state remains stable across reloads
    items.forEach((item, i) => (item.position = i))
    return true
  }

  function edit(id: string, text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    const item = items.find((i) => i.id === id)
    if (!item) return false
    if (item.state !== "queued") return false
    item.text = trimmed
    item.estimatedTokens = estimateTextTokens(trimmed)
    return true
  }

  function isNextReady(): boolean {
    return items.find((i) => i.state === "queued") !== undefined
  }

  function processNext(): QueueNextResult | null {
    const next = items.find((i) => i.state === "queued")
    if (!next) return null
    next.state = "sending"
    return { text: next.text, attachments: next.attachments }
  }

  function clear(): void {
    items.length = 0
  }

  return {
    getItems,
    enqueue,
    remove,
    edit,
    processNext,
    isNextReady,
    clear,
    reorder,
    moveToFront,
    moveToBack,
    getTotalEstimatedTokens,
    markAsSteer,
    persist,
    restore,
  }
}
