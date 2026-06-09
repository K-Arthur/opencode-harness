import type { ChatMessage, SessionSummary } from "./types"

type WelcomeLocalSession = {
  id: string
  name?: string
  messages: ChatMessage[]
  cost?: number
}

export type PreparedRecentSessions = {
  sessions: SessionSummary[]
  hasCandidates: boolean
  isFiltered: boolean
}

function normalizeRecentSessionQuery(filterQuery: string = ""): string {
  return filterQuery.trim().toLowerCase()
}

function sessionMatchesQuery(session: WelcomeLocalSession, query: string): boolean {
  if (!query) return true
  const name = (session.name || "").toLowerCase()
  if (name.includes(query)) return true
  for (const msg of session.messages) {
    for (const block of msg.blocks || []) {
      const text = (block as { type?: string; text?: string }).type === "text"
        ? (block as { text?: string }).text
        : undefined
      if (text && text.toLowerCase().includes(query)) return true
    }
  }
  return false
}

export function prepareHostRecentSessions(sessions: SessionSummary[]): SessionSummary[] {
  return sessions
    .slice()
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

export function prepareLocalRecentSessions(
  sessions: WelcomeLocalSession[],
  activeSessionId: string | null | undefined,
  filterQuery: string = ""
): PreparedRecentSessions {
  const query = normalizeRecentSessionQuery(filterQuery)
  const candidates = sessions
    .filter((s) => s.id !== activeSessionId && (s.messages.length > 0 || (!!query && !!s.name)))

  const prepared = candidates
    .filter((s) => sessionMatchesQuery(s, query))
    .sort((a, b) => {
      const tA = a.messages[a.messages.length - 1]?.timestamp ?? 0
      const tB = b.messages[b.messages.length - 1]?.timestamp ?? 0
      return tB - tA
    })
    .map((s) => ({
      id: s.id,
      title: s.name,
      time: s.messages[s.messages.length - 1]?.timestamp,
      messageCount: s.messages.filter((m) => m.role === "user").length satisfies number,
      cost: s.cost || 0,
    }))

  return {
    sessions: prepared,
    hasCandidates: candidates.length > 0,
    isFiltered: !!query,
  }
}

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
    const limit = isFiltered ? 10 : 3
    const recent = sessions.slice(0, limit)
    
    recent.forEach((session) => {
      const item = document.createElement("div")
      item.className = "recent-item"
      item.tabIndex = 0
      item.dataset.sessionId = session.id
      item.setAttribute("role", "option")
      
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
      deleteBtn.dataset.sessionId = session.id
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        const sid = (e.currentTarget as HTMLElement).dataset.sessionId
        if (sid) {
          const event = new CustomEvent("recent-session-delete", { detail: { sessionId: sid }, bubbles: true })
          container.dispatchEvent(event)
        }
      })
      
      actions.appendChild(deleteBtn)
      item.appendChild(actions)
      
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          onResume(session.id)
        } else if (e.key === "ArrowDown") {
          const next = item.nextElementSibling as HTMLElement | null
          next?.focus()
        } else if (e.key === "ArrowUp") {
          const prev = item.previousElementSibling as HTMLElement | null
          prev?.focus()
        }
      })
      item.addEventListener("click", () => onResume(session.id))
      list.appendChild(item)
    })
  }
  
  container.appendChild(list)
}
