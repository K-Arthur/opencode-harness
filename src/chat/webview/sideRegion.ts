export type SideTabId = "todos" | "activity" | "tasks" | "subagent"

const STORAGE_KEY_PREFIX = "oc:side-panel-expanded:"

export interface SideRegionOptions {
  onTabChange?: (tab: SideTabId) => void
}

export interface SideRegionApi {
  isOpen(): boolean
  open(tab?: SideTabId): void
  close(): void
  toggle(tab?: SideTabId): void
  switchTab(tab: SideTabId): void
  getActiveTab(): SideTabId | null
}

const TAB_ORDER: SideTabId[] = ["todos", "activity", "tasks", "subagent"]

export function setupSideRegion(
  regionEl: HTMLElement,
  tabBarEl: HTMLElement | null,
  tabButtons: NodeListOf<HTMLElement>,
  paneMap: Record<SideTabId, HTMLElement>,
  pinBtn: HTMLElement,
  closeBtn: HTMLElement,
  options?: SideRegionOptions,
): SideRegionApi {
  let isPinned = false
  let activeTab: SideTabId | null = null

  function isExpanded(tab: SideTabId): boolean {
    const val = sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${tab}`)
    if (val === null) {
      return tab === "todos" // Default: 'todos' expanded, others collapsed
    }
    return val === "true"
  }

  function setExpanded(tab: SideTabId, expanded: boolean): void {
    sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${tab}`, String(expanded))
    const pane = paneMap[tab]
    const btn = Array.from(tabButtons).find((b) => b.dataset.tab === tab)
    if (pane) {
      pane.classList.toggle("expanded", expanded)
      pane.classList.toggle("collapsed", !expanded)
      // Accordion layout removes .hidden so they stack vertically
      pane.classList.remove("hidden")
    }
    if (btn) {
      btn.setAttribute("aria-expanded", String(expanded))
      btn.classList.toggle("active", expanded)
    }
    if (expanded) {
      activeTab = tab
      options?.onTabChange?.(tab)
    }
  }

  function isOpen(): boolean {
    return !regionEl.classList.contains("hidden")
  }

  function open(tab?: SideTabId): void {
    regionEl.classList.remove("hidden")
    if (tab) {
      setExpanded(tab, true)
    } else {
      // Ensure the UI matches stored states on open
      TAB_ORDER.forEach((t) => {
        setExpanded(t, isExpanded(t))
      })
    }
  }

  function close(): void {
    if (isPinned) return
    regionEl.classList.add("hidden")
  }

  function toggle(tab?: SideTabId): void {
    if (!tab) {
      if (isOpen()) close()
      else open()
      return
    }
    if (!isOpen()) {
      open(tab)
    } else {
      setExpanded(tab, !isExpanded(tab))
    }
  }

  // switchTab will be called when the user opens a tab explicitly.
  // We expand the target tab and make sure the sidebar is open.
  function switchTab(tab: SideTabId): void {
    if (!isOpen()) {
      open(tab)
    } else {
      setExpanded(tab, true)
    }
  }

  function getActiveTab(): SideTabId | null {
    if (activeTab && isExpanded(activeTab)) {
      return activeTab
    }
    // Fallback to first expanded tab found
    return TAB_ORDER.find((t) => isExpanded(t)) || null
  }

  // Pin button
  pinBtn.addEventListener("click", () => {
    isPinned = !isPinned
    pinBtn.setAttribute("aria-pressed", String(isPinned))
    pinBtn.title = isPinned ? "Unpin panel" : "Pin panel"
  })

  // Close button
  closeBtn.addEventListener("click", () => close())

  // Tab (accordion header) clicks
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as SideTabId | undefined
      if (tab) {
        toggle(tab)
      }
    })
  })

  // Escape key
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && isOpen() && !isPinned) {
      close()
    }
  }
  document.addEventListener("keydown", onKeyDown)

  // Initialize expanded/collapsed states in DOM
  TAB_ORDER.forEach((t) => {
    setExpanded(t, isExpanded(t))
  })

  return {
    isOpen,
    open,
    close,
    toggle,
    switchTab,
    getActiveTab,
  }
}
