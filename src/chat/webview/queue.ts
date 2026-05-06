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
    }
    items.push(item)
    return item
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

  return { getItems, enqueue, remove, edit, processNext, isNextReady, clear, getActiveCount }
}
