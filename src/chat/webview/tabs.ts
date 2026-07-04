import type { ElementRefs } from "./dom"
import { REMOVE_SVG } from "./icons"
import { notifyTabActivated } from "./visibilityGate"

export interface TabCallbacks {
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

export function createTabBar(els: ElementRefs, callbacks: TabCallbacks) {
  els.newTabBtn.addEventListener("click", () => callbacks.onNew())

  // Tab close via event delegation on tab bar.
  // Use closest() so clicks on the SVG/path inside .tab-close still fire —
  // classList.contains on the direct target misses SVG children (the click
  // target is usually the inner <path>, not the .tab-close span itself).
  els.tabBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const closeEl = target.closest(".tab-close")
    if (closeEl) {
      e.stopPropagation()
      e.preventDefault()
      const tabBtn = closeEl.closest(".tab-btn") as HTMLElement
      const tabId = tabBtn?.dataset.tabId
      if (tabId) callbacks.onClose(tabId)
    }
  })

  // Tab switch via delegation on tab bar.
  // Use closest() for the .tab-close guard too, so a click on the SVG inside
  // .tab-close doesn't fall through to the switch handler.
  els.tabBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const tabBtn = target.closest(".tab-btn") as HTMLElement
    if (!tabBtn || target.closest(".tab-close")) return
    const tabId = tabBtn.dataset.tabId
    if (tabId) callbacks.onSwitch(tabId)
  })

  // Keyboard navigation for tabs (APG Tabs pattern)
  els.tabBar.addEventListener("keydown", (e) => {
    const tabs = Array.from(els.tabBar.querySelectorAll<HTMLElement>(".tab-btn"))
    const activeTab = els.tabBar.querySelector<HTMLElement>(".tab-btn.active")
    if (!activeTab || tabs.length === 0) return

    let currentIndex = tabs.indexOf(activeTab)
    let nextIndex = currentIndex

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault()
        nextIndex = (currentIndex + 1) % tabs.length
        break
      case "ArrowLeft":
        e.preventDefault()
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
        break
      case "Home":
        e.preventDefault()
        nextIndex = 0
        break
      case "End":
        e.preventDefault()
        nextIndex = tabs.length - 1
        break
      case "Tab":
        // Let Tab exit the tablist normally
        return
      default:
        return
    }

    if (nextIndex !== currentIndex) {
      const nextTab = tabs[nextIndex]
      if (nextTab) {
        const tabId = nextTab.dataset.tabId
        if (tabId) callbacks.onSwitch(tabId)
        nextTab.focus()
      }
    }
  })

  function renderTabs(
    tabs: Array<{ id: string; name: string; isStreaming?: boolean }>,
    activeId: string,
    streamCapacity?: { activeStreams: number; maxStreams: number; isFull: boolean; reason?: string }
  ) {
    const tabContainer = els.tabBar
    const newTabBtnId = "tab-bar-new-btn"
    
    // Clear and re-render to ensure perfect order based on sessionOrder
    // We keep existing buttons to preserve event listeners if needed, but here we use delegation
    // so clearing is safer for order.
    tabContainer.innerHTML = ""

    tabs.forEach((tab) => {
      const btn = document.createElement("button")
      const isActive = tab.id === activeId
      
      btn.className = `tab-btn ${isActive ? "active" : ""} ${tab.isStreaming ? "streaming" : ""}`
      btn.setAttribute("role", "tab")
      btn.dataset.tabId = tab.id
      btn.id = `tab-${tab.id}`
      btn.setAttribute("aria-selected", String(isActive))
      btn.setAttribute("aria-controls", `panel-${tab.id}`)
      btn.setAttribute("tabindex", isActive ? "0" : "-1")

      const indicator = document.createElement("span")
      indicator.className = `tab-indicator ${tab.isStreaming ? "tab-indicator--streaming" : ""}`
      btn.appendChild(indicator)

      const label = document.createElement("span")
      label.className = "tab-label"
      const displayName = tab.name || "Untitled session"
      label.textContent = displayName
      label.title = displayName
      btn.appendChild(label)

      const close = document.createElement("span")
      close.className = "tab-close"
      close.setAttribute("aria-label", `Close ${displayName}`)
      close.innerHTML = REMOVE_SVG
      btn.appendChild(close)

      tabContainer.appendChild(btn)
    })

    if (streamCapacity && streamCapacity.activeStreams > 0) {
      const streamLimit = document.createElement("span")
      streamLimit.className = `tab-stream-limit${streamCapacity.isFull ? " tab-stream-limit--full" : ""}`
      streamLimit.textContent = `${streamCapacity.activeStreams}/${streamCapacity.maxStreams} streaming`
      streamLimit.title = streamCapacity.reason || `${streamCapacity.activeStreams} active stream(s)`
      streamLimit.setAttribute("role", "status")
      streamLimit.setAttribute("aria-label", streamLimit.title)
      tabContainer.appendChild(streamLimit)
    }

    // Add Integrated New Tab Button
    const newBtn = document.createElement("button")
    newBtn.id = newTabBtnId
    newBtn.className = "tab-new-integrated"
    newBtn.title = "New session"
    newBtn.setAttribute("aria-label", "New session")
    newBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
    newBtn.onclick = (e) => {
      e.stopPropagation()
      callbacks.onNew()
    }
    tabContainer.appendChild(newBtn)

    // Sync panels visibility and remove orphan panels
    const sessionIds = new Set(tabs.map(t => t.id))
    Array.from(els.tabPanels.children).forEach((child) => {
      const panel = child as HTMLElement
      const id = panel.dataset.tabId
      if (id && !sessionIds.has(id)) {
        panel.remove()
      } else {
        panel.classList.toggle("active", id === activeId)
      }
    })
  }

  return { renderTabs }
}

