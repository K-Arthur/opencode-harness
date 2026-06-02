import type { SubagentActivity } from "./types"
import type { ElementRefs } from "./dom"

export interface SubagentDetailViewOptions {
  onBack: () => void
  onClose: () => void
  onCancelSubagent: (subagentId: string) => void
}

export type SubagentDetailViewEls = Pick<ElementRefs,
  | "subagentDetailView"
  | "subagentDetailBackBtn"
  | "subagentDetailCloseBtn"
  | "subagentDetailContent"
>

export interface SubagentDetailViewApi {
  open: (activity: SubagentActivity) => void
  close: () => void
  renderLoading: () => void
  renderError: (message: string) => void
  showDetail: (activity: SubagentActivity, detail: Record<string, unknown>) => void
  dispose: () => void
}

const SUBAGENT_STATUSES = new Set(["running", "completed", "failed", "cancelled", "pending"])

function statusText(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function safeStatusClass(status: string): string {
  return SUBAGENT_STATUSES.has(status) ? status : "unknown"
}

function formatDuration(ms?: number): string {
  if (!ms) return ""
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return `${m}m ${sec}s`
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${h}h ${min}m`
}

function formatTime(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function sanitizeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function setupSubagentDetailView(
  els: SubagentDetailViewEls,
  options: SubagentDetailViewOptions,
): SubagentDetailViewApi {
  const container = els.subagentDetailView
  const content = els.subagentDetailContent
  const backBtn = els.subagentDetailBackBtn
  const closeBtn = els.subagentDetailCloseBtn

  if (!container || !content || !backBtn || !closeBtn) {
    console.warn("Subagent detail view elements not found")
    return null as unknown as SubagentDetailViewApi
  }

  const onBackClick = () => { closeView(); options.onBack() }
  const onCloseClick = () => { closeView(); options.onClose() }
  backBtn.addEventListener("click", onBackClick)
  closeBtn.addEventListener("click", onCloseClick)

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !container.classList.contains("hidden")) {
      closeView()
      options.onClose()
    }
  }
  document.addEventListener("keydown", onKeydown)

  function closeView() {
    container.classList.add("hidden")
  }

  function close() {
    closeView()
  }

  function open(activity: SubagentActivity) {
    container.classList.remove("hidden")
    content.innerHTML = ""
    renderSummary(content, activity)
  }

  function showDetail(activity: SubagentActivity, detail: Record<string, unknown>) {
    container.classList.remove("hidden")
    content.innerHTML = ""
    const hydrated = mergeActivityDetail(activity, detail)
    renderSummary(content, hydrated)
    renderMessages(content, detail.messages)
  }

  function mergeActivityDetail(activity: SubagentActivity, detail: Record<string, unknown>): SubagentActivity {
    const rawStatus = typeof detail.status === "string" ? detail.status : activity.status
    const rawName = typeof detail.agentName === "string"
      ? detail.agentName
      : typeof detail.name === "string"
        ? detail.name
        : activity.name
    return {
      ...activity,
      ...detail,
      id: typeof detail.id === "string" ? detail.id : activity.id,
      name: rawName,
      status: SUBAGENT_STATUSES.has(rawStatus) ? rawStatus as SubagentActivity["status"] : activity.status,
    } as SubagentActivity
  }

  function renderSummary(el: HTMLElement, activity: SubagentActivity) {
    const card = document.createElement("div")
    card.className = "subagent-detail-card"
    const statusClass = safeStatusClass(activity.status)

    card.innerHTML = `
      <div class="subagent-detail-section">
        <div class="subagent-detail-status-row">
          <span class="subagent-detail-status-badge subagent-detail-status-badge--${statusClass}">
            ${sanitizeHtml(statusText(activity.status))}
          </span>
          ${activity.progress !== undefined ? `<span class="subagent-detail-progress">${Math.round(activity.progress)}%</span>` : ""}
          ${activity.durationMs ? `<span class="subagent-detail-duration">${formatDuration(activity.durationMs)}</span>` : ""}
          ${activity.startedAt ? `<span class="subagent-detail-time">Started ${formatTime(activity.startedAt)}</span>` : ""}
        </div>
      </div>
      ${activity.summary ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title">Summary</h3>
        <p class="subagent-detail-text">${sanitizeHtml(activity.summary)}</p>
      </div>` : ""}
      ${activity.currentActivity ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title">Current Activity</h3>
        <p class="subagent-detail-text">${sanitizeHtml(activity.currentActivity)}</p>
      </div>` : ""}
      ${activity.error ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title subagent-detail-error-title">Error</h3>
        <pre class="subagent-detail-error">${sanitizeHtml(activity.error)}</pre>
      </div>` : ""}
      ${activity.output ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title">Output</h3>
        <pre class="subagent-detail-output">${sanitizeHtml(activity.output)}</pre>
      </div>` : ""}
      ${activity.inputPrompt ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title">Prompt</h3>
        <pre class="subagent-detail-prompt">${sanitizeHtml(activity.inputPrompt)}</pre>
      </div>` : ""}
      ${activity.result ? `
      <div class="subagent-detail-section">
        <h3 class="subagent-detail-section-title">Result</h3>
        <p class="subagent-detail-text">${sanitizeHtml(activity.result)}</p>
      </div>` : ""}
    `

    el.appendChild(card)

    renderToolCalls(el, activity.toolCalls)
    renderCommands(el, activity.commands)
    renderFileChanges(el, activity.fileChanges)
    renderMetadata(el, activity)

    if (activity.status === "running") {
      const cancelRow = document.createElement("div")
      cancelRow.className = "subagent-detail-actions"
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "subagent-detail-cancel-btn"
      cancelBtn.textContent = "Cancel Subagent"
      cancelBtn.addEventListener("click", () => options.onCancelSubagent(activity.id))
      cancelRow.appendChild(cancelBtn)
      el.appendChild(cancelRow)
    }
  }

  function renderMessages(el: HTMLElement, rawMessages: unknown) {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return
    const section = document.createElement("div")
    section.className = "subagent-detail-section"
    section.innerHTML = `<h3 class="subagent-detail-section-title">Messages (${rawMessages.length})</h3>`
    const list = document.createElement("div")
    list.className = "subagent-detail-messages"
    for (const raw of rawMessages) {
      if (!raw || typeof raw !== "object") continue
      const msg = raw as Record<string, unknown>
      const role = typeof msg.role === "string" ? msg.role : "assistant"
      const text = typeof msg.text === "string" ? msg.text : ""
      if (!text) continue
      const item = document.createElement("div")
      item.className = "subagent-detail-message"
      const roleEl = document.createElement("div")
      roleEl.className = "subagent-detail-msg-role"
      roleEl.textContent = role
      const textEl = document.createElement("div")
      textEl.className = "subagent-detail-msg-text"
      textEl.textContent = text
      item.append(roleEl, textEl)
      list.appendChild(item)
    }
    if (list.childElementCount === 0) return
    section.appendChild(list)
    el.appendChild(section)
  }

  function renderToolCalls(el: HTMLElement, toolCalls?: SubagentActivity["toolCalls"]) {
    if (!toolCalls || toolCalls.length === 0) return
    const section = document.createElement("div")
    section.className = "subagent-detail-section"
    section.innerHTML = `<h3 class="subagent-detail-section-title">Tool Calls (${toolCalls.length})</h3>`
    const list = document.createElement("div")
    list.className = "subagent-detail-tool-list"
    for (const tc of toolCalls) {
      const item = document.createElement("div")
      item.className = "subagent-detail-tool-item"
      let statusClass = "tool-status-unknown"
      if (tc.status === "success") statusClass = "tool-status-success"
      else if (tc.status === "error") statusClass = "tool-status-error"
      else if (tc.status === "running") statusClass = "tool-status-running"
      item.innerHTML = `
        <div class="subagent-detail-tool-header">
          <span class="tool-name">${sanitizeHtml(tc.name)}</span>
          <span class="${statusClass}">${sanitizeHtml(statusText(tc.status))}</span>
          ${tc.durationMs ? `<span class="tool-duration">${formatDuration(tc.durationMs)}</span>` : ""}
        </div>
        ${tc.args ? `<pre class="subagent-detail-tool-args">${sanitizeHtml(tc.args)}</pre>` : ""}
        ${tc.error ? `<pre class="subagent-detail-tool-error">${sanitizeHtml(tc.error)}</pre>` : ""}
      `
      list.appendChild(item)
    }
    section.appendChild(list)
    el.appendChild(section)
  }

  function renderCommands(el: HTMLElement, commands?: SubagentActivity["commands"]) {
    if (!commands || commands.length === 0) return
    const section = document.createElement("div")
    section.className = "subagent-detail-section"
    section.innerHTML = `<h3 class="subagent-detail-section-title">Commands (${commands.length})</h3>`
    const list = document.createElement("div")
    list.className = "subagent-detail-command-list"
    for (const cmd of commands) {
      const item = document.createElement("div")
      item.className = "subagent-detail-command-item"
      let statusClass = "cmd-status-unknown"
      if (cmd.status === "success") statusClass = "cmd-status-success"
      else if (cmd.status === "error") statusClass = "cmd-status-error"
      else if (cmd.status === "running") statusClass = "cmd-status-running"
      item.innerHTML = `
        <div class="subagent-detail-command-header">
          <code class="cmd-command">${sanitizeHtml(cmd.command)}</code>
          <span class="${statusClass}">${sanitizeHtml(statusText(cmd.status))}</span>
          ${cmd.durationMs ? `<span class="cmd-duration">${formatDuration(cmd.durationMs)}</span>` : ""}
        </div>
        ${cmd.output ? `<pre class="subagent-detail-command-output">${sanitizeHtml(cmd.output)}</pre>` : ""}
        ${cmd.error ? `<pre class="subagent-detail-command-error">${sanitizeHtml(cmd.error)}</pre>` : ""}
      `
      list.appendChild(item)
    }
    section.appendChild(list)
    el.appendChild(section)
  }

  function renderFileChanges(el: HTMLElement, fileChanges?: SubagentActivity["fileChanges"]) {
    if (!fileChanges || fileChanges.length === 0) return
    const section = document.createElement("div")
    section.className = "subagent-detail-section"
    section.innerHTML = `<h3 class="subagent-detail-section-title">File Changes (${fileChanges.length})</h3>`
    const list = document.createElement("div")
    list.className = "subagent-detail-file-list"
    for (const fc of fileChanges) {
      const item = document.createElement("div")
      item.className = "subagent-detail-file-item"
      let typeClass = "file-type-modified"
      if (fc.type === "added") typeClass = "file-type-added"
      else if (fc.type === "deleted") typeClass = "file-type-deleted"
      item.innerHTML = `
        <span class="file-icon ${typeClass}">${fc.type === "added" ? "+" : fc.type === "deleted" ? "-" : "~"}</span>
        <span class="file-path">${sanitizeHtml(fc.path)}</span>
        ${fc.additions || fc.deletions ? `<span class="file-stats">+${fc.additions ?? 0} -${fc.deletions ?? 0}</span>` : ""}
      `
      list.appendChild(item)
    }
    section.appendChild(list)
    el.appendChild(section)
  }

  function renderMetadata(el: HTMLElement, activity: SubagentActivity) {
    const metaEntries: Array<{ label: string; value: string }> = []
    if (activity.agentMode) metaEntries.push({ label: "Agent Mode", value: activity.agentMode })
    if (activity.model) metaEntries.push({ label: "Model", value: activity.model })
    if (activity.provider) metaEntries.push({ label: "Provider", value: activity.provider })
    if (activity.domain) metaEntries.push({ label: "Domain", value: activity.domain })
    if (activity.tokenUsage) {
      const tu = activity.tokenUsage
      metaEntries.push({ label: "Input Tokens", value: String(tu.input) })
      metaEntries.push({ label: "Output Tokens", value: String(tu.output) })
      metaEntries.push({ label: "Total Tokens", value: String(tu.total) })
    }
    if (activity.cost) metaEntries.push({ label: "Cost", value: `$${activity.cost.toFixed(4)}` })
    if (activity.completedAt) metaEntries.push({ label: "Completed At", value: formatTime(activity.completedAt) })
    if (activity.startedAt) metaEntries.push({ label: "Started At", value: formatTime(activity.startedAt) })

    if (metaEntries.length === 0) return
    const section = document.createElement("div")
    section.className = "subagent-detail-section"
    section.innerHTML = `<h3 class="subagent-detail-section-title">Metadata</h3>`
    const table = document.createElement("table")
    table.className = "subagent-detail-metadata"
    for (const entry of metaEntries) {
      const row = table.insertRow()
      row.innerHTML = `<td class="meta-label">${sanitizeHtml(entry.label)}</td><td class="meta-value">${sanitizeHtml(entry.value)}</td>`
    }
    section.appendChild(table)
    el.appendChild(section)
  }

  function renderLoading() {
    container.classList.remove("hidden")
    content.innerHTML = `<div class="subagent-detail-loading"><span class="subagent-detail-spinner"></span> Loading subagent detail...</div>`
  }

  function renderError(message: string) {
    container.classList.remove("hidden")
    content.innerHTML = `<div class="subagent-detail-error-state">${sanitizeHtml(message)}</div>`
  }

  function dispose() {
    closeBtn.removeEventListener("click", onCloseClick)
    backBtn.removeEventListener("click", onBackClick)
    document.removeEventListener("keydown", onKeydown)
  }

  return { open, close, renderLoading, renderError, showDetail, dispose }
}
