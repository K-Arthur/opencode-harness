import type { SessionSummary } from "./types"

export function renderRecentSessions(
  sessions: SessionSummary[],
  container: HTMLElement,
  onViewAll: () => void,
  onResume: (sessionId: string) => void
) {
  container.innerHTML = ""
  
  // Show only if there are sessions
  if (sessions.length === 0) {
    container.style.display = "none"
    return
  }
  
  container.style.display = ""
  
  // Take last 3 sessions
  const recent = sessions.slice(0, 3)
  
  // Create header
  const header = document.createElement("div")
  header.className = "recent-header"
  
  const label = document.createElement("span")
  label.className = "recent-label"
  label.textContent = "RECENT"
  header.appendChild(label)
  
  const viewAllBtn = document.createElement("button")
  viewAllBtn.className = "view-all-btn"
  viewAllBtn.textContent = "View All"
  viewAllBtn.addEventListener("click", onViewAll)
  header.appendChild(viewAllBtn)
  
  container.appendChild(header)
  
  // Create list
  const list = document.createElement("div")
  list.className = "recent-list"
  
  recent.forEach((session) => {
    const item = document.createElement("div")
    item.className = "recent-item"
    
    const info = document.createElement("div")
    info.className = "recent-item-info"
    
    const title = document.createElement("div")
    title.className = "recent-item-title"
    title.textContent = session.title || "Untitled Session"
    info.appendChild(title)
    
    const meta = document.createElement("div")
    meta.className = "recent-item-meta"
    const date = session.time ? new Date(session.time).toLocaleDateString() : ""
    const count = session.messageCount != null ? `${session.messageCount} messages` : ""
    meta.textContent = [date, count].filter(Boolean).join(" · ")
    info.appendChild(meta)
    
    item.appendChild(info)
    
    // Cost badge
    if (session.cost !== undefined && session.cost > 0) {
      const cost = document.createElement("span")
      cost.className = "recent-item-cost"
      cost.textContent = `$${session.cost.toFixed(2)}`
      item.appendChild(cost)
    }
    
    item.addEventListener("click", () => onResume(session.id))
    list.appendChild(item)
  })
  
  container.appendChild(list)
}