/**
 * Patch a single tab's label text in place, WITHOUT the full-teardown
 * `renderTabs` rebuild (which wipes focus, IME composition state, scroll
 * markers, and stream indicators on every other tab in the strip).
 *
 * Use this for the common case of a single session's title updating
 * (server-side `session.updated` arriving, user-initiated rename,
 * programmatic auto-title from first message). Use `renderTabs` only for
 * structural changes: create, close, reorder, active-tab switch, stream
 * capacity badge changes.
 *
 * Returns true if the tab was found and patched, false if no tab with that
 * id exists (caller should fall back to renderTabs / hydrate-on-init).
 */
export function patchTabLabel(els: ElementRefs, tabId: string, newName: string): boolean {
  const escaped = CSS.escape(tabId)
  const btn = els.tabBar.querySelector<HTMLElement>(`.tab-btn[data-tab-id="${escaped}"]`)
  if (!btn) return false
  const displayName = newName || "Untitled session"
  const label = btn.querySelector<HTMLElement>(".tab-label")
  if (label) {
    label.textContent = displayName
    label.title = displayName
  }
  const close = btn.querySelector<HTMLElement>(".tab-close")
  if (close) {
    close.setAttribute("aria-label", `Close ${displayName}`)
  }
  return true
}

export function createTabContent(tabId: string, _tabName: string, _callbacks: TabCallbacks): HTMLElement[] {
  const view = document.createElement("div")
  view.className = "tab-panel"
  view.dataset.tabId = tabId
  view.setAttribute("role", "tabpanel")
  view.id = `panel-${tabId}`
  view.setAttribute("aria-labelledby", `tab-${tabId}`)

  const messageList = document.createElement("div")
  messageList.className = "message-list custom-scrollbar"
  messageList.setAttribute("role", "log")
  messageList.setAttribute("aria-label", "Chat messages")
  messageList.setAttribute("aria-live", "polite")

  view.appendChild(messageList)
  const typingIndicator = document.createElement("div")
  typingIndicator.className = "typing-indicator hidden"
  typingIndicator.setAttribute("role", "status")
  typingIndicator.setAttribute("aria-label", "OpenCode is thinking")

  const typingText = document.createElement("span")
  typingText.className = "typing-text"
  typingText.textContent = "Thinking..."
  typingIndicator.appendChild(typingText)

  view.appendChild(typingIndicator)

  return [view]
}

export function switchToTab(els: ElementRefs, tabId: string) {
  // Deactivate all panels
  Array.from(els.tabPanels.children).forEach((child) => {
    child.classList.remove("active")
  })

  // Activate target panel
  const panel = els.tabPanels.querySelector(`.tab-panel[data-tab-id="${tabId}"]`)
  if (panel) panel.classList.add("active")

  // Trigger deferred flushes for streams that accumulated text while hidden
  notifyTabActivated(tabId)

  // Update tab bar
  Array.from(els.tabBar.children).forEach((child) => {
    const btn = child as HTMLElement
    const isActive = btn.dataset.tabId === tabId
    btn.classList.toggle("active", isActive)
    btn.setAttribute("aria-selected", String(isActive))
  })
}

export function removeTabContent(els: ElementRefs, tabId: string) {
  const panel = els.tabPanels.querySelector(`.tab-panel[data-tab-id="${tabId}"]`)
  if (panel) panel.remove()

  const btn = els.tabBar.querySelector(`.tab-btn[data-tab-id="${tabId}"]`)
  if (btn) btn.remove()
}
