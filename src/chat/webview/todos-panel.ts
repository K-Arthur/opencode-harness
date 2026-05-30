import type { Todo } from "./types"
import { calculateProgress, applyTodoFilter } from "./todos-logic"

export { calculateProgress, applyTodoFilter }

export interface TodosPanelOptions {
  onToggleTodo: (todo: Todo) => void
  onDeleteTodo: (todoId: string) => void
  onOpenFile: (filePath: string) => void
  onAddTodo?: (content: string) => void
  postMessage?: (msg: Record<string, unknown>) => void
  getActiveFilter?: () => 'all' | 'active' | 'completed' | 'in-progress'
  setActiveFilter?: (filter: 'all' | 'active' | 'completed' | 'in-progress') => void
}

/* NOTE: Changed files rendering is handled exclusively by
 * changed-files-dropdown.ts. The todos panel no longer maintains
 * a parallel file-change rendering pipeline. */

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function createProgressGauge(progress: { percent: number; completed: number; total: number }): HTMLElement {
  const gaugeContainer = document.createElement("div")
  gaugeContainer.className = "todo-progress-container"
  gaugeContainer.innerHTML = `
    <div class="todo-progress-header">
      <span class="todo-progress-text">Task Progress</span>
      <span class="todo-progress-percentage">${progress.percent}%</span>
    </div>
    <div class="todo-progress-bar-track" aria-hidden="true">
      <div class="todo-progress-bar-fill" style="--p: ${(progress.percent / 100).toFixed(3)}"></div>
    </div>
  `
  return gaugeContainer
}

function createFilterTabs(
  activeFilter: 'all' | 'active' | 'completed' | 'in-progress',
  onChange: (filter: 'all' | 'active' | 'completed' | 'in-progress') => void
): HTMLElement {
  const filtersContainer = document.createElement("div")
  filtersContainer.className = "todo-filters"
  filtersContainer.setAttribute("role", "tablist")
  filtersContainer.setAttribute("aria-label", "Todo filters")

  const filterTypes = [
    { id: "all" as const, label: "All" },
    { id: "active" as const, label: "Active" },
    { id: "in-progress" as const, label: "In Progress" },
    { id: "completed" as const, label: "Completed" }
  ]

  filterTypes.forEach(f => {
    const btn = document.createElement("button")
    btn.className = `todo-filter-btn${activeFilter === f.id ? " active" : ""}`
    btn.dataset.filter = f.id
    btn.textContent = f.label
    btn.setAttribute("role", "tab")
    btn.setAttribute("aria-selected", String(activeFilter === f.id))
    btn.setAttribute("tabindex", activeFilter === f.id ? "0" : "-1")
    btn.addEventListener("click", () => {
      onChange(f.id)
    })
    filtersContainer.appendChild(btn)
  })

  // Keyboard navigation for tabs
  filtersContainer.addEventListener("keydown", (e: KeyboardEvent) => {
    const tabs = Array.from(filtersContainer.querySelectorAll<HTMLElement>('[role="tab"]'))
    const idx = tabs.findIndex(t => t.classList.contains("active"))
    if (e.key === "ArrowRight") {
      e.preventDefault()
      const next = tabs[(idx + 1) % tabs.length]!
      next.focus()
      next.click()
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length]!
      prev.focus()
      prev.click()
    }
  })

  return filtersContainer
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement("div")
  empty.className = "todos-empty"
  empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>All tasks completed! Enjoy the anti-gravity.</span>`
  return empty
}

function createTodoItem(todo: Todo, options: TodosPanelOptions): HTMLElement {
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

  checkbox.addEventListener("click", () => options.onToggleTodo(todo))
  checkbox.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); options.onToggleTodo(todo) }
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
  deleteBtn.addEventListener("click", () => options.onDeleteTodo(todo.id))

  item.appendChild(checkbox)
  item.appendChild(statusContainer)
  item.appendChild(content)
  item.appendChild(tagContainer)
  item.appendChild(deleteBtn)
  return item
}

/** Diff the DOM list against the new filtered todo set to preserve focus/scroll. */
function updateTodoList(
  listContainer: HTMLElement | null,
  filtered: Todo[],
  options: TodosPanelOptions
): HTMLElement {
  if (!listContainer) {
    listContainer = document.createElement("ul")
    listContainer.className = "todos-list"
  }

  const existing = Array.from(listContainer.children) as HTMLElement[]
  const existingMap = new Map(existing.map(el => [el.dataset.todoId!, el]))
  const newMap = new Map(filtered.map(t => [t.id, t]))

  // Remove items no longer in filtered set
  existing.forEach(el => {
    const id = el.dataset.todoId
    if (!id || !newMap.has(id)) {
      el.remove()
    }
  })

  // Add or update items in order
  filtered.forEach((todo, index) => {
    const el = existingMap.get(todo.id)
    if (el) {
      // Update status class if changed
      const expectedClass = `todo-item todo-item--${todo.status}`
      if (el.className !== expectedClass) {
        el.className = expectedClass
        const checkbox = el.querySelector('.todo-checkbox') as HTMLElement
        if (checkbox) {
          const isCompleted = todo.status === "completed"
          checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}`
          checkbox.setAttribute("aria-checked", String(isCompleted))
          checkbox.innerHTML = isCompleted ? `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ""
        }
      }
      // Ensure correct order
      if (el !== listContainer!.children[index]) {
        listContainer!.insertBefore(el, listContainer!.children[index] || null)
      }
    } else {
      const item = createTodoItem(todo, options)
      listContainer!.insertBefore(item, listContainer!.children[index] || null)
    }
  })

  return listContainer
}

// ─── Panel setup ─────────────────────────────────────────────────────────────

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

  let activeFilter: 'all' | 'active' | 'completed' | 'in-progress' = 'all'

  function getFilter() {
    return options.getActiveFilter ? options.getActiveFilter() : activeFilter
  }

  function setFilter(filter: 'all' | 'active' | 'completed' | 'in-progress') {
    activeFilter = filter
    if (options.setActiveFilter) options.setActiveFilter(filter)
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

  function renderFilteredTodos(container: HTMLElement, todos: Todo[]) {
    const filter = getFilter()
    const progress = calculateProgress(todos)
    const filtered = applyTodoFilter(todos, filter)

    // Rebuild static sections (progress + filters)
    container.innerHTML = ""
    container.appendChild(createProgressGauge(progress))
    container.appendChild(createFilterTabs(filter, (newFilter) => {
      setFilter(newFilter)
      renderFilteredTodos(container, todos)
    }))

    if (filtered.length === 0) {
      container.appendChild(createEmptyState())
      return
    }

    const list = updateTodoList(null, filtered, options)
    container.appendChild(list)
  }

  let toastTimeout: ReturnType<typeof setTimeout> | null = null
  function showToast(message: string, variant: 'warning' | 'info' = 'info', durationMs = 2500) {
    if (!todosPanel) return
    let toast = todosPanel.querySelector('.todo-toast') as HTMLElement | null
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'todo-toast'
      todosPanel.appendChild(toast)
    }
    toast.textContent = message
    toast.className = `todo-toast todo-toast--${variant}`
    // Force reflow for animation restart
    void toast.offsetWidth
    toast.classList.add('visible')

    if (toastTimeout) clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => {
      toast!.classList.remove('visible')
    }, durationMs)
  }

  return {
    renderTodos: (todos: Todo[]) => {
      renderFilteredTodos(todosList, todos)
    },
    open: () => { todosPanel.classList.remove("hidden") },
    close: () => { todosPanel.classList.add("hidden") },
    showToast,
  }
}
