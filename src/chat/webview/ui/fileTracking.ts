export interface FileTrackingDeps {
  getSession: (id: string) => { changedFiles?: string[]; cost?: number } | undefined
  save: () => void
  postMessage: (msg: Record<string, unknown>) => void
  getActiveSessionId: () => string | undefined
  changedFilesList: HTMLElement | null
  checkpointPanel: HTMLElement | null
  checkpointToggleBtn: HTMLElement | null
  clearMessages: (sessionId: string) => void
  getMessageList: (sessionId: string) => HTMLElement | null
  getAllSessions: () => Array<{ id: string }>
}

export function trackFileChange(deps: FileTrackingDeps, sessionId: string, filePath: string): void {
  const session = deps.getSession(sessionId)
  if (session) {
    if (!session.changedFiles) session.changedFiles = []
    if (!session.changedFiles.includes(filePath)) {
      session.changedFiles.push(filePath)
      deps.save()
    }
  }
}

export function undoMessage(deps: FileTrackingDeps, messageId: string): void {
  const sessionId = deps.getActiveSessionId()
  if (sessionId) {
    deps.postMessage({ type: "revert_message", messageId, sessionId })
  }
}

export function handleChangedFiles(deps: FileTrackingDeps, sessionId: string, files: string[]): void {
  const session = deps.getSession(sessionId)
  if (session) {
    session.changedFiles = files
    deps.save()
  }
  if (deps.getActiveSessionId() === sessionId) {
    renderChangedFilesList(deps, files)
  }
}

export function renderChangedFilesList(deps: FileTrackingDeps, files: string[]): void {
  const list = deps.changedFilesList
  if (!list) return
  list.innerHTML = ""
  if (files.length === 0) {
    list.classList.add("hidden")
    return
  }
  list.classList.remove("hidden")
  for (const f of files) {
    const chip = document.createElement("div")
    chip.className = "changed-file-chip"
    chip.setAttribute("data-testid", `changed-file-${f.replace(/[^a-zA-Z0-9]/g, "-")}`)
    chip.title = f

    // Add file icon based on extension — colored monogram badge per language
    const icon = document.createElement("span")
    const meta = getFileIcon(f)
    icon.className = `changed-file-icon ${meta.className}`
    icon.textContent = meta.label
    icon.setAttribute("aria-hidden", "true")
    chip.appendChild(icon)

    // Add filename
    const name = document.createElement("span")
    name.className = "changed-file-name"
    name.textContent = f.split("/").pop() || f
    chip.appendChild(name)

    // Add status indicator (default to modified)
    const status = document.createElement("span")
    status.className = "changed-file-status changed-file-status--modified"
    status.textContent = "M"
    status.title = "Modified"
    chip.appendChild(status)

    list.appendChild(chip)
  }
}

interface FileTypeMeta { label: string; className: string }

// Per-language colored monogram badges. Keeps the changed-files chips
// readable at a glance without depending on an external icon font.
const iconMap: Record<string, FileTypeMeta> = {
  ts:   { label: "TS",  className: "changed-file-icon--ts" },
  tsx:  { label: "TSX", className: "changed-file-icon--ts" },
  js:   { label: "JS",  className: "changed-file-icon--js" },
  jsx:  { label: "JSX", className: "changed-file-icon--js" },
  mjs:  { label: "JS",  className: "changed-file-icon--js" },
  cjs:  { label: "JS",  className: "changed-file-icon--js" },
  py:   { label: "PY",  className: "changed-file-icon--py" },
  rs:   { label: "RS",  className: "changed-file-icon--rs" },
  go:   { label: "GO",  className: "changed-file-icon--go" },
  java: { label: "JV",  className: "changed-file-icon--java" },
  kt:   { label: "KT",  className: "changed-file-icon--kt" },
  json: { label: "{}",  className: "changed-file-icon--json" },
  md:   { label: "MD",  className: "changed-file-icon--md" },
  css:  { label: "CSS", className: "changed-file-icon--css" },
  scss: { label: "SCS", className: "changed-file-icon--css" },
  html: { label: "<>",  className: "changed-file-icon--html" },
  yaml: { label: "YML", className: "changed-file-icon--yaml" },
  yml:  { label: "YML", className: "changed-file-icon--yaml" },
  xml:  { label: "XML", className: "changed-file-icon--xml" },
  sql:  { label: "SQL", className: "changed-file-icon--sql" },
  sh:   { label: "SH",  className: "changed-file-icon--sh" },
  bash: { label: "SH",  className: "changed-file-icon--sh" },
  zsh:  { label: "SH",  className: "changed-file-icon--sh" },
  toml: { label: "TOM", className: "changed-file-icon--toml" },
  txt:  { label: "TXT", className: "changed-file-icon--default" },
}

