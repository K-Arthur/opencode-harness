import type { Todo } from "./types"
import type { ElementRefs } from "./dom"
import { calculateProgress, applyTodoFilter, isUserTodo } from "./todos-logic"

export { calculateProgress, applyTodoFilter }

export interface TodosPanelOptions {
  onToggleTodo: (todo: Todo) => void
  onDeleteTodo: (todoId: string) => void
  onEditTodo?: (todoId: string, newContent: string) => void
  onAddTodo?: (content: string) => void
  /** Called when the user dismisses the panel (close button or Escape). */
  onPanelClose?: () => void
  postMessage?: (msg: Record<string, unknown>) => void
  getActiveFilter?: () => 'all' | 'active' | 'completed' | 'in-progress'
  setActiveFilter?: (filter: 'all' | 'active' | 'completed' | 'in-progress') => void
}

export type TodosPanelEls = Pick<ElementRefs,
  | "todosPanel"
  | "todosList"
  | "closeTodosBtn"
  | "todoAddForm"
  | "todoAddInput"
>

export interface TodosPanelApi {
  renderTodos: (todos: Todo[], isLoading?: boolean, sessionId?: string) => void
  renderError: (message: string, retry?: () => void) => void
  clearError: () => void
  open: () => void
  close: () => void
  isOpen: () => boolean
  showToast: (message: string, variant?: 'warning' | 'info', durationMs?: number) => void
  dispose: () => void
}

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

function createLoadingState(): HTMLElement {
  const el = document.createElement("div")
  el.className = "todo-loading"
  el.setAttribute("aria-label", "Loading tasks")
  el.innerHTML = `
    <div class="todo-skeleton">
      <div class="todo-skeleton-row"><div class="todo-skeleton-pulse" style="width:80%"></div></div>
      <div class="todo-skeleton-row"><div class="todo-skeleton-pulse" style="width:60%"></div></div>
      <div class="todo-skeleton-row"><div class="todo-skeleton-pulse" style="width:70%"></div></div>
    </div>`
  return el
}

function createErrorState(message: string, onRetry?: () => void): HTMLElement {
  const el = document.createElement("div")
  el.className = "todos-error"
  el.setAttribute("role", "alert")
  el.innerHTML = `
    <div class="todos-error-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    <div class="todos-error-message"></div>
  `
  const msgEl = el.querySelector('.todos-error-message') as HTMLElement
  msgEl.textContent = message
  if (onRetry) {
    const retryBtn = document.createElement("button")
    retryBtn.className = "todos-error-retry"
    retryBtn.textContent = "Retry"
    retryBtn.setAttribute("aria-label", "Retry loading tasks")
    retryBtn.addEventListener("click", () => onRetry())
    el.appendChild(retryBtn)
  }
  return el
}

