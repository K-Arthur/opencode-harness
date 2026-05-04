import type { SessionSummary } from "./types"

let sessionPickerOpen = false

export function showSessionPicker(sessions: SessionSummary[], postMessage: (msg: Record<string, unknown>) => void) {
  if (sessionPickerOpen) return
  sessionPickerOpen = true

  const overlay = document.createElement("div")
  overlay.className = "overlay"
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay()
  })

  const dialog = document.createElement("div")
  dialog.className = "overlay-dialog"

  const titleRow = document.createElement("div")
  titleRow.className = "overlay-title"
  titleRow.textContent = "Session History"
  const closeBtn = document.createElement("button")
  closeBtn.className = "overlay-close"
  closeBtn.textContent = "\u00D7"
  closeBtn.addEventListener("click", closeOverlay)
  titleRow.appendChild(closeBtn)
  dialog.appendChild(titleRow)

  const searchInput = document.createElement("input")
  searchInput.className = "overlay-search"
  searchInput.type = "text"
  searchInput.placeholder = "Search sessions..."
  searchInput.autofocus = true
  dialog.appendChild(searchInput)

  const list = document.createElement("div")
  list.className = "overlay-list"

  function renderList(filter: string) {
    list.innerHTML = ""
    const filtered = filter
      ? sessions.filter((s) => (s.title || "").toLowerCase().includes(filter.toLowerCase()))
      : sessions
    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.style.cssText = "padding:20px;text-align:center;color:var(--oc-muted);font-size:12px;"
      empty.textContent = "No sessions found"
      list.appendChild(empty)
      return
    }
    filtered.forEach((s) => {
      const item = document.createElement("div")
      item.className = "session-item"
      
      const info = document.createElement("div")
      info.style.flex = "1"
      info.style.minWidth = "0"
      
      const title = document.createElement("div")
      title.className = "session-item-title"
      title.textContent = s.title || "Untitled Session"
      info.appendChild(title)
      
      const meta = document.createElement("div")
      meta.className = "session-item-meta"
      const date = s.time ? new Date(s.time).toLocaleDateString() : ""
      const count = s.messageCount != null ? s.messageCount + " messages" : ""
      meta.textContent = [date, count].filter(Boolean).join(" \u00B7 ")
      info.appendChild(meta)
      
      item.appendChild(info)
      
      // Cost badge
      if (s.cost !== undefined && s.cost > 0) {
        const cost = document.createElement("span")
        cost.className = "recent-item-cost"
        cost.style.marginLeft = "8px"
        cost.style.flexShrink = "0"
        cost.textContent = `$${s.cost.toFixed(2)}`
        item.appendChild(cost)
      }
      
      item.addEventListener("click", () => {
        postMessage({ type: "resume_session", sessionId: s.id })
        closeOverlay()
      })
      list.appendChild(item)
    })
  }

  renderList("")
  dialog.appendChild(list)

  searchInput.addEventListener("input", () => {
    renderList(searchInput.value)
  })

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay()
  })

  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  function closeOverlay() {
    sessionPickerOpen = false
    overlay.classList.add("closing")
    setTimeout(() => overlay.remove(), 150)
  }
}
