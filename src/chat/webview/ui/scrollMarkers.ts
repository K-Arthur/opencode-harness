export interface ScrollMarkerDeps {
  getMessageList: (sessionId: string) => HTMLElement | null
  getActiveMessageList: () => HTMLElement | null
  getSession: (sessionId: string) => { messages: Array<{ role: string; id?: string; blocks?: Array<{ type: string; text?: string }> }> } | undefined
  timers: { setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> }
}

export function updateScrollMarkers(deps: ScrollMarkerDeps, sessionId: string): void {
  const msgList = deps.getMessageList(sessionId)
  if (!msgList) return
  const session = deps.getSession(sessionId)
  if (!session) return

  let markersEl = msgList.querySelector(".scroll-markers") as HTMLElement | null
  if (!markersEl) {
    markersEl = document.createElement("div")
    markersEl.className = "scroll-markers"
    markersEl.dataset.tabId = sessionId
    msgList.appendChild(markersEl)
  }

  markersEl.replaceChildren()
  const totalHeight = msgList.scrollHeight || 1
  if (session.messages.length < 3) return

  session.messages.forEach((m) => {
    if (m.role !== "user" || !m.id) return
    const msgEl = msgList.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`) as HTMLElement | null
    if (!msgEl) return
    const offsetTop = msgEl.offsetTop
    const ratio = Math.min(1, Math.max(0, offsetTop / totalHeight))
    const dot = document.createElement("div")
    dot.className = "scroll-marker-dot"
    dot.style.top = `calc(${ratio * 100}% - 2px)`
    const firstText = m.blocks?.find((b) => b.type === "text")
    dot.title = (firstText?.text as string)?.slice(0, 60) || "User message"
    dot.addEventListener("click", () => {
      scrollMessageToTop(msgList, msgEl, deps.timers)
    })
    markersEl.appendChild(dot)
  })
}

export function setupJumpToBottom(deps: ScrollMarkerDeps, sessionId: string): void {
  const msgList = deps.getMessageList(sessionId)
  if (!msgList) return
  const existing = msgList.parentElement?.querySelector(".jump-to-bottom")
  if (existing) existing.remove()
  const btn = document.createElement("button")
  btn.className = "jump-to-bottom"
  btn.dataset.tabId = sessionId
  btn.textContent = "↓ Latest"
  btn.setAttribute("aria-label", "Jump to latest message")
  const onScroll = () => {
    const threshold = 300
    const isNearBottom = msgList.scrollHeight - (msgList.scrollTop + msgList.clientHeight) < threshold
    btn.classList.toggle("visible", !isNearBottom)
  }
  btn.addEventListener("click", () => {
    msgList.scrollTo({ top: msgList.scrollHeight, behavior: "smooth" })
    btn.classList.remove("visible")
  })
  msgList.parentElement?.appendChild(btn)
  msgList.addEventListener("scroll", onScroll, { passive: true })
  onScroll()
}

export function scrollMessageToTop(msgList: HTMLElement, target: HTMLElement, timers?: { setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> }): void {
  const _setTimeout = timers?.setTimeout ?? setTimeout
  msgList.scrollTo({ top: Math.max(0, target.offsetTop), behavior: "smooth" })
  target.classList.add("message-flash")
  _setTimeout(() => target.classList.remove("message-flash"), 1500)
  target.setAttribute("tabindex", "-1")
  target.focus({ preventScroll: true })
}

/** Scroll the active list to a message. Returns false when the message has no
 *  DOM node (e.g. an earlier page that is not loaded yet) so callers can
 *  trigger a load-then-scroll flow instead of failing silently. */
export function scrollToTurn(deps: ScrollMarkerDeps, messageId: string): boolean {
  const msgList = deps.getActiveMessageList()
  if (!msgList) return false
  const target = msgList.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null
  if (!target) return false
  scrollMessageToTop(msgList, target, deps.timers)
  return true
}