function getFileIcon(filePath: string): FileTypeMeta {
  const base = filePath.split("/").pop() ?? filePath
  const dotIdx = base.lastIndexOf(".")
  const ext = dotIdx > 0 ? base.slice(dotIdx + 1).toLowerCase() : ""
  return iconMap[ext] ?? { label: "FIL", className: "changed-file-icon--default" }
}

export function handleClearMessages(deps: FileTrackingDeps, sessionId?: string): void {
  if (sessionId) {
    deps.clearMessages(sessionId)
    const msgList = deps.getMessageList(sessionId)
    if (msgList) msgList.innerHTML = ""
  } else {
    deps.getAllSessions().forEach((s) => {
      deps.clearMessages(s.id)
      const msgList = deps.getMessageList(s.id)
      if (msgList) msgList.innerHTML = ""
    })
  }
}

export function renderCheckpointPanel(deps: FileTrackingDeps, checkpoints: Array<{ id: string; sessionId: string; messageId?: string; createdAt?: number; filesChanged?: string[]; action?: string }>): void {
  const panel = deps.checkpointPanel
  if (!panel) return
  panel.innerHTML = ""
  const toggleBtn = deps.checkpointToggleBtn
  if (checkpoints.length === 0) {
    panel.classList.remove("hidden")
    toggleBtn?.setAttribute("aria-pressed", "true")
    const empty = document.createElement("div")
    empty.className = "checkpoint-empty"
    empty.textContent = "No checkpoints yet"
    panel.appendChild(empty)
    return
  }
  panel.classList.remove("hidden")
  toggleBtn?.setAttribute("aria-pressed", "true")

  // Unrevert button — restores all reverted messages
  const unrevertRow = document.createElement("div")
  unrevertRow.className = "checkpoint-unrevert-row"
  const unrevertBtn = document.createElement("button")
  unrevertBtn.className = "checkpoint-unrevert-btn"
  unrevertBtn.textContent = "Restore all reverted messages"
  unrevertBtn.setAttribute("aria-label", "Restore all reverted messages in this session")
  const firstCp = checkpoints[0]
  if (firstCp) {
    unrevertBtn.addEventListener("click", () => {
      deps.postMessage({ type: "unrevert", sessionId: firstCp.sessionId })
    })
  }
  unrevertRow.appendChild(unrevertBtn)
  panel.appendChild(unrevertRow)
  for (const cp of checkpoints) {
    const item = document.createElement("div")
    item.className = "checkpoint-item"
    item.setAttribute("role", "listitem")
    item.setAttribute("data-checkpoint-id", cp.id)

    // Timeline dot
    const dot = document.createElement("span")
    dot.className = "checkpoint-dot"
    dot.setAttribute("aria-hidden", "true")
    item.appendChild(dot)

    // Content column
    const content = document.createElement("div")
    content.className = "checkpoint-content"

    const header = document.createElement("div")
    header.className = "checkpoint-header"

    // Action label or truncated ID
    const label = document.createElement("span")
    label.className = "checkpoint-label"
    if (cp.action) {
      label.textContent = formatActionLabel(cp.action)
    } else {
      label.textContent = `Checkpoint ${cp.id.slice(0, 12)}`
    }
    label.title = `ID: ${cp.id}`
    header.appendChild(label)

    // Timestamp
    if (cp.createdAt) {
      const time = document.createElement("span")
      time.className = "checkpoint-time"
      time.textContent = formatRelativeTime(cp.createdAt)
      time.title = new Date(cp.createdAt).toLocaleString()
      header.appendChild(time)
    }

    content.appendChild(header)

    // File summary
    const fileCount = cp.filesChanged?.length ?? 0
    if (fileCount > 0) {
      const files = document.createElement("div")
      files.className = "checkpoint-files"
      const fileNames = cp.filesChanged!.map(f => f.split("/").pop() ?? f)
      if (fileCount <= 3) {
        files.textContent = fileNames.join(", ")
      } else {
        files.textContent = `${fileNames.slice(0, 2).join(", ")} +${fileCount - 2} more`
      }
      files.title = cp.filesChanged!.join("\n")
      content.appendChild(files)
    }

    item.appendChild(content)

    // Restore button
    const restoreBtn = document.createElement("button")
    restoreBtn.className = "checkpoint-restore-btn"
    restoreBtn.textContent = "Restore"
    restoreBtn.setAttribute("aria-label", `Restore to checkpoint ${cp.action || cp.id.slice(0, 8)}`)
    restoreBtn.addEventListener("click", () => {
      deps.postMessage({ type: "restore_checkpoint", checkpointId: cp.id, sessionId: cp.sessionId })
    })

    item.appendChild(restoreBtn)
    panel.appendChild(item)
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    baseline: "Session start",
    edit: "File edit",
    write: "File write",
    create: "File create",
    delete: "File delete",
    tool: "Tool execution",
  }
  return labels[action] ?? action.charAt(0).toUpperCase() + action.slice(1)
}
