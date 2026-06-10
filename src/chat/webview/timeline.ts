import type { WebviewState, ChatMessage } from "./types"
import type { ElementRefs } from "./dom"
import { groupMessagesIntoTurns } from "./renderer"
import { createThinkingToggle, type ThinkingToggleDeps } from "./thinkingToggle"

const HISTORY_CONDENSATION_THRESHOLD = 140
const HISTORY_PRESERVE_LAST = 80
const HISTORY_GROUP_SIZE = 20

export interface TimelineDeps {
  els: ElementRefs
  getState: () => WebviewState
  getSession: (id: string) => { messages: ChatMessage[]; isStreaming: boolean } | undefined
  isTimelineVisible: () => boolean
  setTimelineVisible: (visible: boolean) => void
  getMessageList: (tabId: string) => HTMLDivElement | null
  /** Returns false when the turn's message has no DOM node (unloaded page). */
  scrollToTurn: (messageId: string) => boolean
  /** Invoked when the user clicks a turn whose message is not rendered —
   *  expected to load the missing history and scroll once it arrives. */
  onUnloadedTurnClick?: (sessionId: string, messageId: string) => void
  setThinkingVisible: (visible: boolean) => void
  getThinkingVisible: () => boolean
  toggleAllThinkingBlocks: (visible: boolean) => void
  vscodeSetState: (state: WebviewState) => void
  debouncedUpdateScrollMarkers: (sessionId: string) => void
}

export { type ThinkingToggleDeps }

export interface TimelineAPI {
  setupTimelineToggle: () => void
  setupThinkingToggle: () => void
  applyTimelineVisibility: (sessionId?: string) => void
  refreshConversationTimeline: (sessionId?: string) => void
  applyHistoryCondensation: (sessionId: string) => void
}

