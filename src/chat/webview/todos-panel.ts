import type { Todo, FileChange } from "./types"

export interface TodosPanelOptions {
  onToggleTodo: (todoId: string) => void
  onDeleteTodo: (todoId: string) => void
  onOpenFile: (filePath: string) => void
}

export function setupTodosPanel(els: any, options: TodosPanelOptions) {
  const todosPanel = els.todosPanel
  const todosList = els.todosList
  const changedFilesList = els.changedFilesPanelList
  const closeBtn = els.closeTodosBtn

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

  return {
    renderTodos: (todos: Todo[]) => {
      renderTodosList(todosList, todos, options)
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

function renderTodosList(container: HTMLElement, todos: Todo[], options: TodosPanelOptions) {
  container.innerHTML = ""

  if (todos.length === 0) {
    const empty = document.createElement("div")
    empty.className = "todos-empty"
    empty.textContent = "No active todos"
    container.appendChild(empty)
    return
  }

  const list = document.createElement("ul")
  list.className = "todos-list"

  todos.forEach((todo) => {
    const item = document.createElement("li")
    item.className = `todo-item todo-item--${todo.status}`
    item.dataset.todoId = todo.id

    // Checkbox (custom div to match CSS; todos are server-managed)
    const isCompleted = todo.status === "completed"
    const checkbox = document.createElement("div")
    checkbox.className = `todo-checkbox${isCompleted ? " todo-checkbox--checked" : ""}`
    checkbox.setAttribute("role", "checkbox")
    checkbox.setAttribute("aria-checked", String(isCompleted))
    checkbox.setAttribute("aria-label", `Todo: ${todo.content}`)
    checkbox.setAttribute("tabindex", "0")
    checkbox.addEventListener("click", () => { options.onToggleTodo(todo.id) })
    checkbox.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); options.onToggleTodo(todo.id) }
    })

    // Content
    const content = document.createElement("span")
    content.className = "todo-content"
    content.textContent = todo.content

    // Delete button
    const deleteBtn = document.createElement("button")
    deleteBtn.className = "todo-delete-btn"
    deleteBtn.setAttribute("aria-label", "Delete todo")
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
    deleteBtn.addEventListener("click", () => {
      options.onDeleteTodo(todo.id)
    })

    item.appendChild(checkbox)
    item.appendChild(content)
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
    empty.textContent = "No changed files"
    container.appendChild(empty)
    return
  }

  const list = document.createElement("ul")
  list.className = "changed-files-list"

  files.forEach((file) => {
    const item = document.createElement("li")
    item.className = "changed-file-item"

    const fileName = document.createElement("span")
    fileName.className = "changed-file-name"
    fileName.textContent = file.path.split("/").pop() || file.path
    fileName.title = file.path

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

    const openBtn = document.createElement("button")
    openBtn.className = "changed-file-open-btn"
    openBtn.setAttribute("aria-label", `Open ${file.path}`)
    openBtn.textContent = "Open"
    openBtn.addEventListener("click", () => {
      options.onOpenFile(file.path)
    })

    item.appendChild(fileName)
    item.appendChild(stats)
    item.appendChild(openBtn)
    list.appendChild(item)
  })

  container.appendChild(list)
}
