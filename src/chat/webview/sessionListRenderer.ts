import { getElementRefs } from "./dom"
import { REMOVE_SVG } from "./icons"

export type ServerSessionEntry = {
  id: string; title?: string; directory?: string; parentId?: string;
  created?: number; updated?: number; files?: number; additions?: number;
  deletions?: number; isCurrentWorkspace?: boolean
}

type LocalSessionEntry = { id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }
type UnifiedSessionItem = {
  type: "synced" | "local" | "remote"
  localId?: string
  serverId?: string
  title: string
  directory?: string
  isCurrentWorkspace?: boolean
  messageCount?: number
  time?: number
  cost?: number
  files?: number
}

let _unifiedServerSessions: ServerSessionEntry[] | null = null
let _unifiedLocalSessions: LocalSessionEntry[] = []
let _postMessage: (msg: unknown) => void = () => {}
let _query = ""

export function setSessionListPostMessage(postMessage: (msg: unknown) => void) {
  _postMessage = postMessage
}

export function setUnifiedServerSessions(sessions: ServerSessionEntry[] | null) {
  _unifiedServerSessions = sessions
}

export function setUnifiedLocalSessions(sessions: LocalSessionEntry[]) {
  _unifiedLocalSessions = sessions
}

export function setUnifiedSessionQuery(query: string) {
  _query = query.trim().toLowerCase()
}

export function getUnifiedSessionQuery(): string {
  return _query
}

function buildUnifiedSessionItems(): UnifiedSessionItem[] {
  const serverById = new Map<string, ServerSessionEntry>()
  if (_unifiedServerSessions) {
    for (const s of _unifiedServerSessions) serverById.set(s.id, s)
  }

  const localByIdentity = new Map<string, LocalSessionEntry>()
  for (const local of _unifiedLocalSessions) {
    const identity = local.cliSessionId || local.id
    const existing = localByIdentity.get(identity)
    if (!existing) {
      localByIdentity.set(identity, local)
      continue
    }
    const existingScore = (existing.id === identity ? 2 : 0) + (existing.messageCount || 0)
    const nextScore = (local.id === identity ? 2 : 0) + (local.messageCount || 0)
    if (nextScore > existingScore) localByIdentity.set(identity, local)
  }

  const claimedServerIds = new Set<string>()
  const items: UnifiedSessionItem[] = []

  for (const local of localByIdentity.values()) {
    const server = local.cliSessionId ? serverById.get(local.cliSessionId) : undefined
    if (server) {
      claimedServerIds.add(server.id)
      items.push({
        type: "synced",
        localId: local.id,
        serverId: server.id,
        title: server.title || local.title || "Untitled",
        directory: server.directory,
        isCurrentWorkspace: server.isCurrentWorkspace,
        messageCount: local.messageCount,
        time: local.time ?? server.updated,
        cost: local.cost,
        files: server.files,
      })
    } else {
      items.push({
        type: "local",
        localId: local.id,
        title: local.title || "Untitled",
        messageCount: local.messageCount,
        time: local.time,
        cost: local.cost,
      })
    }
  }

  if (_unifiedServerSessions) {
    for (const server of _unifiedServerSessions) {
      if (!claimedServerIds.has(server.id)) {
        items.push({
          type: "remote",
          serverId: server.id,
          title: server.title || "Untitled",
          directory: server.directory,
          isCurrentWorkspace: server.isCurrentWorkspace,
          time: server.updated,
          files: server.files,
        })
      }
    }
  }

  return filterSessionItems(items)
}

function filterSessionItems(items: UnifiedSessionItem[]): UnifiedSessionItem[] {
  if (!_query) return items
  return items.filter((item) => [
    item.title,
    item.directory,
    item.serverId,
    item.localId,
  ].some((value) => String(value || "").toLowerCase().includes(_query)))
}

function renderEmptySessionState(container: HTMLElement): void {
  const empty = document.createElement("div")
  empty.className = "modal-empty"
  empty.textContent = _unifiedServerSessions === null ? "Loading sessions\u2026" : "No sessions."
  container.appendChild(empty)
}

