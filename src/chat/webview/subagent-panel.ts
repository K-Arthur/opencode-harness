import type { SubagentActivity } from "./types"

export interface SubagentPanelOptions {
  onCancelSubagent: (subagentId: string) => void
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

export function setupSubagentPanel(els: any, options: SubagentPanelOptions) {
  const subagentPanel = els.subagentPanel
  const subagentList = els.subagentList
  const closeBtn = els.closeSubagentBtn

  if (!subagentPanel || !subagentList || !closeBtn) {
    console.warn("Subagent panel elements not found")
    return
  }

  // Close button handler
  closeBtn.addEventListener("click", () => {
    subagentPanel.classList.add("hidden")
  })

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !subagentPanel.classList.contains("hidden")) {
      subagentPanel.classList.add("hidden")
    }
  })

  return {
    renderActivities: (activities: SubagentActivity[]) => {
      renderSubagentList(subagentList, activities, options)
    },
    open: () => {
      subagentPanel.classList.remove("hidden")
    },
    close: () => {
      subagentPanel.classList.add("hidden")
    },
  }
}

function renderSubagentList(container: HTMLElement, activities: SubagentActivity[], options: SubagentPanelOptions) {
  container.innerHTML = ""

  if (activities.length === 0) {
    const empty = document.createElement("div")
    empty.className = "subagent-empty"
    empty.textContent = "No active subagents"
    container.appendChild(empty)
    return
  }

  const list = document.createElement("div")
  list.className = "subagent-list"

  activities.forEach((activity) => {
    const item = document.createElement("div")
    item.className = `subagent-item subagent-item--${activity.status}`
    item.dataset.subagentId = activity.id

    // Header row: name + domain badge + status
    const header = document.createElement("div")
    header.className = "subagent-header"

    const nameWrap = document.createElement("div")
    nameWrap.className = "subagent-name-wrap"

    const name = document.createElement("div")
    name.className = "subagent-name"
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
    status.className = "subagent-status"
    status.textContent = activity.status

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
      progressContainer.className = "subagent-progress-container"

      const progressBar = document.createElement("div")
      progressBar.className = "subagent-progress-bar"
      progressBar.style.width = `${activity.progress}%`

      progressContainer.appendChild(progressBar)
      item.appendChild(progressContainer)
    }

    // Output snippet
    if (activity.output && activity.status === 'running') {
      const outputEl = document.createElement("div")
      outputEl.className = "subagent-output"
      outputEl.textContent = truncate(activity.output, 120)
      item.appendChild(outputEl)
    }

    list.appendChild(item)
  })

  container.appendChild(list)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
