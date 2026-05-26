/**
 * Changed Files Dropdown — canonical single implementation.
 *
 * Renders as a toolbar button (with a count badge) that opens a floating
 * dropdown anchored below the header. Replaces:
 *   - the chip strip in #changed-files-list (fileTracking.ts)
 *   - the "Changed Files" section inside #todos-panel (todos-panel.ts)
 *
 * Pattern: Codex / Claude Code / Cline — toolbar icon → dropdown panel.
 *
 * State is partitioned per-session: every session keeps its own sort mode,
 * expanded/collapsed sets, diff cache, and last-known files list. The UI
 * only ever displays state for `_currentSessionId`, but writes from any
 * session are stored so switching tabs surfaces the right state without
 * a host round-trip. Cross-session leakage is impossible by construction.
 */

import type { FileChange, DiffLine } from "./types"
import { renderFileChipListHtml } from "./file-chip-list"

// ─── Per-session state ────────────────────────────────────────────────────────

interface ChangedFilesState {
  sortMode: "changes" | "alpha"
  compact: boolean
  expandedFiles: Set<string>
  collapsedDirs: Set<string>
  diffCache: Map<string, DiffLine[] | null | string>
  lastFiles: FileChange[]
}

function _createState(): ChangedFilesState {
  return {
    sortMode: "changes",
    compact: false,
    expandedFiles: new Set<string>(),
    collapsedDirs: new Set<string>(),
    diffCache: new Map<string, DiffLine[] | null | string>(),
    lastFiles: [],
  }
}

const _sessionStates = new Map<string, ChangedFilesState>()

function _stateFor(sessionId: string): ChangedFilesState {
  let s = _sessionStates.get(sessionId)
  if (!s) {
    s = _createState()
    _sessionStates.set(sessionId, s)
  }
  return s
}

// ─── Module-level UI state (not session-scoped) ───────────────────────────────

let _currentSessionId: string | null = null
let _postMessage: ((msg: Record<string, unknown>) => void) | null = null
let _treeContainer: HTMLElement | null = null
let _btn: HTMLButtonElement | null = null
let _panel: HTMLElement | null = null
let _badge: HTMLElement | null = null
let _isOpen = false
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null
let _keyHandler: ((e: KeyboardEvent) => void) | null = null
let _resizeHandler: (() => void) | null = null

/** Reset all state — for unit-test isolation and port-change resilience */
export function resetChangedFilesDropdown(): void {
  _sessionStates.clear()
  _currentSessionId = null
  _isOpen = false
}

