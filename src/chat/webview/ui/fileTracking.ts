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

    // Add file icon based on extension
    const icon = document.createElement("span")
    icon.className = "changed-file-icon"
    icon.innerHTML = getFileIcon(f)
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

function getFileIcon(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  const iconMap: Record<string, string> = {
    ts: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    tsx: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    js: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    jsx: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    py: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    rs: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    go: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    java: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    json: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    md: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    css: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    html: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    yaml: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    yml: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    xml: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    sql: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    sh: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    txt: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>`,
  }
  return iconMap[ext] ?? iconMap.txt!
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
    panel.classList.add("hidden")
    toggleBtn?.setAttribute("aria-pressed", "false")
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
