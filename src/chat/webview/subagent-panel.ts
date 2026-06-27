import type { SubagentActivity } from "./types"
import type { ElementRefs } from "./dom"
import {
  DOMAIN_FRONTEND_SVG,
  DOMAIN_BACKEND_SVG,
  DOMAIN_DATABASE_SVG,
  DOMAIN_API_SVG,
  DOMAIN_SHARED_SVG,
  CHEVRON_RIGHT_SVG,
  CHEVRON_DOWN_SVG,
} from "./icons"

export interface SubagentPanelOptions {
  onCancelSubagent: (subagentId: string) => void
  onOpenDetail: (activity: SubagentActivity) => void
  onClearCompleted?: () => void
  onMarkRead?: (subagentId: string) => void
  onOpenSession?: (activity: SubagentActivity) => void
  onPanelClose?: () => void
}

export type SubagentPanelEls = Pick<ElementRefs,
  | "subagentPanel"
  | "subagentList"
  | "closeSubagentBtn"
> & { subagentsToggleBtn?: HTMLElement | null }

export interface SubagentPanelApi {
  renderActivities: (activities: SubagentActivity[]) => void
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  dispose: () => void
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

const SUBAGENT_STATUS_WHITELIST = new Set(["running", "completed", "cancelled", "failed", "pending"])
function safeStatusClass(status: string): string {
  return SUBAGENT_STATUS_WHITELIST.has(status) ? status : "unknown"
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

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
  red: 'var(--oc-tdd-red)',
  green: 'var(--oc-tdd-green)',
  refactor: 'var(--oc-tdd-refactor)',
  coverage: 'var(--oc-tdd-coverage)',
}

const DOMAIN_ICONS: Record<string, string> = {
  frontend: DOMAIN_FRONTEND_SVG,
  backend: DOMAIN_BACKEND_SVG,
  database: DOMAIN_DATABASE_SVG,
  api: DOMAIN_API_SVG,
  shared: DOMAIN_SHARED_SVG,
}

export function setupSubagentPanel(els: SubagentPanelEls, options: SubagentPanelOptions): SubagentPanelApi | undefined {
  const subagentPanel = els.subagentPanel
  const subagentList = els.subagentList
  const closeBtn = els.closeSubagentBtn
  const toggleBtn = els.subagentsToggleBtn ?? null

  if (!subagentPanel || !subagentList) {
    console.warn("Subagent panel elements not found")
    return undefined
  }

  const onCloseClick = () => { close() }
  if (closeBtn) closeBtn.addEventListener("click", onCloseClick)

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) {
      close()
    }
  }
  document.addEventListener("keydown", onEscape)

  function isOpen(): boolean { return !subagentPanel.classList.contains("hidden") }

  function close(): void {
    subagentPanel.classList.add("hidden")
    toggleBtn?.focus()
    options.onPanelClose?.()
  }

  return {
    renderActivities: (activities: SubagentActivity[]) => {
      renderSubagentList(subagentList, activities, options)
    },
    open: () => { subagentPanel.classList.remove("hidden") },
    close,
    toggle: () => { if (isOpen()) close(); else subagentPanel.classList.remove("hidden") },
    isOpen,
    dispose: () => {
      document.removeEventListener("keydown", onEscape)
      if (closeBtn) closeBtn.removeEventListener("click", onCloseClick)
    },
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function renderAggregateStats(container: HTMLElement, activities: SubagentActivity[], options: SubagentPanelOptions): void {
  const existing = container.querySelector(".subagent-stats-bar")
  if (existing) existing.remove()

  const running = activities.filter(a => a.status === "running" || a.status === "pending").length
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

  if (completed > 0 && options.onClearCompleted) {
    const clearBtn = document.createElement("button")
    clearBtn.className = "subagent-clear-completed-btn"
    clearBtn.textContent = "Clear completed"
    clearBtn.type = "button"
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      options.onClearCompleted?.()
    })
    bar.appendChild(clearBtn)
  }

  container.insertBefore(bar, container.firstChild)
}

