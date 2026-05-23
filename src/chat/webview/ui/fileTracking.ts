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

export function renderCheckpointPanel(deps: FileTrackingDeps, checkpoints: Array<{ id: string; sessionId: string; messageId?: string; filesChanged?: string[] }>): void {
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
  for (const cp of checkpoints) {
    const item = document.createElement("div")
    item.className = "checkpoint-item"
    item.setAttribute("role", "listitem")

    const label = document.createElement("span")
    label.textContent = `Checkpoint ${cp.id.slice(0, 8)}... (${cp.filesChanged?.length || 0} files)`
    label.title = `Message: ${cp.messageId || "unknown"}`
    label.className = "checkpoint-label"

    const restoreBtn = document.createElement("button")
    restoreBtn.className = "checkpoint-restore-btn"
    restoreBtn.textContent = "Restore"
    restoreBtn.setAttribute("aria-label", `Restore to checkpoint ${cp.id.slice(0, 8)}`)
    restoreBtn.addEventListener("click", () => {
      deps.postMessage({ type: "restore_checkpoint", checkpointId: cp.id, sessionId: cp.sessionId })
    })

    item.appendChild(label)
    item.appendChild(restoreBtn)
    panel.appendChild(item)
  }
}
