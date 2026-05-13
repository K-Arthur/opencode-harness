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
  getActiveCount: () => number
  reorder: (fromIndex: number, toIndex: number) => boolean
  moveToFront: (id: string) => boolean
  moveToBack: (id: string) => boolean
  getEstimatedTokens: (id: string) => number
  getTotalEstimatedTokens: () => number
  markAsSteer: (id: string) => boolean
  persist: () => QueueItem[]
  restore: (items: QueueItem[]) => void
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

  function reorder(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
      return false
    }
    const moved = items[fromIndex]
    if (!moved) return false
    items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)
    // Update positions
    items.forEach((item, idx) => item.position = idx)
    return true
  }

  function moveToFront(id: string): boolean {
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1 || idx === 0) return false
    const moved = items[idx]
    if (!moved) return false
    items.splice(idx, 1)
    items.unshift(moved)
    items.forEach((item, idx) => item.position = idx)
    return true
  }

  function moveToBack(id: string): boolean {
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1 || idx === items.length - 1) return false
    const moved = items[idx]
    if (!moved) return false
    items.splice(idx, 1)
    items.push(moved)
    items.forEach((item, idx) => item.position = idx)
    return true
  }

  function getEstimatedTokens(id: string): number {
    const item = items.find(i => i.id === id)
    return item?.estimatedTokens || 0
  }

  function getTotalEstimatedTokens(): number {
    return items.reduce((sum, item) => sum + (item.estimatedTokens || 0), 0)
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

  // Simple token estimation (rough approximation)
  function estimateTextTokens(text: string): number {
    // Approximate: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4)
  }

  function remove(id: string): boolean {
    const idx = items.findIndex((i) => i.id === id)
    if (idx === -1) return false
    if (items[idx]!.state === "sending" || items[idx]!.state === "streaming") return false
    items.splice(idx, 1)
    return true
  }

  function edit(id: string, text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    const item = items.find((i) => i.id === id)
    if (!item) return false
    if (item.state !== "queued") return false
    item.text = trimmed
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

  function getActiveCount(): number {
    return items.filter((i) => i.state === "sending" || i.state === "streaming").length
  }

  return { 
    getItems, 
    enqueue, 
    remove, 
    edit, 
    processNext, 
    isNextReady, 
    clear, 
    getActiveCount,
    reorder,
    moveToFront,
    moveToBack,
    getEstimatedTokens,
    getTotalEstimatedTokens,
    markAsSteer,
    persist,
    restore
  }
}