function applyRovingTabindex(list: HTMLElement): void {
  const items = Array.from(list.querySelectorAll<HTMLElement>(".subagent-item"))
  if (items.length === 0) return

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

const MAX_COMPLETED_VISIBLE = 10

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

function capActivities(activities: SubagentActivity[]): SubagentActivity[] {
  const live = activities.filter(a => !isTerminal(a.status))
  const terminal = activities
    .filter(a => isTerminal(a.status))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, MAX_COMPLETED_VISIBLE)
  return [...live, ...terminal]
}

function renderSubagentList(container: HTMLElement, activities: SubagentActivity[], options: SubagentPanelOptions) {
  container.innerHTML = ""

  const capped = capActivities(activities)

  renderAggregateStats(container, activities, options)

  if (capped.length === 0) {
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

  capped.forEach((activity, idx) => {
    const terminal = isTerminal(activity.status)
    const item = document.createElement("div")
    item.className = `subagent-item subagent-item--${safeStatusClass(activity.status)}`
    if (terminal) item.classList.add("subagent-item--collapsed")
    item.dataset.subagentId = activity.id
    item.setAttribute("role", "option")
    item.setAttribute("tabindex", idx === 0 ? "0" : "-1")
    item.setAttribute("aria-label", `Open details for ${activity.name}`)

    const openDetail = () => {
      options.onMarkRead?.(activity.id)
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

    if (activity.domain) {
      const badge = document.createElement("span")
      badge.className = "subagent-domain-badge"
      const iconHtml = DOMAIN_ICONS[activity.domain] ?? DOMAIN_SHARED_SVG
      const domain = activity.domain
      badge.innerHTML = ""
      const iconSpan = document.createElement("span")
      iconSpan.className = "subagent-domain-icon"
      iconSpan.setAttribute("aria-hidden", "true")
      iconSpan.innerHTML = iconHtml
      const labelSpan = document.createElement("span")
      labelSpan.className = "subagent-domain-label"
      labelSpan.textContent = domain
      badge.appendChild(iconSpan)
      badge.appendChild(labelSpan)
      nameWrap.appendChild(badge)
    }

    const status = document.createElement("div")
    status.className = `subagent-item-status subagent-item-status--${safeStatusClass(activity.status)}`
    status.textContent = statusLabel(activity.status)

    if (activity.status === 'running') {
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "subagent-cancel-btn"
      cancelBtn.setAttribute("aria-label", `Cancel ${activity.name}`)
      cancelBtn.textContent = "Cancel"
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        options.onCancelSubagent(activity.id)
      })
      header.appendChild(nameWrap)
      header.appendChild(status)
      header.appendChild(cancelBtn)
    } else if (terminal) {
      // Terminal items: expand toggle + status
      const expandBtn = document.createElement("button")
      expandBtn.className = "subagent-expand-btn"
      expandBtn.setAttribute("aria-label", "Toggle details")
      expandBtn.setAttribute("aria-expanded", "false")
      expandBtn.type = "button"
      expandBtn.innerHTML = CHEVRON_RIGHT_SVG
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        item.classList.toggle("subagent-item--collapsed")
        const collapsed = item.classList.contains("subagent-item--collapsed")
        expandBtn.setAttribute("aria-expanded", String(!collapsed))
        expandBtn.innerHTML = collapsed ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG
      })
      header.appendChild(nameWrap)
      header.appendChild(status)
      header.appendChild(expandBtn)
    } else {
      header.appendChild(nameWrap)
      header.appendChild(status)
    }

    if (activity.sessionId && options.onOpenSession) {
      const openSessionBtn = document.createElement("button")
      openSessionBtn.className = "subagent-open-session-btn"
      openSessionBtn.type = "button"
      openSessionBtn.setAttribute("aria-label", `Open ${activity.name}'s session`)
      openSessionBtn.title = "Open this subagent's session in a tab"
      openSessionBtn.textContent = "Open session"
      openSessionBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        options.onOpenSession?.(activity)
      })
      header.appendChild(openSessionBtn)
    }

    item.appendChild(header)

    // Click to open detail view (works for all statuses)
    item.style.cursor = "pointer"
    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".subagent-cancel-btn")) return
      if ((e.target as HTMLElement).closest(".subagent-expand-btn")) return
      if ((e.target as HTMLElement).closest(".subagent-open-session-btn")) return
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
