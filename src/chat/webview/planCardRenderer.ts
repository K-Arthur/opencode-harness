import type { ToolCallBlock, Block, ToolCallClass } from "./types"
import type { PlanData } from "./planDetector"

export function renderPlanCard(plan: PlanData, opts: { postMessage?: (msg: Record<string, unknown>) => void }): HTMLElement {
  const card = document.createElement("div")
  card.className = "plan-card"

  const header = document.createElement("div")
  header.className = "plan-card-header"

  const icon = document.createElement("span")
  icon.className = "plan-card-icon"
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`
  header.appendChild(icon)

  const title = document.createElement("span")
  title.className = "plan-card-title"
  title.textContent = plan.name
  header.appendChild(title)

  const openBtn = document.createElement("button")
  openBtn.className = "plan-card-open-btn"
  openBtn.textContent = "Open in Editor"
  openBtn.title = `Open ${plan.filePath} in VS Code`
  openBtn.addEventListener("click", () => {
    opts.postMessage?.({ type: "open_file", path: plan.filePath })
  })
  header.appendChild(openBtn)

  card.appendChild(header)

  if (plan.overview) {
    const overview = document.createElement("div")
    overview.className = "plan-card-overview"
    overview.textContent = plan.overview
    card.appendChild(overview)
  }

  const todosList = document.createElement("div")
  todosList.className = "plan-card-todos"

  for (const todo of plan.todos) {
    const item = document.createElement("div")
    item.className = `plan-card-todo plan-card-todo--${todo.status}`
    const checkbox = document.createElement("span")
    checkbox.className = "plan-card-todo-checkbox"
    checkbox.textContent = todo.status === 'completed' ? '✓' : '○'
    item.appendChild(checkbox)

    const text = document.createElement("span")
    text.className = "plan-card-todo-text"
    text.textContent = todo.content
    item.appendChild(text)

    const status = document.createElement("span")
    status.className = "plan-card-todo-status"
    status.textContent = todo.status
    item.appendChild(status)

    todosList.appendChild(item)
  }

  card.appendChild(todosList)

  const footer = document.createElement("div")
  footer.className = "plan-card-footer"
  footer.textContent = `${plan.todos.filter(t => t.status === 'completed').length}/${plan.todos.length} completed · ${plan.filePath}`
  card.appendChild(footer)

  return card
}