function createContextualEmptyState(filter: string, sessionId: string | undefined, hasServerTodosEverLoaded: boolean): HTMLElement {
  const empty = document.createElement("div")
  empty.className = "todos-empty"

  if (filter !== "all") {
    empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><span>No tasks match the current filter</span>`
    return empty
  }

  if (!sessionId) {
    empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg><span>Session not yet connected. Tasks will appear here once the agent starts working.</span>`
    return empty
  }

  if (!hasServerTodosEverLoaded) {
    empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span>Waiting for tasks from the agent...</span>`
    return empty
  }

  empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>All tasks completed!</span>`
  return empty
}

function createTodoItem(todo: Todo, options: TodosPanelOptions): HTMLElement {
  const item = document.createElement("li")
  item.className = `todo-item todo-item--${todo.status}${isUserTodo(todo) ? " todo-item--user" : " todo-item--server"}`
  item.dataset.todoId = todo.id
  item.setAttribute("role", "listitem")
  item.tabIndex = 0

  const isCompleted = todo.status === "completed"
  const isCancelled = todo.status === "cancelled"
  const interactive = isUserTodo(todo)

  const checkbox = document.createElement("div")
  const readonlyCls = interactive ? "" : " todo-checkbox--readonly"
  const cancelledCls = isCancelled ? " todo-checkbox--cancelled" : ""
  checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}${cancelledCls}${readonlyCls}`
  checkbox.setAttribute("role", "checkbox")
  checkbox.setAttribute("aria-checked", String(isCompleted))
  checkbox.setAttribute("aria-label", `Todo: ${todo.content}`)
  if (interactive) {
    checkbox.setAttribute("tabindex", "-1")
  } else {
    checkbox.setAttribute("aria-readonly", "true")
    checkbox.title = "Server-managed task \u2014 read-only"
  }
  if (isCompleted) {
    checkbox.innerHTML = `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`
  } else if (isCancelled) {
    checkbox.innerHTML = `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  } else {
    checkbox.innerHTML = ""
  }

  if (interactive) {
    checkbox.addEventListener("click", () => options.onToggleTodo(todo))
  }

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
  content.title = todo.content

  const tagContainer = document.createElement("div")
  tagContainer.className = "todo-tags"
  if (todo.priority && ["high", "medium", "low"].includes(todo.priority)) {
    const badge = document.createElement("span")
    badge.className = `todo-tag todo-tag--priority todo-tag--priority-${todo.priority}`
    badge.textContent = todo.priority
    badge.title = `Priority: ${todo.priority}`
    tagContainer.appendChild(badge)
  }
  if (interactive) {
    const tag = document.createElement("span")
    tag.className = "todo-tag todo-tag--user"
    tag.textContent = "User"
    tag.title = "User created task"
    tagContainer.appendChild(tag)
  }

  item.appendChild(checkbox)
  item.appendChild(statusContainer)
  item.appendChild(content)
  item.appendChild(tagContainer)

  if (interactive) {
    const editBtn = document.createElement("button")
    editBtn.className = "todo-edit-btn"
    editBtn.setAttribute("aria-label", "Edit todo")
    editBtn.title = "Edit task"
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      startInlineEdit(item, todo, options)
    })
    item.appendChild(editBtn)

    const deleteBtn = document.createElement("button")
    deleteBtn.className = "todo-delete-btn"
    deleteBtn.setAttribute("aria-label", "Delete todo")
    deleteBtn.title = "Delete task"
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
    deleteBtn.addEventListener("click", () => options.onDeleteTodo(todo.id))
    item.appendChild(deleteBtn)

    item.addEventListener("dblclick", () => startInlineEdit(item, todo, options))
  }

  // Inline edit on double-click for server todos too (but disabled since onEditTodo won't be set)
  if (!interactive && options.onEditTodo) {
    item.addEventListener("dblclick", () => startInlineEdit(item, todo, options))
  }

  return item
}

function startInlineEdit(item: HTMLElement, todo: Todo, options: TodosPanelOptions): void {
  if (!options.onEditTodo) return

  const contentEl = item.querySelector<HTMLElement>('.todo-content')
  if (!contentEl) return

  // Don't start edit if already editing
  if (item.classList.contains('todo-item--editing')) return
  item.classList.add('todo-item--editing')

  const originalText = contentEl.textContent || todo.content
  const input = document.createElement('input')
  input.className = 'todo-edit-input'
  input.type = 'text'
  input.value = originalText
  input.setAttribute('aria-label', 'Edit task content')

  contentEl.replaceWith(input)
  input.focus()
  input.select()

  function finishEdit(save: boolean) {
    if (save) {
      const newText = input.value.trim()
      if (newText && newText !== originalText) {
        options.onEditTodo!(todo.id, newText)
      }
    }
    input.replaceWith(contentEl!)
    item.classList.remove('todo-item--editing')
  }

  input.addEventListener('blur', () => finishEdit(true))
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finishEdit(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finishEdit(false)
    }
  })
}

function startEditFromKeyboard(item: HTMLElement, todo: Todo, options: TodosPanelOptions): void {
  if (!isUserTodo(todo) || !options.onEditTodo) return
  startInlineEdit(item, todo, options)
}

function deleteFocusedItem(item: HTMLElement, todo: Todo, options: TodosPanelOptions): void {
  if (!isUserTodo(todo)) return
  options.onDeleteTodo(todo.id)
}