/** Drop one session's state (e.g. on session deletion) */
export function resetSessionState(sessionId: string): void {
  _sessionStates.delete(sessionId)
  if (_currentSessionId === sessionId) {
    _currentSessionId = null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ChangedFilesDropdownOptions {
  /** Toolbar button that opens/closes the dropdown — null to anchor to #changed-files-strip */
  btn: HTMLButtonElement | null
  /** Floating panel element to populate */
  panel: HTMLElement
  /** Container inside the panel to render the file tree into */
  treeContainer: HTMLElement
  /** Badge element on the button showing file count */
  badge: HTMLElement
  /** Callback to post a message to the extension host */
  postMessage: (msg: Record<string, unknown>) => void
  /** Open a file in the editor */
  onOpenFile: (path: string) => void
}

let _onOpenFile: (path: string) => void = () => {}

export function setupChangedFilesDropdown(opts: ChangedFilesDropdownOptions): void {
  _btn = opts.btn
  _panel = opts.panel
  _treeContainer = opts.treeContainer
  _badge = opts.badge
  _postMessage = opts.postMessage
  _onOpenFile = opts.onOpenFile

  // Initially hidden
  _panel.classList.add("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "false")
  _updateBadge(0)

  if (_btn) {
    _btn.addEventListener("click", (e) => {
      e.stopPropagation()
      _toggle()
    })
  }

  // Close button inside the dropdown
  const closeBtn = document.getElementById("cf-dropdown-close")
  if (closeBtn) {
    closeBtn.addEventListener("click", () => _close())
  }
}

/**
 * Switch which session's state is currently displayed in the dropdown + strip.
 * Pass `null` when no session is active (e.g. on session deletion with no
 * fallback). Triggers a re-render of the visible UI.
 */
export function setCurrentSession(sessionId: string | null): void {
  _currentSessionId = sessionId
  if (sessionId === null) {
    _updateBadge(0)
    if (_btn && _btn.isConnected) _btn.classList.add("hidden")
    const strip = document.getElementById("changed-files-strip")
    if (strip) { strip.classList.add("hidden"); strip.innerHTML = "" }
    if (_isOpen && _treeContainer) _renderTree(_treeContainer, [])
    return
  }
  const state = _stateFor(sessionId)
  _refreshUI(sessionId, state.lastFiles)
}

/** Called by main.ts when changed_files_update arrives. sessionId is REQUIRED. */
export function updateChangedFiles(sessionId: string, files: FileChange[]): void {
  const state = _stateFor(sessionId)
  state.lastFiles = files
  if (sessionId === _currentSessionId) {
    _refreshUI(sessionId, files)
  }
}

function _refreshUI(sessionId: string, files: FileChange[]): void {
  _updateBadge(files.length)
  if (_btn && _btn.isConnected) {
    _btn.classList.toggle("hidden", files.length === 0)
    _btn.classList.toggle("cf-btn--has-files", files.length > 0)
    _btn.setAttribute("aria-label", `Changed files (${files.length})`)
  }
  if (_isOpen && _treeContainer) {
    _renderTree(_treeContainer, files)
  }
  _renderStrip(sessionId, files)
}

/**
 * Render the always-visible compact strip above the input area.
 * Shows file basenames (up to MAX_VISIBLE) then an overflow count.
 * Clicking the strip opens the full dropdown panel.
 *
 * Public for backwards compatibility; internal callers should prefer
 * `updateChangedFiles` which routes through `_refreshUI`.
 */
const CF_STRIP_MAX = 5
export function updateChangedFilesStrip(sessionId: string, files: FileChange[]): void {
  const state = _stateFor(sessionId)
  state.lastFiles = files
  if (sessionId === _currentSessionId) {
    _renderStrip(sessionId, files)
  }
}

function _renderStrip(_sessionId: string, files: FileChange[]): void {
  const strip = document.getElementById("changed-files-strip")
  if (!strip) return
  if (files.length === 0) {
    strip.classList.add("hidden")
    strip.innerHTML = ""
    return
  }
  strip.classList.remove("hidden")
  strip.innerHTML = renderFileChipListHtml(
    files.map((f) => f.path ?? "").filter((p) => p.length > 0),
    { maxVisible: CF_STRIP_MAX, showLeadingIcon: true, showCountLabel: true, countLabelSuffix: "changed" },
  )
  // Single click anywhere on the strip opens the full dropdown
  strip.onclick = (e) => {
    e.stopPropagation()
    _toggle()
  }
  strip.setAttribute("aria-label", `${files.length} changed file${files.length !== 1 ? "s" : ""} — click to view`)
}

/** Called by main.ts when file_diff_response arrives. sessionId is REQUIRED. */
export function handleDiffResponse(sessionId: string, path: string, lines: DiffLine[] | null, error?: string): void {
  const state = _stateFor(sessionId)
  state.diffCache.set(path, error ? error : (lines ?? []))
  if (sessionId !== _currentSessionId) return
  document.querySelectorAll<HTMLElement>(".cf-hunk-preview--open[data-path]").forEach((el) => {
    if (el.dataset.path === path) _renderHunk(el, sessionId, path)
  })
}

// ─── Dropdown open / close ────────────────────────────────────────────────────

function _toggle(): void {
  if (_isOpen) _close()
  else _open()
}

function _open(): void {
  if (!_panel || !_treeContainer) return
  _isOpen = true
  _panel.classList.remove("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "true")

  // Anchor to the strip when btn is absent/detached, otherwise anchor to btn
  const anchor: Element | null =
    (_btn && _btn.isConnected) ? _btn : document.getElementById("changed-files-strip")
  if (anchor) positionPanel(anchor)

  const files = _currentSessionId ? _stateFor(_currentSessionId).lastFiles : []
  _renderTree(_treeContainer, files)

  // Dismiss on outside click
  const strip = document.getElementById("changed-files-strip")
  _outsideClickHandler = (e: MouseEvent) => {
    const target = e.target as Node
    if (_panel && !_panel.contains(target) && !strip?.contains(target) && !_btn?.contains(target)) {
      _close()
    }
  }
  _keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") _close() }
  _resizeHandler = () => {
    const trigger: Element | null =
      (_btn && _btn.isConnected) ? _btn : document.getElementById("changed-files-strip")
    if (_isOpen && trigger) positionPanel(trigger)
  }
  requestAnimationFrame(() => {
    document.addEventListener("click", _outsideClickHandler!)
    document.addEventListener("keydown", _keyHandler!)
    window.addEventListener("resize", _resizeHandler!)
  })
}

function positionPanel(anchor: Element): void {
  if (!_panel) return
  const margin = 8
  const r = anchor.getBoundingClientRect()
  const panelW = Math.min(440, Math.max(300, window.innerWidth - margin * 2))
  const estimatedHeight = Math.min(540, Math.max(260, _panel.getBoundingClientRect().height || 420))
  const spaceBelow = window.innerHeight - r.bottom - margin
  const spaceAbove = r.top - margin
  const openAbove = spaceBelow < Math.min(260, estimatedHeight) && spaceAbove > spaceBelow
  const maxHeight = Math.max(220, Math.floor((openAbove ? spaceAbove : spaceBelow) - 4))
  const visibleHeight = Math.min(estimatedHeight, maxHeight)
  const leftEdge = Math.min(
    Math.max(margin, r.right - panelW),
    Math.max(margin, window.innerWidth - panelW - margin),
  )
  const top = openAbove
    ? Math.max(margin, r.top - visibleHeight - 6)
    : Math.min(window.innerHeight - margin - visibleHeight, r.bottom + 6)

  _panel.style.position = "fixed"
  _panel.style.top = `${Math.max(margin, top)}px`
  _panel.style.left = `${leftEdge}px`
  _panel.style.right = "auto"
  _panel.style.width = `${panelW}px`
  _panel.style.maxHeight = `${maxHeight}px`
  _panel.style.overflow = "auto"
}

function _close(): void {
  if (!_panel) return
  _isOpen = false
  _panel.classList.add("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "false")
  if (_outsideClickHandler) document.removeEventListener("click", _outsideClickHandler)
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler)
  if (_resizeHandler) window.removeEventListener("resize", _resizeHandler)
  _outsideClickHandler = null
  _keyHandler = null
  _resizeHandler = null
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function _updateBadge(count: number): void {
  if (!_badge) return
  _badge.textContent = count > 0 ? String(count) : ""
  _badge.classList.toggle("hidden", count === 0)
}

// ─── Tree rendering ───────────────────────────────────────────────────────────

function safeNum(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n)
  return Number.isFinite(v) ? v : 0
}

function _inferStatus(added: number, removed: number): "A" | "M" | "D" {
  if (removed === 0 && added > 0) return "A"
  if (added === 0 && removed > 0) return "D"
  return "M"
}

function _fileIconSVG(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase()
  const colors: Record<string, string> = {
    ts: "#3178C6", tsx: "#3178C6", js: "#F7DF1E", jsx: "#F7DF1E",
    css: "#1572B6", html: "#E34F26", json: "#F1C40F", md: "#4A90E2",
    py: "#3776AB", rs: "#CE422B", go: "#00ADD8", yaml: "#CB171E", yml: "#CB171E",
  }
  const color = (ext && colors[ext]) || "currentColor"
  return `<svg class="cf-file-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
}

function _renderTree(container: HTMLElement, files: FileChange[]): void {
  container.innerHTML = ""

  if (files.length === 0) {
    container.innerHTML = `<div class="cf-empty"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M12 18v-6"/><path d="M12 8h.01"/></svg><span>No changed files in this session.</span></div>`
    return
  }

  const sessionId = _currentSessionId
  if (!sessionId) return
  const state = _stateFor(sessionId)

  const safe = files.map((f) => ({ ...f, added: safeNum(f.added), removed: safeNum(f.removed) }))
  const sorted = [...safe].sort((a, b) =>
    state.sortMode === "alpha"
      ? a.path.localeCompare(b.path)
      : (b.added + b.removed) - (a.added + a.removed)
  )

  const totalAdded = sorted.reduce((s, f) => s + f.added, 0)
  const totalRemoved = sorted.reduce((s, f) => s + f.removed, 0)
  const maxChange = Math.max(1, ...sorted.map((f) => f.added + f.removed))
  const totalChange = totalAdded + totalRemoved
  const addedPct = totalChange > 0 ? Math.round((totalAdded / totalChange) * 100) : 50

  // Summary bar
  const summary = document.createElement("div")
  summary.className = "cf-summary-bar"
  summary.innerHTML = `
    <span class="cf-summary-count">${sorted.length} file${sorted.length !== 1 ? "s" : ""}</span>
    <span class="cf-summary-stats"><span class="cf-stat-added">+${totalAdded}</span> <span class="cf-stat-removed">−${totalRemoved}</span></span>
    <div class="cf-summary-diffbar" aria-hidden="true">
      <div class="cf-summary-diffbar-added" style="width:${addedPct}%"></div>
      <div class="cf-summary-diffbar-removed" style="width:${100 - addedPct}%"></div>
    </div>
  `
  container.appendChild(summary)

  // Controls
  const controls = document.createElement("div")
  controls.className = "cf-controls"
  controls.innerHTML = `
    <button class="cf-sort-btn icon-btn" data-action="toggle-sort" title="Sort: ${state.sortMode === "changes" ? "most changed" : "alphabetical"}" aria-label="Toggle sort order">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
      ${state.sortMode === "changes" ? "By changes" : "A–Z"}
    </button>
    <button class="cf-compact-btn icon-btn" data-action="toggle-compact" title="Compact mode" aria-label="Toggle compact mode" aria-pressed="${state.compact}">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <button class="icon-btn" data-action="collapse-all" title="Collapse all" aria-label="Collapse all groups">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>
    </button>
    <button class="icon-btn" data-action="expand-all" title="Expand all" aria-label="Expand all groups">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 9l-7 7-7-7"/></svg>
    </button>
  `
  controls.querySelector('[data-action="toggle-sort"]')!.addEventListener("click", () => {
    state.sortMode = state.sortMode === "changes" ? "alpha" : "changes"
    _renderTree(container, files)
  })
  controls.querySelector('[data-action="toggle-compact"]')!.addEventListener("click", () => {
    state.compact = !state.compact
    _renderTree(container, files)
  })
  controls.querySelector('[data-action="collapse-all"]')!.addEventListener("click", () => {
    sorted.forEach((f) => { const d = f.path.split("/").slice(0, -1).join("/") || "."; state.collapsedDirs.add(d) })
    _renderTree(container, files)
  })
  controls.querySelector('[data-action="expand-all"]')!.addEventListener("click", () => {
    state.collapsedDirs.clear()
    _renderTree(container, files)
  })
  container.appendChild(controls)

  // Group by directory
  const dirMap = new Map<string, FileChange[]>()
  sorted.forEach((f) => {
    const parts = f.path.split("/")
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "."
    if (!dirMap.has(dir)) dirMap.set(dir, [])
    dirMap.get(dir)!.push(f)
  })

  dirMap.forEach((dirFiles, dir) => {
    const isCollapsed = state.collapsedDirs.has(dir)
    const group = document.createElement("div")
    group.className = "cf-dir-group"

    const header = document.createElement("button")
    header.className = "cf-dir-header"
    header.setAttribute("aria-expanded", String(!isCollapsed))
    header.innerHTML = `
      <svg class="cf-dir-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${isCollapsed ? "M9 18l6-6-6-6" : "M6 9l6 6 6-6"}"/></svg>
      <span class="cf-dir-name">${dir === "." ? "(root)" : dir}</span>
      <span class="cf-dir-count">${dirFiles.length}</span>
    `
    header.addEventListener("click", () => {
      if (isCollapsed) state.collapsedDirs.delete(dir)
      else state.collapsedDirs.add(dir)
      _renderTree(container, files)
    })
    group.appendChild(header)

    const body = document.createElement("div")
    body.className = `cf-dir-body${isCollapsed ? " cf-dir-body--collapsed" : ""}`

    dirFiles.forEach((file) => {
      const parts = file.path.split("/")
      const fileName: string = parts[parts.length - 1] ?? file.path
      const status = _inferStatus(file.added, file.removed)
      const fileChange = file.added + file.removed
      const barWidth = Math.round((fileChange / maxChange) * 100)
      const addedBarPct = fileChange > 0 ? Math.round((file.added / fileChange) * 100) : 50
      const isExpanded = state.expandedFiles.has(file.path)

      const row = document.createElement("div")
      row.className = `cf-file-row${state.compact ? " cf-file-row--compact" : ""}${isExpanded ? " cf-file-row--expanded" : ""}`
      row.setAttribute("data-path", file.path)

      const badge = document.createElement("span")
      badge.className = `cf-status-badge cf-status-badge--${status}`
      badge.textContent = status
      badge.title = status === "A" ? "Added" : status === "D" ? "Deleted" : "Modified"

      const icon = document.createElement("span")
      icon.className = "cf-file-icon"
      icon.innerHTML = _fileIconSVG(fileName)

      const name = document.createElement("span")
      name.className = "cf-file-name"
      name.textContent = fileName
      name.title = file.path

      const diffBarWrap = document.createElement("div")
      diffBarWrap.className = "cf-diffbar"
      diffBarWrap.style.width = `${Math.max(barWidth, 4)}%`
      diffBarWrap.innerHTML = `<div class="cf-diffbar-added" style="width:${addedBarPct}%"></div><div class="cf-diffbar-removed" style="width:${100 - addedBarPct}%"></div>`

      const stats = document.createElement("span")
      stats.className = "cf-file-stats"
      if (file.added > 0) {
        const a = document.createElement("span"); a.className = "cf-stat-added"; a.textContent = `+${file.added}`; stats.appendChild(a)
      }
      if (file.removed > 0) {
        const r = document.createElement("span"); r.className = "cf-stat-removed"; r.textContent = `−${file.removed}`; stats.appendChild(r)
      }

      const expandBtn = document.createElement("button")
      expandBtn.className = "cf-expand-btn icon-btn"
      expandBtn.setAttribute("aria-label", isExpanded ? "Collapse diff" : "Expand diff")
      expandBtn.setAttribute("aria-expanded", String(isExpanded))
      expandBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}"/></svg>`

      const openBtn = document.createElement("button")
      openBtn.className = "cf-open-btn icon-btn"
      openBtn.setAttribute("aria-label", `Open ${file.path}`)
      openBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
      openBtn.addEventListener("click", (e) => { e.stopPropagation(); _onOpenFile(file.path) })

      const preview = document.createElement("div")
      preview.className = `cf-hunk-preview${isExpanded ? " cf-hunk-preview--open" : ""}`
      preview.setAttribute("data-path", file.path)
      if (isExpanded) _renderHunk(preview, sessionId, file.path)

      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        if (state.expandedFiles.has(file.path)) {
          state.expandedFiles.delete(file.path)
        } else {
          state.expandedFiles.add(file.path)
          if (!state.diffCache.has(file.path)) {
            state.diffCache.set(file.path, null)
            _postMessage?.({ type: "get_file_diff", path: file.path, sessionId })
          }
        }
        _renderTree(container, files)
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

function _renderHunk(el: HTMLElement, sessionId: string, path: string): void {
  const state = _stateFor(sessionId)
  const data = state.diffCache.get(path)
  if (data === null || data === undefined) {
    el.innerHTML = '<div class="cf-hunk-loading"><span class="cf-hunk-loading-dot"></span>Loading diff…</div>'
    return
  }
  if (typeof data === "string") {
    el.innerHTML = `<div class="cf-hunk-error">⚠ ${data}</div>`
    return
  }
  if (data.length === 0) {
    el.innerHTML = '<div class="cf-hunk-empty">No diff lines available</div>'
    return
  }
  const lines = data.slice(0, 60)
  el.innerHTML = ""
  const pre = document.createElement("pre")
  pre.className = "cf-hunk-code"
  lines.forEach((line) => {
    const span = document.createElement("span")
    span.className = `cf-hunk-line cf-hunk-line--${line.type}`
    const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " "
    span.textContent = prefix + line.content
    pre.appendChild(span)
    pre.appendChild(document.createTextNode("\n"))
  })
  if (data.length > 60) {
    const more = document.createElement("span")
    more.className = "cf-hunk-more"
    more.textContent = `… ${data.length - 60} more lines`
    pre.appendChild(more)
  }
  el.appendChild(pre)
}
