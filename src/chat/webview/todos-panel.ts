import type { Todo, FileChange } from "./types"

export interface TodosPanelOptions {
  onToggleTodo: (todoId: string) => void
  onDeleteTodo: (todoId: string) => void
  onOpenFile: (filePath: string) => void
  onAddTodo?: (content: string) => void
}

let lastTodos: Todo[] = []
let activeFilter: 'all' | 'active' | 'completed' | 'in-progress' = 'all'

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

  // Close button handler
  closeBtn.addEventListener("click", () => {
    todosPanel.classList.add("hidden")
  })

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !todosPanel.classList.contains("hidden")) {
      todosPanel.classList.add("hidden")
    }
  })

  // Form submit handler for adding new local todos
  if (addForm && addInput) {
    addForm.addEventListener("submit", (e: Event) => {
      e.preventDefault()
      const content = addInput.value.trim()
      if (content && options.onAddTodo) {
        options.onAddTodo(content)
        addInput.value = ""
      }
    })
  }

  function handleFilterClick(e: Event) {
    const target = e.currentTarget as HTMLElement
    const filter = target.dataset.filter as any
    if (filter) {
      activeFilter = filter
      // Re-render filters and list locally
      renderFilteredTodos(todosList, lastTodos, options)
    }
  }

  return {
    renderTodos: (todos: Todo[]) => {
      lastTodos = todos
      renderFilteredTodos(todosList, todos, options)
    },
    renderChangedFiles: (files: FileChange[]) => {
      renderChangedFilesList(changedFilesList, files, options)
    },
    open: () => {
      todosPanel.classList.remove("hidden")
    },
    close: () => {
      todosPanel.classList.add("hidden")
    },
  }
}