function moveFocusInList(current: HTMLElement, direction: 'prev' | 'next'): void {
  const list = current.closest('.todos-list')
  if (!list) return
  const items = Array.from(list.querySelectorAll<HTMLElement>('.todo-item:not(.todo-item--editing)'))
  const idx = items.indexOf(current)
  if (idx === -1) return
  const targetIdx = direction === 'next' ? idx + 1 : idx - 1
  if (targetIdx >= 0 && targetIdx < items.length) {
    items[targetIdx]!.focus()
    items[targetIdx]!.scrollIntoView({ block: 'nearest' })
  }
}

function jumpFocusInList(current: HTMLElement, position: 'first' | 'last'): void {
  const list = current.closest('.todos-list')
  if (!list) return
  const items = Array.from(list.querySelectorAll<HTMLElement>('.todo-item:not(.todo-item--editing)'))
  if (items.length === 0) return
  const target = position === 'first' ? items[0]! : items[items.length - 1]!
  target.focus()
  target.scrollIntoView({ block: 'nearest' })
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
    listContainer.setAttribute("role", "list")
    listContainer.setAttribute("aria-label", "Task list")
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
      const userClass = isUserTodo(todo) ? " todo-item--user" : " todo-item--server"
      const expectedClass = `todo-item todo-item--${todo.status}${userClass}`
      if (el.className !== expectedClass) {
        el.className = expectedClass
        const checkbox = el.querySelector('.todo-checkbox') as HTMLElement
        if (checkbox) {
          const isCompleted = todo.status === "completed"
          const isCancelled = todo.status === "cancelled"
          const readonlyCls = isUserTodo(todo) ? "" : " todo-checkbox--readonly"
          const cancelledCls = isCancelled ? " todo-checkbox--cancelled" : ""
          checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}${cancelledCls}${readonlyCls}`
          checkbox.setAttribute("aria-checked", String(isCompleted))
          if (isCompleted) {
            checkbox.innerHTML = `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`
          } else if (isCancelled) {
            checkbox.innerHTML = `<svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
          } else {
            checkbox.innerHTML = ""
          }
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

function setupListKeyboardNavigation(listEl: HTMLElement, todos: Todo[], options: TodosPanelOptions): void {
  listEl.addEventListener("keydown", (e: KeyboardEvent) => {
    // Skip if an input is focused (inline editing)
    if (e.target instanceof HTMLInputElement) return

    const item = (e.target as HTMLElement).closest?.('.todo-item') as HTMLElement | null
    if (!item) return

    const todoId = item.dataset.todoId
    const todo = todoId ? todos.find(t => t.id === todoId) : undefined
    if (!todo) return

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault()
        moveFocusInList(item, 'prev')
        break
      case "ArrowDown":
        e.preventDefault()
        moveFocusInList(item, 'next')
        break
      case "Home":
        e.preventDefault()
        jumpFocusInList(item, 'first')
        break
      case "End":
        e.preventDefault()
        jumpFocusInList(item, 'last')
        break
      case " ":
      case "Enter":
        // Enter on the main item area toggles completed status
        if (!(e.target as HTMLElement).closest?.('button, input, [role="checkbox"]')) {
          e.preventDefault()
          options.onToggleTodo(todo)
        }
        break
    }
  })
}

// ─── Panel setup ─────────────────────────────────────────────────────────────

