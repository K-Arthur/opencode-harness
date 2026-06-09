import type { SubagentActivity } from "./types"
import type { ElementRefs } from "./dom"

export interface SubagentPanelOptions {
  onCancelSubagent: (subagentId: string) => void
  onOpenDetail: (activity: SubagentActivity) => void
}

export type SubagentPanelEls = Pick<ElementRefs,
  | "subagentPanel"
  | "subagentList"
> & { closeSubagentBtn?: HTMLElement | null }

export interface SubagentPanelApi {
  renderActivities: (activities: SubagentActivity[]) => void
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  dispose: () => void
}

const SUBAGENT_STATUS_WHITELIST = new Set(["running", "completed", "cancelled", "failed", "pending"])
function safeStatusClass(status: string): string {
  return SUBAGENT_STATUS_WHITELIST.has(status) ? status : "unknown"
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// Strip ANSI escape sequences and other C0 control chars (except \n/\t) that
// frequently appear in raw subagent stdout streams.
const ANSI_AND_CONTROL_RE = /\x1b\[[0-9;]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
function sanitizeOutput(s: string): string {
  return s.replace(ANSI_AND_CONTROL_RE, "")
}

const TDD_PHASE_LABELS: Record<string, string> = {
  red: 'RED — Writing tests',
  green: 'GREEN — Implementing',
  refactor: 'REFACTOR — Cleaning up',
  coverage: 'COVERAGE — Verifying',
}

const TDD_PHASE_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  refactor: '#8b5cf6',
  coverage: '#f59e0b',
}

const DOMAIN_ICONS: Record<string, string> = {
  frontend: '🎨',
  backend: '⚙️',
  database: '🗄️',
  api: '🔌',
  shared: '📦',
}

export function setupSubagentPanel(els: SubagentPanelEls, options: SubagentPanelOptions): SubagentPanelApi | undefined {
  const subagentPanel = els.subagentPanel
  const subagentList = els.subagentList
  const closeBtn = els.closeSubagentBtn

  if (!subagentPanel || !subagentList) {
    console.warn("Subagent panel elements not found")
    return undefined
  }

  const onCloseClick = () => { subagentPanel.classList.add("hidden") }
  if (closeBtn) closeBtn.addEventListener("click", onCloseClick)

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !subagentPanel.classList.contains("hidden")) {
      subagentPanel.classList.add("hidden")
    }
  }
  if (closeBtn) document.addEventListener("keydown", onEscape)

  return {
    renderActivities: (activities: SubagentActivity[]) => {
      renderSubagentList(subagentList, activities, options)
    },
    open: () => { subagentPanel.classList.remove("hidden") },
    close: () => { subagentPanel.classList.add("hidden") },
    toggle: () => { subagentPanel.classList.toggle("hidden") },
    isOpen: () => !subagentPanel.classList.contains("hidden"),
    dispose: () => {
      if (closeBtn) {
        document.removeEventListener("keydown", onEscape)
        closeBtn.removeEventListener("click", onCloseClick)
      }
    },
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function renderAggregateStats(container: HTMLElement, activities: SubagentActivity[]): void {
  const existing = container.querySelector(".subagent-stats-bar")
  if (existing) existing.remove()

  const running = activities.filter(a => a.status === "running").length
  const completed = activities.filter(a => a.status === "completed").length
  const failed = activities.filter(a => a.status === "failed" || a.status === "cancelled").length
  const totalMs = activities.reduce((sum, a) => sum + (a.durationMs ?? 0), 0)

  const bar = document.createElement("div")
  bar.className = "subagent-stats-bar"
  bar.setAttribute("role", "status")
  bar.setAttribute("aria-live", "polite")

  const parts: string[] = [`${activities.length} subagent${activities.length === 1 ? "" : "s"}`]
  if (running > 0) parts.push(`${running} running`)
  if (completed > 0) parts.push(`${completed} done`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (totalMs > 0) parts.push(formatDuration(totalMs))

  bar.textContent = parts.join(" · ")
  container.insertBefore(bar, container.firstChild)
}

function applyRovingTabindex(list: HTMLElement): void {
  const items = Array.from(list.querySelectorAll<HTMLElement>(".subagent-item"))
  if (items.length === 0) return

  // Ensure first item is the tab stop; rest are -1
  items.forEach((item, i) => {
    item.setAttribute("tabindex", i === 0 ? "0" : "-1")
  })

  list.addEventListener("keydown", (e: KeyboardEvent) => {
    const focused = document.activeElement as HTMLElement | null
    if (!focused || !focused.classList.contains("subagent-item")) return
    const idx = items.indexOf(focused)
    if (idx === -1) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = items[idx + 1]
      if (next) { focused.setAttribute("tabindex", "-1"); next.setAttribute("tabindex", "0"); next.focus() }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const prev = items[idx - 1]
      if (prev) { focused.setAttribute("tabindex", "-1"); prev.setAttribute("tabindex", "0"); prev.focus() }
    } else if (e.key === "Home") {
      e.preventDefault()
      const first = items[0]
      if (first) { focused.setAttribute("tabindex", "-1"); first.setAttribute("tabindex", "0"); first.focus() }
    } else if (e.key === "End") {
      e.preventDefault()
      const last = items[items.length - 1]
      if (last) { focused.setAttribute("tabindex", "-1"); last.setAttribute("tabindex", "0"); last.focus() }
    }
  })
}

function renderSubagentList(container: HTMLElement, activities: SubagentActivity[], options: SubagentPanelOptions) {
  container.innerHTML = ""

  renderAggregateStats(container, activities)

  if (activities.length === 0) {
    const empty = document.createElement("div")
    empty.className = "subagent-empty"
    empty.textContent = "No active subagents"
    container.appendChild(empty)
    return
  }

  const list = document.createElement("div")
  list.className = "subagent-list"
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "Subagents")

  activities.forEach((activity, idx) => {
    const item = document.createElement("div")
    item.className = `subagent-item subagent-item--${safeStatusClass(activity.status)}`
    item.dataset.subagentId = activity.id
    item.setAttribute("role", "option")
    item.setAttribute("tabindex", idx === 0 ? "0" : "-1")
    item.setAttribute("aria-label", `Open details for ${activity.name}`)

    const openDetail = () => {
      options.onOpenDetail(activity)
    }

    // Header row: name + domain badge + status
    const header = document.createElement("div")
    header.className = "subagent-item-header"

    const nameWrap = document.createElement("div")
    nameWrap.className = "subagent-name-wrap"

    const name = document.createElement("div")
    name.className = "subagent-name subagent-item-name"
    name.textContent = activity.name

    nameWrap.appendChild(name)

    // Domain badge
    if (activity.domain) {
      const badge = document.createElement("span")
      badge.className = "subagent-domain-badge"
      badge.textContent = `${DOMAIN_ICONS[activity.domain] ?? '📦'} ${activity.domain}`
      nameWrap.appendChild(badge)
    }

    const status = document.createElement("div")
    status.className = `subagent-item-status subagent-item-status--${safeStatusClass(activity.status)}`
    status.textContent = statusLabel(activity.status)

    // Cancel button (only for running)
    if (activity.status === 'running') {
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "subagent-cancel-btn"
      cancelBtn.setAttribute("aria-label", `Cancel ${activity.name}`)
      cancelBtn.textContent = "Cancel"
      cancelBtn.addEventListener("click", () => {
        options.onCancelSubagent(activity.id)
      })
      header.appendChild(nameWrap)
      header.appendChild(status)
      header.appendChild(cancelBtn)
    } else {
      header.appendChild(nameWrap)
      header.appendChild(status)
    }

    item.appendChild(header)

    // Click to open detail view
    item.style.cursor = "pointer"
    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".subagent-cancel-btn")) return
      openDetail()
    })
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      openDetail()
    })

    // TDD phase indicator
    if (activity.tddPhase) {
      const tddBar = document.createElement("div")
      tddBar.className = "subagent-tdd-bar"

      const phaseLabel = document.createElement("span")
      phaseLabel.className = "subagent-tdd-phase"
      phaseLabel.textContent = TDD_PHASE_LABELS[activity.tddPhase] ?? activity.tddPhase
      phaseLabel.style.color = TDD_PHASE_COLORS[activity.tddPhase] ?? '#888'

      tddBar.appendChild(phaseLabel)

      // Test counts
      if (activity.testsWritten !== undefined || activity.testsPassing !== undefined) {
        const testInfo = document.createElement("span")
        testInfo.className = "subagent-test-info"
        const written = activity.testsWritten ?? 0
        const passing = activity.testsPassing ?? 0
        testInfo.textContent = `${passing}/${written} tests passing`
        if (passing < written && activity.status === 'running') {
          testInfo.className += ' subagent-test-info--failing'
        }
        tddBar.appendChild(testInfo)
      }

      item.appendChild(tddBar)
    }

    // Test-only progress (when no TDD phase but tests exist)
    if (!activity.tddPhase && activity.testsWritten !== undefined && activity.testsWritten > 0) {
      const testBar = document.createElement("div")
      testBar.className = "subagent-tdd-bar"

      const testInfo = document.createElement("span")
      testInfo.className = "subagent-test-info"
      const passing = activity.testsPassing ?? 0
      testInfo.textContent = `${passing}/${activity.testsWritten} tests passing`
      if (passing < activity.testsWritten) {
        testInfo.className += ' subagent-test-info--failing'
      }
      testBar.appendChild(testInfo)
      item.appendChild(testBar)
    }

    // Progress bar (general progress, separate from TDD)
    if (activity.progress !== undefined && !activity.tddPhase) {
      const progressContainer = document.createElement("div")
      progressContainer.className = "subagent-item-progress"

      const progressBar = document.createElement("div")
      progressBar.className = "subagent-item-progress-bar"
      const ratio = Math.max(0, Math.min(1, activity.progress / 100))
      progressBar.style.setProperty("--p", String(ratio))

      progressContainer.appendChild(progressBar)
      item.appendChild(progressContainer)
    }

    // Output snippet
    if (activity.output && activity.status === 'running') {
      const outputEl = document.createElement("div")
      outputEl.className = "subagent-output"
      outputEl.textContent = truncate(sanitizeOutput(activity.output), 120)
      item.appendChild(outputEl)
    }

    list.appendChild(item)
  })

  applyRovingTabindex(list)
  container.appendChild(list)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