function getFileIconSVG(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return `<svg class="file-icon file-icon--ts" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#3178C6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    case 'js':
    case 'jsx':
      return `<svg class="file-icon file-icon--js" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#F7DF1E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    case 'css':
      return `<svg class="file-icon file-icon--css" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1572B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    case 'html':
      return `<svg class="file-icon file-icon--html" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#E34F26" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    case 'json':
      return `<svg class="file-icon file-icon--json" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#F1C40F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    case 'md':
      return `<svg class="file-icon file-icon--md" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#4A90E2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    default:
      return `<svg class="file-icon file-icon--generic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  }
}

function renderFilteredTodos(container: HTMLElement, todos: Todo[], options: TodosPanelOptions) {
  container.innerHTML = ""

  // 1. Calculate & Render Progress Gauge at the top
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

  // 2. Render Filter Tabs
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
    
    // Add event listener directly
    btn.addEventListener("click", (e) => {
      activeFilter = f.id as any
      renderFilteredTodos(container, todos, options)
    })
    
    filtersContainer.appendChild(btn)
  })
  container.appendChild(filtersContainer)

  // 3. Filter todos list
  let filtered = todos
  if (activeFilter === "active") {
    filtered = todos.filter(t => t.status === "pending" || t.status === "in-progress")
  } else if (activeFilter === "completed") {
    filtered = todos.filter(t => t.status === "completed")
  } else if (activeFilter === "in-progress") {
    filtered = todos.filter(t => t.status === "in-progress")
  }

  // 4. Render empty state if empty
  if (filtered.length === 0) {
    const empty = document.createElement("div")
    empty.className = "todos-empty"
    empty.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
      <span>All tasks completed! Enjoy the anti-gravity.</span>
    `
    container.appendChild(empty)
    return
  }

  // 5. Render active list
  const list = document.createElement("ul")
  list.className = "todos-list"

  filtered.forEach((todo) => {
    const item = document.createElement("li")
    item.className = `todo-item todo-item--${todo.status}`
    item.dataset.todoId = todo.id

    // Checkbox (custom div to match CSS)
    const isCompleted = todo.status === "completed"
    const checkbox = document.createElement("div")
    checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}`
    checkbox.setAttribute("role", "checkbox")
    checkbox.setAttribute("aria-checked", String(isCompleted))
    checkbox.setAttribute("aria-label", `Todo: ${todo.content}`)
    checkbox.setAttribute("tabindex", "0")
    checkbox.innerHTML = isCompleted ? `
      <svg class="todo-checkbox-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    ` : ""
    
    const triggerToggle = () => { options.onToggleTodo(todo.id) }
    checkbox.addEventListener("click", triggerToggle)
    checkbox.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); triggerToggle() }
    })

    // Pulsing LED Dot for in-progress tasks
    const statusContainer = document.createElement("div")
    statusContainer.className = "todo-status-container"
    if (todo.status === "in-progress") {
      const led = document.createElement("span")
      led.className = "todo-status-led"
      led.title = "In progress"
      statusContainer.appendChild(led)
    }

    // Content
    const content = document.createElement("span")
    content.className = "todo-content"
    content.textContent = todo.content

    // Custom/Local Todo Tag
    const tagContainer = document.createElement("div")
    tagContainer.className = "todo-tags"
    if (todo.id.startsWith("todo-")) {
      const tag = document.createElement("span")
      tag.className = "todo-tag todo-tag--user"
      tag.textContent = "User"
      tag.title = "User created task"
      tagContainer.appendChild(tag)
    }

    // Delete button
    const deleteBtn = document.createElement("button")
    deleteBtn.className = "todo-delete-btn"
    deleteBtn.setAttribute("aria-label", "Delete todo")
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `
    deleteBtn.addEventListener("click", () => {
      options.onDeleteTodo(todo.id)
    })

    item.appendChild(checkbox)
    item.appendChild(statusContainer)
    item.appendChild(content)
    item.appendChild(tagContainer)
    item.appendChild(deleteBtn)
    list.appendChild(item)
  })

  container.appendChild(list)
}

function renderChangedFilesList(container: HTMLElement, files: FileChange[], options: TodosPanelOptions) {
  container.innerHTML = ""

  if (files.length === 0) {
    const empty = document.createElement("div")
    empty.className = "changed-files-empty"
    empty.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
        <path d="M12 18v-6" />
        <path d="M12 8h.01" />
      </svg>
      <span>No changed files tracked in this session.</span>
    `
    container.appendChild(empty)
    return
  }

  const list = document.createElement("ul")
  list.className = "changed-files-list-explorer"

  files.forEach((file) => {
    const item = document.createElement("li")
    item.className = "changed-file-item"

    // Extract paths for Explorer-like directory/filename display
    const parts = file.path.split("/")
    const fileNameText = parts.pop() || file.path
    const dirPathText = parts.join("/")

    // File Icon (Dynamic by extension)
    const iconSpan = document.createElement("span")
    iconSpan.className = "changed-file-icon"
    iconSpan.innerHTML = getFileIconSVG(fileNameText)

    // Name text container
    const nameContainer = document.createElement("div")
    nameContainer.className = "changed-file-name-container"
    
    const fileNameSpan = document.createElement("span")
    fileNameSpan.className = "changed-file-name"
    fileNameSpan.textContent = fileNameText
    fileNameSpan.title = file.path
    nameContainer.appendChild(fileNameSpan)

    if (dirPathText) {
      const dirSpan = document.createElement("span")
      dirSpan.className = "changed-file-dir"
      dirSpan.textContent = `${dirPathText}/`
      nameContainer.appendChild(dirSpan)
    }

    // Line Diff Badges (+ / -)
    const stats = document.createElement("span")
    stats.className = "changed-file-stats"
    if (file.added > 0) {
      const added = document.createElement("span")
      added.className = "changed-file-stat changed-file-stat--added"
      added.textContent = `+${file.added}`
      stats.appendChild(added)
    }
    if (file.removed > 0) {
      const removed = document.createElement("span")
      removed.className = "changed-file-stat changed-file-stat--removed"
      removed.textContent = `-${file.removed}`
      stats.appendChild(removed)
    }

    // Premium navigation button (Externallink icon)
    const openBtn = document.createElement("button")
    openBtn.className = "changed-file-open-btn"
    openBtn.setAttribute("aria-label", `Open ${file.path}`)
    openBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    `
    openBtn.addEventListener("click", () => {
      options.onOpenFile(file.path)
    })

    item.appendChild(iconSpan)
    item.appendChild(nameContainer)
    item.appendChild(stats)
    item.appendChild(openBtn)
    list.appendChild(item)
  })

  container.appendChild(list)
}