export function createTimeline(deps: TimelineDeps): TimelineAPI {
  const {
    els,
    getState,
    getSession,
    isTimelineVisible,
    setTimelineVisible,
    getMessageList,
    scrollToTurn,
    setThinkingVisible,
    getThinkingVisible,
    toggleAllThinkingBlocks,
    vscodeSetState,
    debouncedUpdateScrollMarkers,
  } = deps

  const thinkingToggle = createThinkingToggle({
    els,
    getState,
    setThinkingVisible,
    getThinkingVisible,
    toggleAllThinkingBlocks,
    vscodeSetState,
  })

  function setupTimelineToggle() {
    const headerBtn = (els as { timelineToggleHeaderBtn?: HTMLElement | null }).timelineToggleHeaderBtn ?? null
    const syncPressed = () => {
      const pressed = String(isTimelineVisible())
      els.timelineToggleBtn.setAttribute("aria-pressed", pressed)
      headerBtn?.setAttribute("aria-pressed", pressed)
    }
    const toggle = () => {
      setTimelineVisible(!isTimelineVisible())
      syncPressed()
      applyTimelineVisibility()
    }
    syncPressed()
    els.timelineToggleBtn.addEventListener("click", toggle)
    // Discoverability: the same toggle also lives in the header toolbar.
    headerBtn?.addEventListener("click", toggle)
    applyTimelineVisibility()
  }

  function setupThinkingToggle() {
    thinkingToggle.setup()
  }

  function applyTimelineVisibility(sessionId?: string) {
    const targetId = sessionId || getState().activeSessionId || undefined
    const welcomeVisible = !els.welcomeView.classList.contains("hidden")
    const visible = isTimelineVisible() && !welcomeVisible

    els.timelineToggleBtn.classList.toggle("active", visible)
    els.timelineToggleBtn.setAttribute("aria-pressed", String(visible))
    els.timelineToggleBtn.classList.toggle("hidden", welcomeVisible)
    const headerBtn = (els as { timelineToggleHeaderBtn?: HTMLElement | null }).timelineToggleHeaderBtn ?? null
    if (headerBtn) {
      headerBtn.classList.toggle("active", visible)
      headerBtn.setAttribute("aria-pressed", String(visible))
      headerBtn.classList.toggle("hidden", welcomeVisible)
    }

    document.querySelectorAll(".message-list.timeline-visible").forEach((el) => el.classList.remove("timeline-visible"))
    document.querySelectorAll(".conversation-timeline.visible").forEach((el) => el.classList.remove("visible"))

    if (!visible || !targetId) return
    refreshConversationTimeline(targetId)
  }

  let progressRafId: number | null = null

  function scheduleProgressUpdate(sessionId: string) {
    if (progressRafId !== null) {
      cancelAnimationFrame(progressRafId)
    }
    progressRafId = requestAnimationFrame(() => {
      progressRafId = null
      updateTimelineProgress(sessionId)
    })
  }

  function refreshConversationTimeline(sessionId?: string) {
    const targetId = sessionId || getState().activeSessionId || undefined
    if (!targetId || !isTimelineVisible()) return

    const session = getSession(targetId)
    const msgList = getMessageList(targetId)
    const timeline = ensureTimeline(targetId)
    if (!session || !msgList || !timeline) return

    const turns = groupMessagesIntoTurns(session.messages)
    timeline.replaceChildren()
    msgList.classList.toggle("timeline-visible", turns.length > 0)
    timeline.classList.toggle("visible", turns.length > 0)
    if (turns.length === 0) return

    const progress = document.createElement("div")
    progress.className = "timeline-progress"
    timeline.appendChild(progress)

    const header = document.createElement("div")
    header.className = "timeline-header"
    header.textContent = "Conversation Timeline"
    timeline.appendChild(header)

    turns.forEach((turn, index) => {
      const item = document.createElement("button")
      item.type = "button"
      item.className = "timeline-item"
      item.dataset.messageId = turn.userMessageId
      // Lazy loading keeps earlier pages out of the DOM; dim those turns so
      // the user can tell which jumps will trigger a history load.
      const loaded = Boolean(msgList.querySelector(`[data-message-id="${CSS.escape(turn.userMessageId)}"]`))
      if (!loaded) item.classList.add("timeline-item--unloaded")
      item.setAttribute("aria-label", loaded
        ? `Jump to turn ${index + 1}: ${turn.snippet}`
        : `Load earlier history and jump to turn ${index + 1}: ${turn.snippet}`)

      const role = document.createElement("span")
      role.className = "timeline-item-role"
      const dot = document.createElement("span")
      dot.className = "role-dot user"
      role.appendChild(dot)
      const label = document.createElement("span")
      label.textContent = `Turn ${index + 1}`
      role.appendChild(label)
      item.appendChild(role)

      const preview = document.createElement("span")
      preview.className = "timeline-item-preview" + (turn.toolCount > 0 ? " has-tool" : "")
      preview.textContent = turn.toolCount > 0 ? `${turn.snippet} (${turn.toolCount} tools)` : turn.snippet
      item.appendChild(preview)

      item.addEventListener("click", () => {
        if (scrollToTurn(turn.userMessageId)) {
          scheduleProgressUpdate(targetId)
          return
        }
        // Target not in the DOM: it may sit inside a condensed history group —
        // expand those and retry — otherwise hand off to the load-then-scroll
        // flow so the click never dies silently.
        const summaries = Array.from(msgList.querySelectorAll<HTMLElement>(".history-condensed-summary"))
        for (const summary of summaries) summary.click()
        if (summaries.length > 0 && scrollToTurn(turn.userMessageId)) {
          scheduleProgressUpdate(targetId)
          return
        }
        deps.onUnloadedTurnClick?.(targetId, turn.userMessageId)
      })
      timeline.appendChild(item)
    })

    if (!timeline.dataset.keyListener) {
      timeline.dataset.keyListener = "true"
      timeline.addEventListener("keydown", (e) => {
        const items = Array.from(timeline!.querySelectorAll<HTMLElement>(".timeline-item"))
        if (items.length === 0) return
        const focused = timeline!.querySelector<HTMLElement>(".timeline-item:focus")
        const idx = focused ? items.indexOf(focused) : -1
        if (e.key === "ArrowDown") {
          e.preventDefault()
          items[Math.min(idx + 1, items.length - 1)]?.focus()
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          items[Math.max(idx - 1, 0)]?.focus()
        } else if (e.key === "Home") {
          e.preventDefault()
          items[0]?.focus()
        } else if (e.key === "End") {
          e.preventDefault()
          items[items.length - 1]?.focus()
        }
      })
    }

    if (!msgList.dataset.timelineListener) {
      msgList.dataset.timelineListener = "true"
      msgList.addEventListener("scroll", () => scheduleProgressUpdate(targetId), { passive: true })
    }
    scheduleProgressUpdate(targetId)
  }

  function ensureTimeline(sessionId: string): HTMLElement | null {
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)
    if (!view) return null
    let timeline = view.querySelector<HTMLElement>(".conversation-timeline")
    if (!timeline) {
      timeline = document.createElement("aside")
      timeline.className = "conversation-timeline"
      timeline.setAttribute("role", "navigation")
      timeline.setAttribute("aria-label", "Conversation turns")
      view.appendChild(timeline)
    }
    return timeline
  }

  function updateTimelineProgress(sessionId: string) {
    const msgList = getMessageList(sessionId)
    const timeline = ensureTimeline(sessionId)
    if (!msgList || !timeline) return
    const progress = timeline.querySelector<HTMLElement>(".timeline-progress")
    const total = Math.max(1, msgList.scrollHeight - msgList.clientHeight)
    const ratio = Math.min(1, Math.max(0, msgList.scrollTop / total))
    if (progress) progress.style.setProperty("--p", ratio.toFixed(3))

    const items = Array.from(timeline.querySelectorAll<HTMLElement>(".timeline-item"))
    let active: HTMLElement | null = null
    for (const item of items) {
      const id = item.dataset.messageId
      if (!id) continue
      const target = msgList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
      if (target && target.offsetTop <= msgList.scrollTop + 48) active = item
    }
    items.forEach((item) => item.classList.toggle("active", item === active))
  }

  function applyHistoryCondensation(sessionId: string): void {
    const session = getSession(sessionId)
    const msgList = getMessageList(sessionId)
    if (!session || !msgList || session.isStreaming || session.messages.length <= HISTORY_CONDENSATION_THRESHOLD) return
    if (msgList.dataset.historyCondensed === "true" || msgList.dataset.historyCondensed === "expanded") return

    const candidates = session.messages.slice(0, Math.max(0, session.messages.length - HISTORY_PRESERVE_LAST))
    for (let i = Math.floor(Math.max(0, candidates.length - 1) / HISTORY_GROUP_SIZE) * HISTORY_GROUP_SIZE; i >= 0; i -= HISTORY_GROUP_SIZE) {
      const group = candidates.slice(i, Math.min(candidates.length, i + HISTORY_GROUP_SIZE))
      const elements = group
        .map((m) => m.id ? msgList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(m.id)}"]`) : null)
        .filter((el: HTMLElement | null): el is HTMLElement => Boolean(el && !el.matches(":focus-within") && !el.querySelector(".streaming-text")))
      if (elements.length < HISTORY_GROUP_SIZE / 2) continue

      const summary = document.createElement("button")
      summary.type = "button"
      summary.className = "history-condensed-summary"
      const userCount = group.filter((m) => m.role === "user").length
      const assistantCount = group.filter((m) => m.role === "assistant").length
      const toolCount = group.reduce((count: number, m) => count + (m.blocks || []).filter((b) => b.type === "tool-call" || b.type === "tool_call" || b.type === "tool").length, 0)
      summary.textContent = `${group.length} earlier messages: ${userCount} user, ${assistantCount} assistant${toolCount ? `, ${toolCount} tools` : ""}`
      summary.setAttribute("aria-expanded", "false")

      const fragment = document.createDocumentFragment()
      for (const el of elements) fragment.appendChild(el)
      summary.addEventListener("click", () => {
        summary.setAttribute("aria-expanded", "true")
        summary.replaceWith(fragment)
        msgList.dataset.historyCondensed = "expanded"
        debouncedUpdateScrollMarkers(sessionId)
      }, { once: true })

      const firstRemaining = msgList.firstElementChild
      if (firstRemaining) msgList.insertBefore(summary, firstRemaining)
      else msgList.appendChild(summary)
    }
    msgList.dataset.historyCondensed = "true"
  }

  return {
    setupTimelineToggle,
    setupThinkingToggle,
    applyTimelineVisibility,
    refreshConversationTimeline,
    applyHistoryCondensation,
  }
}
