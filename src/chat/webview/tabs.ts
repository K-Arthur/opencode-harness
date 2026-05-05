import type { ElementRefs } from "./dom"

export interface TabCallbacks {
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

export function createTabBar(els: ElementRefs, callbacks: TabCallbacks) {
  els.newTabBtn.addEventListener("click", () => callbacks.onNew())

  // Tab close via event delegation on tab bar
  els.tabBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    if (target.classList.contains("tab-close")) {
      e.stopPropagation()
      e.preventDefault()
      const tabBtn = target.closest(".tab-btn") as HTMLElement
      const tabId = tabBtn?.dataset.tabId
      if (tabId) callbacks.onClose(tabId)
    }
  })

  // Tab switch via delegation on tab bar
  els.tabBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const tabBtn = target.closest(".tab-btn") as HTMLElement
    if (!tabBtn || target.classList.contains("tab-close")) return
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

  function renderTabs(tabs: Array<{ id: string; name: string; isStreaming?: boolean }>, activeId: string) {
    const existingIds = new Set(Array.from(els.tabBar.children).map((c) => (c as HTMLElement).dataset.tabId))
    const newIds = new Set(tabs.map((t) => t.id))

    // Remove tabs that no longer exist
    Array.from(els.tabBar.children).forEach((child) => {
      const btn = child as HTMLElement
      if (btn.dataset.tabId && !newIds.has(btn.dataset.tabId)) {
        btn.remove()
      }
    })

    // Remove panels that no longer exist
    Array.from(els.tabPanels.children).forEach((child) => {
      const panel = child as HTMLElement
      if (panel.dataset.tabId && !newIds.has(panel.dataset.tabId)) {
        panel.remove()
      }
    })

    // Add/update tabs - newest/active first (leftmost)
    for (let i = tabs.length - 1; i >= 0; i--) {
      const tab = tabs[i]!
      const existing = els.tabBar.querySelector(`.tab-btn[data-tab-id="${tab.id}"]`) as HTMLElement | null
      if (!existing) {
        const btn = document.createElement("button")
        btn.className = "tab-btn"
        btn.setAttribute("role", "tab")
        btn.dataset.tabId = tab.id
        btn.setAttribute("aria-selected", tab.id === activeId ? "true" : "false")
        btn.setAttribute("tabindex", tab.id === activeId ? "0" : "-1")

        const indicator = document.createElement("span")
        indicator.className = "tab-indicator"
        btn.appendChild(indicator)

        const label = document.createElement("span")
        label.className = "tab-label"
        label.textContent = tab.name
        label.title = tab.name
        btn.appendChild(label)

        const close = document.createElement("span")
        close.className = "tab-close"
        close.setAttribute("aria-label", `Close ${tab.name}`)
        close.textContent = "\u00D7"
        btn.appendChild(close)

        els.tabBar.insertBefore(btn, els.tabBar.firstChild)
      }
    }

    // Update active state
    Array.from(els.tabBar.children).forEach((child) => {
      const btn = child as HTMLElement
      const id = btn.dataset.tabId
      const isActive = id === activeId
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-selected", String(isActive))
      btn.setAttribute("tabindex", isActive ? "0" : "-1")

      const tabData = tabs.find((t) => t.id === id)
      const indicator = btn.querySelector(".tab-indicator")
      if (indicator) {
        indicator.className = "tab-indicator"
        if (tabData?.isStreaming) {
          btn.classList.add("streaming")
          indicator.classList.add("tab-indicator--streaming")
        } else {
          btn.classList.remove("streaming")
        }
      }
    })

    // Show active panel, hide others
    Array.from(els.tabPanels.children).forEach((child) => {
      const panel = child as HTMLElement
      const id = panel.dataset.tabId
      panel.classList.toggle("active", id === activeId)
    })
  }

  return { renderTabs }
}

export function createTabContent(tabId: string, tabName: string): HTMLElement[] {
  const view = document.createElement("div")
  view.className = "tab-panel"
  view.dataset.tabId = tabId

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
