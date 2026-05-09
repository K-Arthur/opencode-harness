import type { ChatMessage, SessionState } from "./types"

const PRUNE_THRESHOLD = 40
const KEEP_ALIVE_ABOVE = 15
const KEEP_ALIVE_BELOW = 15
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
            this.restoreMessage(msgId)
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
    if (this.observer) {
      this.observer.observe(el)
    }
  }

  private pruneOffScreen(): void {
    const allMessages = Array.from(this.container.querySelectorAll(MESSAGE_SELECTOR))
    const totalCount = allMessages.length
    if (totalCount <= PRUNE_THRESHOLD) return

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

    const pruneStart = Math.max(0, visibleStart - KEEP_ALIVE_ABOVE)
    const pruneEnd = Math.min(allMessages.length - 1, visibleEnd + KEEP_ALIVE_BELOW)

    for (let i = 0; i < pruneStart; i++) {
      this.detachMessage(allMessages[i] as HTMLElement)
    }
    for (let i = pruneEnd + 1; i < allMessages.length; i++) {
      this.detachMessage(allMessages[i] as HTMLElement)
    }
  }

  private detachMessage(el: HTMLElement): void {
    const msgId = el.dataset.messageId
    if (!msgId || el.classList.contains(PLACEHOLDER_CLASS)) return

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

    this.observer?.unobserve(el)
    el.replaceWith(placeholder)
  }

  private restoreMessage(msgId: string): void {
    const entry = this.entries.get(msgId)
    if (!entry || !entry.detached) return

    const msgData = this.getMessageData(msgId)
    if (!msgData) return

    const session = this.getSession()
    const opts = session ? { mode: session.mode, postMessage: (m: Record<string, unknown>) => {} } : undefined

    const newEl = this.renderMessage(msgData, opts)
    entry.placeholder.replaceWith(newEl)
    entry.detached = false
    this.entries.delete(msgId)
    this.observer?.observe(newEl)
  }

  restoreAll(): void {
    for (const [msgId, entry] of this.entries) {
      if (entry.detached) {
        const msgData = this.getMessageData(msgId)
        if (!msgData) continue

        const session = this.getSession()
        const opts = session ? { mode: session.mode, postMessage: (m: Record<string, unknown>) => {} } : undefined
        const newEl = this.renderMessage(msgData, opts)
        entry.placeholder.replaceWith(newEl)
        this.observer?.observe(newEl)
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
