import type { SubagentActivity } from "./types"

export interface SubagentPanelOptions {
  onCancelSubagent: (subagentId: string) => void
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

    // Header
    const header = document.createElement("div")
    header.className = "subagent-header"

    const name = document.createElement("div")
    name.className = "subagent-name"
    name.textContent = activity.name

    const status = document.createElement("div")
    status.className = "subagent-status"
    status.textContent = activity.status

    const cancelBtn = document.createElement("button")
    cancelBtn.className = "subagent-cancel-btn"
    cancelBtn.setAttribute("aria-label", `Cancel ${activity.name}`)
    cancelBtn.textContent = "Cancel"
    cancelBtn.addEventListener("click", () => {
      options.onCancelSubagent(activity.id)
    })

    header.appendChild(name)
    header.appendChild(status)
    header.appendChild(cancelBtn)

    // Progress bar
    if (activity.progress !== undefined) {
      const progressContainer = document.createElement("div")
      progressContainer.className = "subagent-progress-container"

      const progressBar = document.createElement("div")
      progressBar.className = "subagent-progress-bar"
      progressBar.style.width = `${activity.progress}%`

      progressContainer.appendChild(progressBar)
      item.appendChild(progressContainer)
    }

    item.appendChild(header)
    list.appendChild(item)
  })

  container.appendChild(list)
}