export function setupTodosPanel(els: TodosPanelEls, options: TodosPanelOptions): TodosPanelApi | undefined {
  const todosPanel = els.todosPanel
  const todosList = els.todosList
  const closeBtn = els.closeTodosBtn
  const addForm = els.todoAddForm
  const addInput = els.todoAddInput

  if (!todosPanel || !todosList || !closeBtn) {
    console.warn("Todos panel elements not found")
    return undefined
  }

  let activeFilter: 'all' | 'active' | 'completed' | 'in-progress' = 'all'

  function getFilter() {
    return options.getActiveFilter ? options.getActiveFilter() : activeFilter
  }

  function setFilter(filter: 'all' | 'active' | 'completed' | 'in-progress') {
    activeFilter = filter
    if (options.setActiveFilter) options.setActiveFilter(filter)
  }

  const onCloseClick = () => {
    todosPanel.classList.add("hidden")
    options.onPanelClose?.()
  }
  closeBtn.addEventListener("click", onCloseClick)

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !todosPanel.classList.contains("hidden")) {
      todosPanel.classList.add("hidden")
      options.onPanelClose?.()
    }
  }
  document.addEventListener("keydown", onEscape)

  const onAddSubmit = (e: Event) => {
    e.preventDefault()
    if (!addInput) return
    const content = addInput.value.trim()
    if (content && options.onAddTodo) {
      options.onAddTodo(content)
      addInput.value = ""
    }
  }
  if (addForm && addInput) {
    addForm.addEventListener("submit", onAddSubmit)
  }

  // Track whether server todos have ever been received for each session
  const serverTodosEverLoadedMap = new Map<string, boolean>()
  // Track current todos for keyboard nav handler
  let currentTodos: Todo[] = []

  function renderFilteredTodos(container: HTMLElement, todos: Todo[], isLoading: boolean, sessionId: string | undefined) {
    currentTodos = todos
    const filter = getFilter()
    const filtered = applyTodoFilter(todos, filter)

    // Remove loading state if present
    container.querySelectorAll('.todo-loading').forEach(el => el.remove())

    if (isLoading) {
      container.querySelectorAll('.todo-progress-container, .todo-filters, .todos-empty, .todos-list')
        .forEach(el => el.remove())
      container.appendChild(createLoadingState())
      return
    }

    const progress = calculateProgress(todos)

    // Rebuild progress + filter tabs (cheap, no interactive state to preserve)
    container.querySelectorAll('.todo-progress-container, .todo-filters, .todos-empty')
      .forEach(el => el.remove())
    container.insertBefore(
      createFilterTabs(filter, (newFilter) => {
        setFilter(newFilter)
        renderFilteredTodos(container, todos, false, sessionId)
      }),
      container.firstChild,
    )
    container.insertBefore(createProgressGauge(progress), container.firstChild)

    // Track whether we've ever received server todos for this session
    if (sessionId && todos.length > 0) {
      serverTodosEverLoadedMap.set(sessionId, true)
    }

    // Reuse existing <ul> to preserve focus/scroll across renders
    const existingList = container.querySelector<HTMLElement>('.todos-list')
    if (filtered.length === 0) {
      if (existingList) existingList.remove()
      const hasEverLoaded = sessionId ? (serverTodosEverLoadedMap.get(sessionId) ?? false) : false
      container.appendChild(createContextualEmptyState(filter, sessionId, hasEverLoaded))
      return
    }
    const list = updateTodoList(existingList, filtered, options)
    if (!existingList) {
      container.appendChild(list)
      setupListKeyboardNavigation(list, filtered, options)
    }
  }

  function renderErrorState(message: string, onRetry?: () => void) {
    todosList.querySelectorAll(
      '.todo-loading, .todo-progress-container, .todo-filters, .todos-empty, .todos-list, .todos-error'
    ).forEach((el: Element) => el.remove())
    todosList.appendChild(createErrorState(message, onRetry))
  }

  function clearErrorState() {
    todosList.querySelectorAll('.todos-error').forEach((el: Element) => el.remove())
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
    renderTodos: (todos: Todo[], isLoading?: boolean, sessionId?: string) => {
      clearErrorState()
      renderFilteredTodos(todosList, todos, isLoading ?? false, sessionId)
    },
    renderError: (message: string, retry?: () => void) => {
      renderErrorState(message, retry)
    },
    clearError: () => { clearErrorState() },
    open: () => { todosPanel.classList.remove("hidden") },
    close: () => {
      todosPanel.classList.add("hidden")
      if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null }
    },
    isOpen: () => !todosPanel.classList.contains("hidden"),
    showToast,
    dispose: () => {
      document.removeEventListener("keydown", onEscape)
      closeBtn.removeEventListener("click", onCloseClick)
      if (addForm && addInput) addForm.removeEventListener("submit", onAddSubmit)
      if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null }
    },
  }
}
