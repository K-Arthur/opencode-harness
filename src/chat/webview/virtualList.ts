import type { ChatMessage, SessionState } from "./types"

const BASE_PRUNE_THRESHOLD = 40
const LONG_SESSION_PRUNE_BONUS = 30
const RECENT_KEEP_COUNT = 8
const BASE_KEEP_ALIVE_ABOVE = 12
const BASE_KEEP_ALIVE_BELOW = 12
const MAX_KEEP_ALIVE_EACH_SIDE = 45
const PLACEHOLDER_CLASS = "msg-placeholder"
const MESSAGE_SELECTOR = "[data-message-id]"

interface VirtualListEntry {
  messageId: string
  placeholder: HTMLElement
  originalHeight: number
  detached: boolean
}

export class VirtualMessageList {
  private observer: IntersectionObserver | null = null
  private entries = new Map<string, VirtualListEntry>()
  private recentlyAdded: string[] = []
  private pruneScheduled = false
  private sessionId: string
  private container: HTMLElement
  private getMessageData: (id: string) => ChatMessage | undefined
  private getSession: () => SessionState | undefined
  private renderMessage: (msg: ChatMessage, opts: any) => HTMLDivElement

  constructor(
    sessionId: string,
    container: HTMLElement,
    getMessageData: (id: string) => ChatMessage | undefined,
    getSession: () => SessionState | undefined,
    renderMessage: (msg: ChatMessage, opts: any) => HTMLDivElement,
  ) {
    this.sessionId = sessionId
    this.container = container
    this.getMessageData = getMessageData
    this.getSession = getSession
    this.renderMessage = renderMessage
  }

  start(): void {
    if (this.observer) return

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const msgId = el.dataset.messageId
          if (!msgId) continue

          const vEntry = this.entries.get(msgId)
          if (vEntry && vEntry.detached && entry.isIntersecting) {
            this.restoreOne(msgId)
          }
        }

