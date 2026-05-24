import type { Todo } from "./types"

export interface TodosPanelOptions {
  onToggleTodo: (todoId: string) => void
  onDeleteTodo: (todoId: string) => void
  onOpenFile: (filePath: string) => void
  onAddTodo?: (content: string) => void
  postMessage?: (msg: Record<string, unknown>) => void
}

let lastTodos: Todo[] = []
let activeFilter: 'all' | 'active' | 'completed' | 'in-progress' = 'all'

/* NOTE: Changed files rendering is handled exclusively by
 * changed-files-dropdown.ts. The todos panel no longer maintains
 * a parallel file-change rendering pipeline. */

// ─── Todo rendering (unchanged) ──────────────────────────────────────────────

export function setupTodosPanel(els: any, options: TodosPanelOptions) {
  const todosPanel = els.todosPanel
  const todosList = els.todosList
  const changedFilesList = els.changedFilesPanelList
  const closeBtn = els.closeTodosBtn
  const addForm = els.todoAddForm
  const addInput = els.todoAddInput

  if (!todosPanel || !todosList || !changedFilesList || !closeBtn) {
    console.warn("Todos panel elements not found")
    return
  }

  closeBtn.addEventListener("click", () => { todosPanel.classList.add("hidden") })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !todosPanel.classList.contains("hidden")) {
      todosPanel.classList.add("hidden")
    }
  })

  if (addForm && addInput) {
    addForm.addEventListener("submit", (e: Event) => {
      e.preventDefault()
      const content = (addInput as HTMLInputElement).value.trim()
      if (content && options.onAddTodo) {
        options.onAddTodo(content)
        ;(addInput as HTMLInputElement).value = ""
      }
    })
  }

  return {
    renderTodos: (todos: Todo[]) => {
      lastTodos = todos
      renderFilteredTodos(todosList, todos, options)
    },
    open: () => { todosPanel.classList.remove("hidden") },
    close: () => { todosPanel.classList.add("hidden") },
  }
}

function renderFilteredTodos(container: HTMLElement, todos: Todo[], options: TodosPanelOptions) {
  container.innerHTML = ""

  const total = todos.length
  const completed = todos.filter(t => t.status === "completed").length
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0

  const gaugeContainer = document.createElement("div")
  gaugeContainer.className = "todo-progress-container"
  gaugeContainer.innerHTML = `
    <div class="todo-progress-header">
      <span class="todo-progress-text">Task Progress</span>
      <span class="todo-progress-percentage">${progressPercent}%</span>
    </div>
    <div class="todo-progress-bar-track" aria-hidden="true">
      <div class="todo-progress-bar-fill" style="width: ${progressPercent}%"></div>
    </div>
  `
  container.appendChild(gaugeContainer)

  const filtersContainer = document.createElement("div")
  filtersContainer.className = "todo-filters"
  const filterTypes = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "in-progress", label: "In Progress" },
    { id: "completed", label: "Completed" }
  ]
  filterTypes.forEach(f => {
    const btn = document.createElement("button")
    btn.className = `todo-filter-btn${activeFilter === f.id ? " active" : ""}`
    btn.dataset.filter = f.id
    btn.textContent = f.label
    btn.setAttribute("role", "tab")
    btn.setAttribute("aria-selected", String(activeFilter === f.id))
    btn.addEventListener("click", () => {
      activeFilter = f.id as any
      renderFilteredTodos(container, todos, options)
    })
    filtersContainer.appendChild(btn)
  })
  container.appendChild(filtersContainer)

  let filtered = todos
  if (activeFilter === "active") filtered = todos.filter(t => t.status === "pending" || t.status === "in-progress")
  else if (activeFilter === "completed") filtered = todos.filter(t => t.status === "completed")
  else if (activeFilter === "in-progress") filtered = todos.filter(t => t.status === "in-progress")

  if (filtered.length === 0) {
    const empty = document.createElement("div")
    empty.className = "todos-empty"
    empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>All tasks completed! Enjoy the anti-gravity.</span>`
    container.appendChild(empty)
    return
  }

  const list = document.createElement("ul")
  list.className = "todos-list"
  filtered.forEach((todo) => {
    const item = document.createElement("li")
    item.className = `todo-item todo-item--${todo.status}`
    item.dataset.todoId = todo.id

    const isCompleted = todo.status === "completed"
    const checkbox = document.createElement("div")
    checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}`
    checkbox.setAttribute("role", "checkbox")
    checkbox.setAttribute("aria-checked", String(isCompleted))
    checkbox.setAttribute("aria-label", `Todo: ${todo.content}`)
    checkbox.setAttribute("tabindex", "0")
    checkbox.innerHTML = isCompleted ? `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ""

    const triggerToggle = () => { options.onToggleTodo(todo.id) }
    checkbox.addEventListener("click", triggerToggle)
    checkbox.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); triggerToggle() }
    })

    const statusContainer = document.createElement("div")
    statusContainer.className = "todo-status-container"
    if (todo.status === "in-progress") {
      const led = document.createElement("span")
      led.className = "todo-status-led"
      led.title = "In progress"
      statusContainer.appendChild(led)
    }

    const content = document.createElement("span")
    content.className = "todo-content"
    content.textContent = todo.content

    const tagContainer = document.createElement("div")
    tagContainer.className = "todo-tags"
    if (todo.id.startsWith("todo-")) {
      const tag = document.createElement("span")
      tag.className = "todo-tag todo-tag--user"
      tag.textContent = "User"
      tag.title = "User created task"
      tagContainer.appendChild(tag)
    }

    const deleteBtn = document.createElement("button")
    deleteBtn.className = "todo-delete-btn"
    deleteBtn.setAttribute("aria-label", "Delete todo")
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
    deleteBtn.addEventListener("click", () => { options.onDeleteTodo(todo.id) })

    item.appendChild(checkbox)
    item.appendChild(statusContainer)
    item.appendChild(content)
    item.appendChild(tagContainer)
    item.appendChild(deleteBtn)
    list.appendChild(item)
  })
  container.appendChild(list)
}
