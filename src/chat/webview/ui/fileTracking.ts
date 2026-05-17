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
  renderChangedFilesList(deps, files)
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
    const chip = document.createElement("span")
    chip.className = "changed-file-chip"
    chip.textContent = f.split("/").pop() || f
    chip.title = f
    list.appendChild(chip)
  }
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
