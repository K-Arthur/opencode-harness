import type { Todo, FileChange } from "./types"

export interface TodosPanelOptions {
  onToggleTodo: (todoId: string) => void
  onDeleteTodo: (todoId: string) => void
  onOpenFile: (filePath: string) => void
  onAddTodo?: (content: string) => void
  postMessage?: (msg: Record<string, unknown>) => void
}

let lastTodos: Todo[] = []
let activeFilter: 'all' | 'active' | 'completed' | 'in-progress' = 'all'

// --- Changed Files panel state ---
let _cfSortMode: 'changes' | 'alpha' = 'changes'
let _cfCompact = false
let _cfExpandedFiles = new Set<string>()
let _cfCollapsedDirs = new Set<string>()
// Cache of diff data per path: null = loading, DiffLine[] = loaded, string = error
const _cfDiffCache = new Map<string, import("./types").DiffLine[] | null | string>()
// Registry of containers to re-render when diff data arrives
const _cfContainers = new WeakMap<HTMLElement, { files: FileChange[]; options: TodosPanelOptions }>()

/** Reset all module-level CF state — use in unit tests for isolation */
export function resetChangedFilesState(): void {
  _cfSortMode = 'changes'
  _cfCompact = false
  _cfExpandedFiles.clear()
  _cfCollapsedDirs.clear()
  _cfDiffCache.clear()
}

/** Called from main.ts when a file_diff_response arrives */
export function handleFileDiffResponse(path: string, lines: import("./types").DiffLine[] | null, error?: string): void {
  _cfDiffCache.set(path, error ? error : (lines ?? []))
  // Re-render any open containers that are waiting for this path
  document.querySelectorAll<HTMLElement>(".cf-hunk-preview--open[data-path]").forEach(el => {
    if (el.dataset.path === path) renderHunkPreview(el, path)
  })
}

function safeNum(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n)
  return Number.isFinite(v) ? v : 0
}

function inferStatus(added: number, removed: number): 'A' | 'M' | 'D' {
  if (removed === 0 && added > 0) return 'A'
  if (added === 0 && removed > 0) return 'D'
  return 'M'
}

