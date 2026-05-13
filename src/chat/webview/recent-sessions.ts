import type { SessionSummary } from "./types"

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function renderRecentSessions(
  sessions: SessionSummary[],
  container: HTMLElement,
  onViewAll: () => void,
  onResume: (sessionId: string) => void,
  isFiltered: boolean = false
) {
  container.innerHTML = ""
  
  container.style.display = ""
  
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
  
  if (sessions.length === 0) {
    const emptyMsg = document.createElement("div")
    emptyMsg.className = "recent-empty-message"
    emptyMsg.textContent = isFiltered ? "No matching sessions" : "No recent sessions"
    emptyMsg.style.padding = "var(--space-3)"
    emptyMsg.style.color = "var(--color-muted)"
    emptyMsg.style.textAlign = "center"
    list.appendChild(emptyMsg)
  } else {
    // Take last 3 sessions
    const recent = sessions.slice(0, 3)
    
    recent.forEach((session) => {
      const item = document.createElement("div")
      item.className = "recent-item"
      
      // Indicator
      const indicator = document.createElement("span")
      indicator.className = "recent-item-indicator"
      const titleLower = (session.title || "").toLowerCase();
      if (titleLower.includes("fix") || titleLower.includes("bug")) {
        indicator.textContent = "🐛";
      } else if (titleLower.includes("feat") || titleLower.includes("add")) {
        indicator.textContent = "✨";
      } else if (titleLower.includes("refactor")) {
        indicator.textContent = "♻️";
      } else {
        indicator.textContent = "💬";
      }
      item.appendChild(indicator)
      
      const info = document.createElement("div")
      info.className = "recent-item-info"
      
      const title = document.createElement("div")
      title.className = "recent-item-title"
      title.textContent = session.title || "Untitled Session"
      info.appendChild(title)
      
      const meta = document.createElement("div")
      meta.className = "recent-item-meta"
      const date = session.time ? getRelativeTime(session.time) : ""
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
      
      // Quick actions
      const actions = document.createElement("div")
      actions.className = "recent-item-actions"
      
      const deleteBtn = document.createElement("button")
      deleteBtn.className = "recent-action-btn"
      deleteBtn.textContent = "Delete"
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        console.log("Delete session", session.id);
      })
      
      actions.appendChild(deleteBtn)
      item.appendChild(actions)
      
      item.addEventListener("click", () => onResume(session.id))
      list.appendChild(item)
    })
  }
  
  container.appendChild(list)
}