        if (!this.pruneScheduled) {
          this.pruneScheduled = true
          requestAnimationFrame(() => {
            this.pruneScheduled = false
            this.pruneOffScreen()
          })
        }
      },
      {
        root: this.container.parentElement,
        rootMargin: "500px 0px 500px 0px",
        threshold: 0,
      },
    )

    this.observeExisting()
  }

  private observeExisting(): void {
    const messages = this.container.querySelectorAll(MESSAGE_SELECTOR)
    for (const msgEl of Array.from(messages)) {
      if (msgEl.classList.contains(PLACEHOLDER_CLASS)) continue
      this.observer?.observe(msgEl)
    }
  }

  onMessageAdded(el: HTMLElement): void {
    const msgId = el.dataset.messageId
    if (msgId) {
      this.recentlyAdded = this.recentlyAdded.filter((id) => id !== msgId)
      this.recentlyAdded.push(msgId)
      if (this.recentlyAdded.length > RECENT_KEEP_COUNT) this.recentlyAdded.shift()
    }
    if (this.observer) {
      this.observer.observe(el)
    }
  }

  private pruneOffScreen(): void {
    const allMessages = Array.from(this.container.querySelectorAll(MESSAGE_SELECTOR)) as HTMLElement[]
    const totalCount = allMessages.length
    const session = this.getSession()
    const pruneThreshold = this.getPruneThreshold(totalCount, session)
    if (totalCount <= pruneThreshold) return

    const containerRect = this.container.parentElement?.getBoundingClientRect()
    if (!containerRect) return

    const viewportTop = containerRect.top
    const viewportBottom = containerRect.bottom

    let visibleStart = -1
    let visibleEnd = -1

    for (let i = 0; i < allMessages.length; i++) {
      const el = allMessages[i] as HTMLElement
      const rect = el.getBoundingClientRect()
      if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
        if (visibleStart === -1) visibleStart = i
        visibleEnd = i
      }
    }

    if (visibleStart === -1) return

    const { above, below } = this.getKeepAliveCounts(containerRect.height, totalCount, session)
    const pruneStart = this.findPruneStart(allMessages, visibleStart, above)
    const pruneEnd = this.findPruneEnd(allMessages, visibleEnd, below)

    for (let i = 0; i < pruneStart; i++) {
      this.detachMessage(allMessages[i] as HTMLElement)
    }
    for (let i = pruneEnd + 1; i < allMessages.length; i++) {
      this.detachMessage(allMessages[i] as HTMLElement)
    }
  }

  private getPruneThreshold(totalCount: number, session?: SessionState): number {
    const longSessionBonus = totalCount > 100 ? LONG_SESSION_PRUNE_BONUS : 0
    const streamingBonus = session?.isStreaming ? RECENT_KEEP_COUNT : 0
    return BASE_PRUNE_THRESHOLD + longSessionBonus + streamingBonus
  }

  private getKeepAliveCounts(viewportHeight: number, totalCount: number, session?: SessionState): { above: number; below: number } {
    const viewportRows = Number.isFinite(viewportHeight) && viewportHeight > 0
      ? Math.ceil(viewportHeight / 72)
      : 10
    const longSessionBoost = totalCount > 100 ? 8 : 0
    const streamingBoost = session?.isStreaming ? RECENT_KEEP_COUNT : 0
    const above = Math.min(MAX_KEEP_ALIVE_EACH_SIDE, BASE_KEEP_ALIVE_ABOVE + viewportRows + longSessionBoost)
    const below = Math.min(MAX_KEEP_ALIVE_EACH_SIDE, BASE_KEEP_ALIVE_BELOW + viewportRows + longSessionBoost + streamingBoost)
    return { above, below }
  }

  private findPruneStart(messages: HTMLElement[], visibleStart: number, keepAliveBudget: number): number {
    let budget = 0
    let index = visibleStart
    for (let i = visibleStart - 1; i >= 0; i--) {
      const el = messages[i]
      if (!el) continue
      if (this.mustKeepAttached(el)) {
        index = i
        continue
      }
      budget += this.messageComplexity(el)
      if (budget > keepAliveBudget) break
      index = i
    }
    return index
  }

  private findPruneEnd(messages: HTMLElement[], visibleEnd: number, keepAliveBudget: number): number {
    let budget = 0
    let index = visibleEnd
    for (let i = visibleEnd + 1; i < messages.length; i++) {
      const el = messages[i]
      if (!el) continue
      if (this.mustKeepAttached(el)) {
        index = i
        continue
      }
      budget += this.messageComplexity(el)
      if (budget > keepAliveBudget) break
      index = i
    }
    return index
  }

  private messageComplexity(el: HTMLElement): number {
    const msgId = el.dataset.messageId
    const msg = msgId ? this.getMessageData(msgId) : undefined
    if (!msg || !Array.isArray(msg.blocks)) return 1
    let score = 1
    for (const block of msg.blocks) {
      if (block.type === "text") score += Math.ceil((block.text || "").length / 1200)
      else if (block.type === "code") score += 3 + Math.ceil((block.code || "").length / 1600)
      else if (block.type === "diff") score += 5
      else if (block.type === "tool-call" || block.type === "tool_call" || block.type === "tool") score += 2
      else score += 1
    }
    return Math.max(1, Math.min(12, score))
  }

  private mustKeepAttached(el: HTMLElement): boolean {
    const msgId = el.dataset.messageId
    if (!msgId) return true
    if (this.recentlyAdded.includes(msgId)) return true
    if (el.matches(":focus-within")) return true
    if (el.querySelector(".streaming-text")) return true
    const session = this.getSession()
    const lastMessage = session?.messages?.[session.messages.length - 1]
    return Boolean(session?.isStreaming && lastMessage?.id === msgId)
  }

  private detachMessage(el: HTMLElement): void {
    const msgId = el.dataset.messageId
    if (!msgId || el.classList.contains(PLACEHOLDER_CLASS)) return
    if (this.mustKeepAttached(el)) return

    const height = el.offsetHeight
    if (height <= 0) return

    const placeholder = document.createElement("div")
    placeholder.className = `${PLACEHOLDER_CLASS} message-bubble`
    placeholder.dataset.messageId = msgId
    placeholder.style.height = `${height}px`
    placeholder.setAttribute("aria-hidden", "true")

    this.entries.set(msgId, {
      messageId: msgId,
      placeholder,
      originalHeight: height,
      detached: true,
    })

    try {
      this.observer?.unobserve(el)
      el.replaceWith(placeholder)
    } catch {
      this.entries.delete(msgId)
    }
  }

  private restoreOne(msgId: string): void {
    const entry = this.entries.get(msgId)
    if (!entry || !entry.detached) return

    const msgData = this.getMessageData(msgId)
    if (!msgData) return

    const session = this.getSession()
    const opts = session ? { mode: session.mode, postMessage: (m: Record<string, unknown>) => {}, skipHeader: true } : undefined

    try {
      const newEl = this.renderMessage(msgData, opts)
      entry.placeholder.replaceWith(newEl)
      entry.detached = false
      this.entries.delete(msgId)
      this.observer?.observe(newEl)
    } catch {
      this.entries.delete(msgId)
    }
  }

  restoreAll(): void {
    for (const [msgId, entry] of this.entries) {
      if (entry.detached) {
        const msgData = this.getMessageData(msgId)
        if (!msgData) continue

        const session = this.getSession()
        const opts = session ? { mode: session.mode, postMessage: (m: Record<string, unknown>) => {}, skipHeader: true } : undefined
        try {
          const newEl = this.renderMessage(msgData, opts)
          entry.placeholder.replaceWith(newEl)
          this.observer?.observe(newEl)
        } catch {
          entry.detached = false
        }
      }
    }
    this.entries.clear()
  }

  dispose(): void {
    this.restoreAll()
    this.observer?.disconnect()
    this.observer = null
  }
}

const virtualLists = new Map<string, VirtualMessageList>()

export function getVirtualList(sessionId: string): VirtualMessageList | undefined {
  return virtualLists.get(sessionId)
}

export function createVirtualList(
  sessionId: string,
  container: HTMLElement,
  getMessageData: (id: string) => ChatMessage | undefined,
  getSession: () => SessionState | undefined,
  renderMessage: (msg: ChatMessage, opts: any) => HTMLDivElement,
): VirtualMessageList {
  disposeVirtualList(sessionId)
  const vl = new VirtualMessageList(sessionId, container, getMessageData, getSession, renderMessage)
  virtualLists.set(sessionId, vl)
  return vl
}

export function disposeVirtualList(sessionId: string): void {
  const vl = virtualLists.get(sessionId)
  if (vl) {
    vl.dispose()
    virtualLists.delete(sessionId)
  }
}
