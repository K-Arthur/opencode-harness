import type { TabInfo } from "./types"
import type { ElementRefs } from "./dom"

export interface TabCallbacks {
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

export function createTabBar(els: ElementRefs, callbacks: TabCallbacks) {
  // New tab button
  els.newTabBtn.addEventListener("click", () => callbacks.onNew())

  // Initial close buttons (e.g. the default tab)
  els.tabPanels.querySelectorAll(".tab-close").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const tab = btn.closest("vscode-panel-tab") as HTMLElement
      const tabId = tab?.dataset.tabId
      if (tabId) callbacks.onClose(tabId)
    })
  })

  // Listen for toolkit tab changes
  els.tabPanels.addEventListener("change", (e: Event) => {
    const target = e.target as HTMLElement & { activeid?: string }
    const tabId = target?.activeid
    if (tabId && tabId.startsWith("tab-")) {
      const realId = tabId.replace("tab-", "")
      callbacks.onSwitch(realId)
    }
  })

  function renderTabs(tabs: TabInfo[], activeId: string) {
    // With vscode-panels, we manage the children directly.
    // However, the tab buttons are already handled by the toolkit if we add vscode-panel-tab elements.
    // This function might need to be more surgical to avoid re-rendering everything.
    
    // For now, let's keep it simple: sync the vscode-panel-tab elements.
    const existingTabs = Array.from(els.tabPanels.querySelectorAll("vscode-panel-tab")) as any[]
    const tabIds = new Set(tabs.map(t => "tab-" + t.id))

    // Remove old tabs
    existingTabs.forEach(t => {
      if (!tabIds.has(t.id)) t.remove()
    })

    // Add/Update tabs
    tabs.forEach(tab => {
      let tEl = els.tabPanels.querySelector(`#tab-${tab.id}`) as any
      if (!tEl) {
        const [tabEl, viewEl] = createTabContent(tab.id, tab.name)
        // Attach close listener
        const closeBtn = tabEl.querySelector<HTMLElement>(".tab-close")
        if (closeBtn) {
          closeBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            callbacks.onClose(tab.id)
          })
        }
        els.tabPanels.appendChild(tabEl as Node)
        els.tabPanels.appendChild(viewEl as Node)
        tEl = tabEl
      } else {
        const label = tEl.querySelector(".tab-label")
        if (label) label.textContent = tab.name
      }

      if (tab.isStreaming) {
        tEl.classList.add("streaming")
      } else {
        tEl.classList.remove("streaming")
      }
    })

    els.tabPanels.setAttribute("activeid", "tab-" + activeId)
  }

  function updateTabName(tabId: string, name: string) {
    const tab = els.tabPanels.querySelector(`#tab-${tabId}`) as any
    if (tab) {
      const label = tab.querySelector(".tab-label")
      if (label) label.textContent = name
    }
  }

  function setTabStreaming(tabId: string, isStreaming: boolean) {
    const tab = els.tabPanels.querySelector(`#tab-${tabId}`) as any
    if (tab) {
      tab.classList.toggle("streaming", isStreaming)
    }
  }

  return {
    renderTabs,
    updateTabName,
    setTabStreaming,
  }
}

export function createTabContent(tabId: string, tabName: string): HTMLElement[] {
  const tab = document.createElement("vscode-panel-tab")
  tab.id = "tab-" + tabId
  tab.dataset.tabId = tabId
  
  const label = document.createElement("span")
  label.className = "tab-label"
  label.textContent = tabName
  tab.appendChild(label)

  const closeBtn = document.createElement("span")
  closeBtn.className = "tab-close"
  closeBtn.textContent = "\u00D7"
  // Note: Event listener will be attached by the caller or createTabBar
  tab.appendChild(closeBtn)

  const view = document.createElement("vscode-panel-view")
  view.id = "view-" + tabId
  view.dataset.tabId = tabId

  const messageList = document.createElement("div")
  messageList.className = "message-list custom-scrollbar"
  view.appendChild(messageList)

  const typingIndicator = document.createElement("div")
  typingIndicator.className = "typing-indicator hidden"
  typingIndicator.innerHTML = `
    <vscode-progress-ring></vscode-progress-ring>
    <span class="typing-text">Thinking...</span>
  `
  view.appendChild(typingIndicator)

  return [tab, view]
}

export function switchToTab(els: ElementRefs, tabId: string) {
  els.tabPanels.setAttribute("activeid", "tab-" + tabId)
}

export function removeTabContent(els: ElementRefs, tabId: string) {
  const tab = els.tabPanels.querySelector(`#tab-${tabId}`)
  const view = els.tabPanels.querySelector(`#view-${tabId}`)
  if (tab) tab.remove()
  if (view) view.remove()
}