function getFileIconSVG(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const colors: Record<string, string> = {
    ts: '#3178C6', tsx: '#3178C6', js: '#F7DF1E', jsx: '#F7DF1E',
    css: '#1572B6', html: '#E34F26', json: '#F1C40F', md: '#4A90E2',
    py: '#3776AB', rs: '#CE422B', go: '#00ADD8', yaml: '#CB171E', yml: '#CB171E',
  }
  const color = (ext && colors[ext]) || 'currentColor'
  return `<svg class="file-icon file-icon--${ext ?? 'generic'}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
}

function renderHunkPreview(previewEl: HTMLElement, path: string): void {
  const data = _cfDiffCache.get(path)
  if (data === null || data === undefined) {
    previewEl.innerHTML = '<div class="cf-hunk-loading"><span class="cf-hunk-loading-dot"></span>Loading diff…</div>'
    return
  }
  if (typeof data === 'string') {
    previewEl.innerHTML = `<div class="cf-hunk-error">⚠ ${data}</div>`
    return
  }
  if (data.length === 0) {
    previewEl.innerHTML = '<div class="cf-hunk-empty">No diff lines available</div>'
    return
  }
  const lines = data.slice(0, 60) // cap at 60 lines for performance
  previewEl.innerHTML = ''
  const pre = document.createElement('pre')
  pre.className = 'cf-hunk-code'
  lines.forEach(line => {
    const span = document.createElement('span')
    span.className = `cf-hunk-line cf-hunk-line--${line.type}`
    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
    span.textContent = prefix + line.content
    pre.appendChild(span)
    pre.appendChild(document.createTextNode('\n'))
  })
  if (data.length > 60) {
    const more = document.createElement('span')
    more.className = 'cf-hunk-more'
    more.textContent = `… ${data.length - 60} more lines`
    pre.appendChild(more)
  }
  previewEl.appendChild(pre)
}

export function renderChangedFilesList(container: HTMLElement, files: FileChange[], options: TodosPanelOptions): void {
  container.innerHTML = ''

  if (files.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'cf-empty'
    empty.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M12 18v-6"/><path d="M12 8h.01"/></svg><span>No changed files in this session.</span>`
    container.appendChild(empty)
    return
  }

  const safeFiles = files.map(f => ({ ...f, added: safeNum(f.added), removed: safeNum(f.removed) }))

  // Sort
  const sorted = [...safeFiles].sort((a, b) =>
    _cfSortMode === 'alpha'
      ? a.path.localeCompare(b.path)
      : (b.added + b.removed) - (a.added + a.removed)
  )

  // Totals
  const totalAdded = sorted.reduce((s, f) => s + f.added, 0)
  const totalRemoved = sorted.reduce((s, f) => s + f.removed, 0)
  const maxChange = Math.max(1, ...sorted.map(f => f.added + f.removed))

  // --- Summary bar ---
  const summaryBar = document.createElement('div')
  summaryBar.className = 'cf-summary-bar'
  const totalChange = totalAdded + totalRemoved
  const addedPct = totalChange > 0 ? Math.round((totalAdded / totalChange) * 100) : 50
  summaryBar.innerHTML = `
    <span class="cf-summary-count">${sorted.length} file${sorted.length !== 1 ? 's' : ''}</span>
    <span class="cf-summary-stats"><span class="cf-stat-added">+${totalAdded}</span> <span class="cf-stat-removed">−${totalRemoved}</span></span>
    <div class="cf-summary-diffbar" aria-hidden="true">
      <div class="cf-summary-diffbar-added" style="width:${addedPct}%"></div>
      <div class="cf-summary-diffbar-removed" style="width:${100 - addedPct}%"></div>
    </div>
  `
  container.appendChild(summaryBar)

  // --- Controls ---
  const controls = document.createElement('div')
  controls.className = 'cf-controls'
  controls.innerHTML = `
    <button class="cf-sort-btn icon-btn" data-action="toggle-sort" title="Sort: ${_cfSortMode === 'changes' ? 'most changed' : 'alphabetical'}" aria-label="Toggle sort order">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
      ${_cfSortMode === 'changes' ? 'By changes' : 'A–Z'}
    </button>
    <button class="cf-compact-btn icon-btn" data-action="toggle-compact" title="Compact mode" aria-label="Toggle compact mode" aria-pressed="${_cfCompact}">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <button class="cf-collapse-all-btn icon-btn" data-action="collapse-all" title="Collapse all groups" aria-label="Collapse all file groups">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>
    </button>
    <button class="cf-expand-all-btn icon-btn" data-action="expand-all" title="Expand all groups" aria-label="Expand all file groups">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 9l-7 7-7-7"/></svg>
    </button>
  `

  controls.querySelector('[data-action="toggle-sort"]')!.addEventListener('click', () => {
    _cfSortMode = _cfSortMode === 'changes' ? 'alpha' : 'changes'
    renderChangedFilesList(container, files, options)
  })
  controls.querySelector('[data-action="toggle-compact"]')!.addEventListener('click', () => {
    _cfCompact = !_cfCompact
    renderChangedFilesList(container, files, options)
  })
  controls.querySelector('[data-action="collapse-all"]')!.addEventListener('click', () => {
    sorted.forEach(f => { const dir = f.path.split('/').slice(0, -1).join('/') || '.'; _cfCollapsedDirs.add(dir) })
    renderChangedFilesList(container, files, options)
  })
  controls.querySelector('[data-action="expand-all"]')!.addEventListener('click', () => {
    _cfCollapsedDirs.clear()
    renderChangedFilesList(container, files, options)
  })
  container.appendChild(controls)

  // --- Group by directory ---
  const dirMap = new Map<string, FileChange[]>()
  sorted.forEach(f => {
    const parts = f.path.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    if (!dirMap.has(dir)) dirMap.set(dir, [])
    dirMap.get(dir)!.push(f)
  })

  dirMap.forEach((dirFiles, dir) => {
    const isCollapsed = _cfCollapsedDirs.has(dir)

    const group = document.createElement('div')
    group.className = 'cf-dir-group'

    const header = document.createElement('button')
    header.className = 'cf-dir-header'
    header.setAttribute('aria-expanded', String(!isCollapsed))
    const chevronDir = isCollapsed ? 'M9 18l6-6-6-6' : 'M6 9l6 6 6-6'
    header.innerHTML = `
      <svg class="cf-dir-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${chevronDir}"/></svg>
      <span class="cf-dir-name">${dir === '.' ? '(root)' : dir}</span>
      <span class="cf-dir-count">${dirFiles.length}</span>
    `
    header.addEventListener('click', () => {
      if (isCollapsed) _cfCollapsedDirs.delete(dir)
      else _cfCollapsedDirs.add(dir)
      renderChangedFilesList(container, files, options)
    })
    group.appendChild(header)

    const body = document.createElement('div')
    body.className = `cf-dir-body${isCollapsed ? ' cf-dir-body--collapsed' : ''}`

    dirFiles.forEach(file => {
      const parts = file.path.split('/')
      const fileName: string = parts[parts.length - 1] ?? file.path
      const status = inferStatus(file.added, file.removed)
      const fileChange = file.added + file.removed
      const barWidth = Math.round((fileChange / maxChange) * 100)
      const addedBarPct = fileChange > 0 ? Math.round((file.added / fileChange) * 100) : 50
      const isExpanded = _cfExpandedFiles.has(file.path)

      const row = document.createElement('div')
      row.className = `cf-file-row${_cfCompact ? ' cf-file-row--compact' : ''}${isExpanded ? ' cf-file-row--expanded' : ''}`
      row.setAttribute('data-path', file.path)

      // Status badge
      const badge = document.createElement('span')
      badge.className = `cf-status-badge cf-status-badge--${status}`
      badge.textContent = status
      badge.title = status === 'A' ? 'Added' : status === 'D' ? 'Deleted' : 'Modified'

      // File icon
      const icon = document.createElement('span')
      icon.className = 'cf-file-icon'
      icon.innerHTML = getFileIconSVG(fileName)

      // Name
      const name = document.createElement('span')
      name.className = 'cf-file-name'
      name.textContent = fileName ?? file.path
      name.title = file.path

      // Diff bar + stats
      const diffBarWrap = document.createElement('div')
      diffBarWrap.className = 'cf-diffbar'
      diffBarWrap.style.width = `${Math.max(barWidth, 4)}%`
      diffBarWrap.innerHTML = `<div class="cf-diffbar-added" style="width:${addedBarPct}%"></div><div class="cf-diffbar-removed" style="width:${100 - addedBarPct}%"></div>`

      const stats = document.createElement('span')
      stats.className = 'cf-file-stats'
      if (file.added > 0) {
        const a = document.createElement('span')
        a.className = 'cf-stat-added'
        a.textContent = `+${file.added}`
        stats.appendChild(a)
      }
      if (file.removed > 0) {
        const r = document.createElement('span')
        r.className = 'cf-stat-removed'
        r.textContent = `−${file.removed}`
        stats.appendChild(r)
      }

      // Expand chevron
      const expandBtn = document.createElement('button')
      expandBtn.className = 'cf-expand-btn icon-btn'
      expandBtn.setAttribute('aria-label', isExpanded ? 'Collapse diff preview' : 'Expand diff preview')
      expandBtn.setAttribute('aria-expanded', String(isExpanded))
      expandBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${isExpanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}"/></svg>`

      // Open button
      const openBtn = document.createElement('button')
      openBtn.className = 'changed-file-open-btn icon-btn'
      openBtn.setAttribute('aria-label', `Open ${file.path}`)
      openBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); options.onOpenFile(file.path) })

      // Hunk preview
      const preview = document.createElement('div')
      preview.className = `cf-hunk-preview${isExpanded ? ' cf-hunk-preview--open' : ''}`
      preview.setAttribute('data-path', file.path)
      if (isExpanded) renderHunkPreview(preview, file.path)

      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (_cfExpandedFiles.has(file.path)) {
          _cfExpandedFiles.delete(file.path)
        } else {
          _cfExpandedFiles.add(file.path)
          // Request diff if not already cached
          if (!_cfDiffCache.has(file.path)) {
            _cfDiffCache.set(file.path, null) // mark loading
            options.postMessage?.({ type: 'get_file_diff', path: file.path })
          }
        }
        renderChangedFilesList(container, files, options)
      })

      row.appendChild(badge)
      row.appendChild(icon)
      row.appendChild(name)
      row.appendChild(diffBarWrap)
      row.appendChild(stats)
      row.appendChild(expandBtn)
      row.appendChild(openBtn)
      body.appendChild(row)
      body.appendChild(preview)
    })

    group.appendChild(body)
    container.appendChild(group)
  })
}

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
    renderChangedFiles: (files: FileChange[]) => {
      renderChangedFilesList(changedFilesList, files, options)
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
