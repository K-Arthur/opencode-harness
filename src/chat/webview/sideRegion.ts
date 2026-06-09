export type SideTabId = "todos" | "activity" | "tasks" | "subagent"

const STORAGE_KEY = "oc:side-region-tab"

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
  tabBarEl: HTMLElement,
  tabButtons: NodeListOf<HTMLElement>,
  paneMap: Record<SideTabId, HTMLElement>,
  pinBtn: HTMLElement,
  closeBtn: HTMLElement,
  options?: SideRegionOptions,
): SideRegionApi {
  let isPinned = false
  let activeTab: SideTabId | null = null

  function activate(tab: SideTabId): void {
    activeTab = tab
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tab
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-selected", String(isActive))
    })
    for (const [id, pane] of Object.entries(paneMap) as [SideTabId, HTMLElement][]) {
      pane.classList.toggle("hidden", id !== tab)
    }
    sessionStorage.setItem(STORAGE_KEY, tab)
    options?.onTabChange?.(tab)
  }

  function isOpen(): boolean {
    return !regionEl.classList.contains("hidden")
  }

  function open(tab?: SideTabId): void {
    regionEl.classList.remove("hidden")
    const target = tab || activeTab || (sessionStorage.getItem(STORAGE_KEY) as SideTabId | null) || "todos"
    activate(target)
  }

  function close(): void {
    if (isPinned) return
    regionEl.classList.add("hidden")
  }

  function toggle(tab?: SideTabId): void {
    if (isOpen()) {
      close()
    } else {
      open(tab)
    }
  }

  function switchTab(tab: SideTabId): void {
    if (!isOpen()) {
      open(tab)
    } else {
      activate(tab)
    }
  }

  function getActiveTab(): SideTabId | null {
    return activeTab
  }

  // Pin button
  pinBtn.addEventListener("click", () => {
    isPinned = !isPinned
    pinBtn.setAttribute("aria-pressed", String(isPinned))
    pinBtn.title = isPinned ? "Unpin panel" : "Pin panel"
  })

  // Close button
  closeBtn.addEventListener("click", () => close())

  // Tab clicks
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as SideTabId | undefined
      if (tab) switchTab(tab)
    })
  })

  // Escape key
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && isOpen() && !isPinned) {
      close()
    }
  }
  document.addEventListener("keydown", onKeyDown)

  // Restore previously active tab
  const savedTab = sessionStorage.getItem(STORAGE_KEY) as SideTabId | null
  if (savedTab && TAB_ORDER.includes(savedTab)) {
    activeTab = savedTab
  }

  return {
    isOpen,
    open,
    close,
    toggle,
    switchTab,
    getActiveTab,
  }
}
