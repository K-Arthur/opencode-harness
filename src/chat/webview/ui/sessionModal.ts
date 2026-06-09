export interface SessionModalElements {
  sessionModal: HTMLElement
  sessionModalClose: HTMLButtonElement
  sessionModalBody: HTMLElement
}

export interface SessionModalDeps {
  els: SessionModalElements
  setUnifiedLocalSessions: (sessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }>) => void
  setUnifiedServerSessions: (sessions: Array<{ id: string; title?: string; messageCount?: number; cost?: number; time?: number }> | null) => void
  setUnifiedSessionQuery: (query: string) => void
  renderUnifiedSessionList: () => void
  postMessage: (msg: Record<string, unknown>) => void
  /** Optional cleanup hook — invoked when the modal closes to dispose any
   * portaled overflow menus. */
  onClose?: () => void
}

export function trapModalFocus(container: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== "Tab") return
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

let focusTrap: ((e: KeyboardEvent) => void) | null = null
let lastFocus: HTMLElement | null = null

export function setupSessionModal(deps: SessionModalDeps): void {
  const { els } = deps
  els.sessionModalClose.addEventListener("click", () => closeSessionModal(els, deps.onClose))
  els.sessionModal.addEventListener("click", (e) => {
    if (e.target === els.sessionModal) closeSessionModal(els, deps.onClose)
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.sessionModal.classList.contains("hidden")) {
      closeSessionModal(els, deps.onClose)
    }
  })
}

export function openSessionModal(
  deps: SessionModalDeps,
  sessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }>,
  query = ""
): void {
  const { els, setUnifiedLocalSessions, setUnifiedServerSessions, setUnifiedSessionQuery, renderUnifiedSessionList, postMessage } = deps
  setUnifiedLocalSessions(sessions)
  setUnifiedServerSessions(null)
  setUnifiedSessionQuery(query)

  const body = els.sessionModalBody
  body.replaceChildren()

  const searchWrap = document.createElement("div")
  searchWrap.className = "modal-session-search"
  const search = document.createElement("input")
  search.type = "search"
  search.className = "modal-session-search-input"
  search.placeholder = "Search sessions"
  search.setAttribute("aria-label", "Search sessions")
  search.value = query
  searchWrap.appendChild(search)
  body.appendChild(searchWrap)

  const list = document.createElement("div")
  list.className = "modal-session-list"
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "Sessions")
  body.appendChild(list)

  const loading = document.createElement("div")
  loading.className = "modal-empty"
  loading.textContent = "Loading sessions…"
  list.appendChild(loading)

  postMessage({ type: "list_server_sessions", query })
  renderUnifiedSessionList()

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  search.addEventListener("input", () => {
    const nextQuery = search.value.trim()
    setUnifiedSessionQuery(nextQuery)
    renderUnifiedSessionList()
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      postMessage({ type: "list_server_sessions", query: nextQuery })
    }, 150)
  })

  els.sessionModal.classList.remove("hidden")

  lastFocus = document.activeElement as HTMLElement | null
  focusTrap = trapModalFocus(els.sessionModal)
  document.addEventListener("keydown", focusTrap)
  const firstBtn = els.sessionModal.querySelector<HTMLElement>("button, [href], input:not([type='hidden'])")
  if (firstBtn) firstBtn.focus()
}

export function closeSessionModal(els: SessionModalElements, onClose?: () => void): void {
  els.sessionModal.classList.add("hidden")
  if (focusTrap) {
    document.removeEventListener("keydown", focusTrap)
    focusTrap = null
  }
  if (lastFocus) {
    lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }
  onClose?.()
}
