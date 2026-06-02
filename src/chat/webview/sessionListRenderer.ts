import { getElementRefs } from "./dom"
import { REMOVE_SVG } from "./icons"

export type ServerSessionEntry = {
  id: string; title?: string; directory?: string; parentId?: string;
  created?: number; updated?: number; files?: number; additions?: number;
  deletions?: number; isCurrentWorkspace?: boolean
}

type LocalSessionEntry = {
  id: string
  cliSessionId?: string
  title?: string
  messageCount?: number
  cost?: number
  time?: number
  pinned?: boolean
  tags?: string[]
}
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
  pinned?: boolean
  tags?: string[]
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
        pinned: local.pinned,
        tags: local.tags,
      })
    } else {
      items.push({
        type: "local",
        localId: local.id,
        title: local.title || "Untitled",
        messageCount: local.messageCount,
        time: local.time,
        cost: local.cost,
        pinned: local.pinned,
        tags: local.tags,
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

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
}

function renderTagChips(container: HTMLElement, tags: readonly string[] | undefined): void {
  container.replaceChildren()
  for (const tag of tags ?? []) {
    const chip = document.createElement("span")
    chip.className = "modal-session-tag"
    chip.textContent = tag
    container.appendChild(chip)
  }
}

function addTextAction(label: string, className: string, title: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = `${className} icon-btn`
  button.title = title
  button.setAttribute("aria-label", title)
  button.textContent = label
  button.addEventListener("click", onClick)
  return button
}

function createSessionRowActions(
  row: HTMLButtonElement,
  item: ReturnType<typeof buildUnifiedSessionItems>[number],
  nameEl: HTMLElement,
  tagsEl: HTMLElement,
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

  const localId = item.localId
  if (localId) {
    const pinBtn = addTextAction(item.pinned ? "Unpin" : "Pin", "modal-session-pin", item.pinned ? "Unpin" : "Pin", (e) => {
      e.stopPropagation()
      _postMessage({ type: "pin_session", targetSessionId: localId, pinned: !item.pinned })
    })
    pinBtn.setAttribute("aria-pressed", String(item.pinned === true))
    actions.appendChild(pinBtn)

    const renameBtn = addTextAction("Rename", "modal-session-rename", "Rename", (e) => {
      e.stopPropagation()
      const input = document.createElement("input")
      input.className = "modal-session-rename-input"
      input.value = nameEl.textContent || ""
      input.setAttribute("aria-label", "Session name")
      const restore = () => input.replaceWith(nameEl)
      input.addEventListener("click", (event) => event.stopPropagation())
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          restore()
          return
        }
        if (event.key !== "Enter") return
        event.preventDefault()
        const nextName = input.value.trim()
        if (!nextName) {
          restore()
          return
        }
        nameEl.textContent = nextName
        input.replaceWith(nameEl)
        _postMessage({ type: "rename_session", sessionId: localId, name: nextName })
      })
      nameEl.replaceWith(input)
      input.focus()
      input.select()
    })
    actions.appendChild(renameBtn)

    const tagBtn = addTextAction("Tags", "modal-session-tag-btn", "Edit tags", (e) => {
      e.stopPropagation()
      const input = document.createElement("input")
      input.className = "modal-session-tags-input"
      input.value = (item.tags ?? []).join(", ")
      input.setAttribute("aria-label", "Session tags")
      const restore = () => input.replaceWith(tagsEl)
      input.addEventListener("click", (event) => event.stopPropagation())
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          restore()
          return
        }
        if (event.key !== "Enter") return
        event.preventDefault()
        const tags = parseTags(input.value)
        item.tags = tags
        renderTagChips(tagsEl, tags)
        input.replaceWith(tagsEl)
        _postMessage({ type: "set_session_tags", targetSessionId: localId, tags })
      })
      tagsEl.replaceWith(input)
      input.focus()
      input.select()
    })
    actions.appendChild(tagBtn)

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
  row.classList.toggle("modal-session-item--pinned", item.pinned === true)
  row.setAttribute("role", "option")
  row.setAttribute("aria-label", `Open session: ${item.title}`)
  if (item.serverId) row.dataset.serverId = item.serverId

  if (item.pinned) {
    const pinMarker = document.createElement("span")
    pinMarker.className = "modal-session-pin-marker"
    pinMarker.textContent = "Pinned"
    row.appendChild(pinMarker)
  }

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

  const tagsEl = document.createElement("div")
  tagsEl.className = "modal-session-tags"
  renderTagChips(tagsEl, item.tags)
  info.appendChild(tagsEl)

  row.appendChild(info)

  if (item.cost && item.cost > 0) {
    const costEl = document.createElement("span")
    costEl.className = "modal-session-cost"
    costEl.textContent = `$${item.cost.toFixed(2)}`
    row.appendChild(costEl)
  }

  const actions = createSessionRowActions(row, item, nameEl, tagsEl)
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

  items.sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || (b.time ?? 0) - (a.time ?? 0))

  for (const item of items) {
    const row = createSessionRow(item)
    listContainer.appendChild(row)
  }
}