function createSessionRowActions(
  row: HTMLButtonElement,
  item: ReturnType<typeof buildUnifiedSessionItems>[number]
): HTMLDivElement {
  const actions = document.createElement("div")
  actions.className = "modal-session-actions"

  row.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".modal-session-actions")) return
    const els = getElementRefs()
    els.sessionModal.classList.add("hidden")
    if (item.type === "remote" && item.serverId) {
      _postMessage({
        type: "resume_server_session",
        serverSessionId: item.serverId,
        title: item.title,
        directory: item.directory,
      })
    } else if (item.localId) {
      _postMessage({ type: "resume_session", sessionId: item.localId })
    }
  })

  if (item.localId) {
    const archiveBtn = document.createElement("button")
    archiveBtn.className = "modal-session-archive icon-btn"
    archiveBtn.title = "Archive"
    archiveBtn.setAttribute("aria-label", "Archive session")
    archiveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>'
    archiveBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      _postMessage({ type: "archive_session", targetSessionId: item.localId })
      row.remove()
    })
    actions.appendChild(archiveBtn)
  }

  const deleteBtn = document.createElement("button")
  deleteBtn.className = "modal-session-delete icon-btn"
  deleteBtn.setAttribute("aria-label", item.type === "local" ? "Delete session" : "Delete server session")
  deleteBtn.title = item.type === "local" ? "Delete" : "Delete from server"
  deleteBtn.innerHTML = REMOVE_SVG
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (item.serverId) {
      _postMessage({ type: "delete_server_session", serverSessionId: item.serverId })
    } else if (item.localId) {
      _postMessage({ type: "delete_session", targetSessionId: item.localId })
    }
    row.remove()
  })
  actions.appendChild(deleteBtn)

  return actions
}

function createSessionRow(item: ReturnType<typeof buildUnifiedSessionItems>[number]): HTMLButtonElement {
  const row = document.createElement("button")
  row.className = "modal-session-item"
  row.setAttribute("role", "option")
  row.setAttribute("aria-label", `Open session: ${item.title}`)
  if (item.serverId) row.dataset.serverId = item.serverId

  const badge = document.createElement("span")
  badge.className = `session-workspace-badge ${item.type === "local" ? "local" : item.isCurrentWorkspace !== false ? "current" : "other"}`
  badge.setAttribute("aria-hidden", "true")
  row.appendChild(badge)

  const info = document.createElement("div")
  info.className = "modal-session-info"

  const nameEl = document.createElement("div")
  nameEl.className = "modal-session-name"
  nameEl.textContent = item.title
  info.appendChild(nameEl)

  const meta = document.createElement("div")
  meta.className = "modal-session-meta"
  const parts: string[] = []
  if (item.directory) parts.push(item.directory.split("/").pop() || item.directory)
  if (item.messageCount != null && item.messageCount > 0) parts.push(`${item.messageCount} msgs`)
  if (item.files != null && item.files > 0) parts.push(`${item.files} files`)
  if (item.time) parts.push(new Date(item.time).toLocaleDateString())
  meta.textContent = parts.join(" \u00b7 ")
  info.appendChild(meta)

  row.appendChild(info)

  if (item.cost && item.cost > 0) {
    const costEl = document.createElement("span")
    costEl.className = "modal-session-cost"
    costEl.textContent = `$${item.cost.toFixed(2)}`
    row.appendChild(costEl)
  }

  const actions = createSessionRowActions(row, item)
  row.appendChild(actions)

  return row
}

export function renderUnifiedSessionList() {
  const els = getElementRefs()
  const listContainer = els.sessionModalBody.querySelector<HTMLElement>(".modal-session-list")
  if (!listContainer) return
  listContainer.replaceChildren()

  const items = buildUnifiedSessionItems()

  if (items.length === 0) {
    renderEmptySessionState(listContainer)
    return
  }

  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))

  for (const item of items) {
    const row = createSessionRow(item)
    listContainer.appendChild(row)
  }
}
