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

const DIFF_CACHE_MAX = 50

interface ChangedFilesState {
  sortMode: "changes" | "alpha"
  expandedFiles: Set<string>
  diffCache: Map<string, DiffLine[] | null | string>
  lastFiles: FileChange[]
}

function _createState(): ChangedFilesState {
  return {
    sortMode: "changes",
    expandedFiles: new Set<string>(),
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
let _refreshScheduled = false
let _resizeScheduled = false

/**
 * Schedule a callback on the next animation frame, falling back to a macrotask
 * when rAF is unavailable (non-browser test envs without a stub).
 */
function _raf(cb: () => void): void {
  const r = (globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame
  if (typeof r === "function") r(() => cb())
  else setTimeout(cb, 0)
}

/** Reset all state — for unit-test isolation and port-change resilience */
export function resetChangedFilesDropdown(): void {
  _sessionStates.clear()
  _currentSessionId = null
  _isOpen = false
  _refreshScheduled = false
  _resizeScheduled = false
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

  // Bind the strip's click-to-open handler ONCE. The strip container element is
  // stable across re-renders (only its innerHTML changes), so rebinding it on
  // every render — as the old code did — was pure churn.
  const strip = document.getElementById("changed-files-strip")
  if (strip) {
    strip.addEventListener("click", (e) => {
      e.stopPropagation()
      _toggle()
    })
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

/**
 * Called by main.ts when changed_files_update arrives. sessionId is REQUIRED.
 *
 * Renders are COALESCED: during streaming the host emits many file_edited events
 * in quick succession. Rendering synchronously on each one rebuilt the whole tree
 * (and strip) dozens of times per second, freezing the webview. Instead we store
 * the latest payload and schedule a single render on the next frame.
 */
export function updateChangedFiles(sessionId: string, files: FileChange[]): void {
  const state = _stateFor(sessionId)
  state.lastFiles = files
  if (sessionId !== _currentSessionId) return // off-screen session: store only
  if (_refreshScheduled) return // a render is already queued; it will read lastFiles
  _refreshScheduled = true
  _raf(() => {
    _refreshScheduled = false
    const cur = _currentSessionId
    if (cur) _refreshUI(cur, _stateFor(cur).lastFiles)
  })
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
    strip.removeAttribute("data-cf-sig")
    return
  }
  strip.classList.remove("hidden")
  const paths = files.map((f) => f.path ?? "").filter((p) => p.length > 0)
  // Skip the innerHTML rebuild when the visible content is unchanged — the strip
  // shows basenames + a count, so paths + length fully determine its markup.
  const sig = `${files.length}|${paths.join("|")}`
  if (strip.getAttribute("data-cf-sig") === sig) return
  strip.setAttribute("data-cf-sig", sig)
  strip.innerHTML = renderFileChipListHtml(
    paths,
    { maxVisible: CF_STRIP_MAX, showLeadingIcon: true, showCountLabel: true, countLabelSuffix: "changed" },
  )
  // NOTE: the click-to-open handler is bound once in setupChangedFilesDropdown;
  // it survives innerHTML updates because it lives on the stable strip element.
  strip.setAttribute("aria-label", `${files.length} changed file${files.length !== 1 ? "s" : ""} — click to view`)
}

function _setDiffCache(cache: Map<string, DiffLine[] | null | string>, path: string, value: DiffLine[] | null | string): void {
  if (cache.has(path)) {
    cache.delete(path)
  } else if (cache.size >= DIFF_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(path, value)
}

/** Called by main.ts when file_diff_response arrives. sessionId is REQUIRED. */
export function handleDiffResponse(sessionId: string, path: string, lines: DiffLine[] | null, error?: string): void {
  const state = _stateFor(sessionId)
  _setDiffCache(state.diffCache, path, error ? error : (lines ?? []))
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
    // Coalesce resize bursts to one reposition per frame — positionPanel reads
    // layout (getBoundingClientRect) and must not run on every resize event.
    if (_resizeScheduled) return
    _resizeScheduled = true
    _raf(() => {
      _resizeScheduled = false
      const trigger: Element | null =
        (_btn && _btn.isConnected) ? _btn : document.getElementById("changed-files-strip")
      if (_isOpen && trigger) positionPanel(trigger)
    })
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

function _expandIcon(expanded: boolean): string {
  return `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${expanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}"/></svg>`
}

/**
 * Toggle a single file row's expansion in place — no full-tree rebuild.
 * Mutating only the affected row keeps expand/collapse O(1) instead of
 * O(files × lines), which is what made large changesets jank on every click.
 */
function _renderRowExpansion(
  row: HTMLElement,
  preview: HTMLElement,
  expandBtn: HTMLElement,
  expanded: boolean,
  sessionId: string,
  path: string,
): void {
  row.classList.toggle("cf-file-row--expanded", expanded)
  expandBtn.setAttribute("aria-expanded", String(expanded))
  expandBtn.setAttribute("aria-label", expanded ? "Collapse diff" : "Expand diff")
  expandBtn.innerHTML = _expandIcon(expanded)
  preview.classList.toggle("cf-hunk-preview--open", expanded)
  if (expanded) _renderHunk(preview, sessionId, path)
  else preview.innerHTML = ""
}

function _renderTree(container: HTMLElement, files: FileChange[]): void {
  container.innerHTML = ""

  if (files.length === 0) {
    container.innerHTML = `<div class="cf-empty">No changed files in this session.</div>`
    return
  }

  const sessionId = _currentSessionId
  if (!sessionId) return
  const state = _stateFor(sessionId)

  const safe: FileChange[] = files.map((f) => ({ ...f, added: safeNum(f.added), removed: safeNum(f.removed) }))
  const sorted = [...safe].sort((a, b) =>
    state.sortMode === "alpha"
      ? a.path.localeCompare(b.path)
      : (b.added + b.removed) - (a.added + a.removed)
  )

  // Summary bar — file count + aggregate added/removed across the changeset.
  const totalAdded = safe.reduce((s, f) => s + f.added, 0)
  const totalRemoved = safe.reduce((s, f) => s + f.removed, 0)
  const summary = document.createElement("div")
  summary.className = "cf-summary-bar"
  const countSpan = document.createElement("span")
  countSpan.className = "cf-summary-count"
  countSpan.textContent = `${files.length} file${files.length !== 1 ? "s" : ""}`
  const totals = document.createElement("span")
  totals.className = "cf-summary-stats"
  const addEl = document.createElement("span"); addEl.className = "cf-stat-added"; addEl.textContent = `+${totalAdded}`
  const remEl = document.createElement("span"); remEl.className = "cf-stat-removed"; remEl.textContent = `−${totalRemoved}`
  totals.appendChild(addEl); totals.appendChild(document.createTextNode(" ")); totals.appendChild(remEl)
  summary.appendChild(countSpan)
  summary.appendChild(totals)
  container.appendChild(summary)

  // Controls — sort toggle + collapse-all.
  const controls = document.createElement("div")
  controls.className = "cf-controls"
  controls.innerHTML = `
    <button class="cf-sort-btn" data-action="toggle-sort" title="Sort: ${state.sortMode === "changes" ? "most changed" : "alphabetical"}" aria-label="Toggle sort order">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
      ${state.sortMode === "changes" ? "By changes" : "A–Z"}
    </button>
    <button class="cf-collapse-all-btn" data-action="collapse-all" title="Collapse all" aria-label="Collapse all diffs">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>
      Collapse all
    </button>
  `
  controls.querySelector('[data-action="toggle-sort"]')!.addEventListener("click", () => {
    state.sortMode = state.sortMode === "changes" ? "alpha" : "changes"
    _renderTree(container, files)
  })
  controls.querySelector('[data-action="collapse-all"]')!.addEventListener("click", () => {
    state.expandedFiles.clear()
    _renderTree(container, files)
  })
  container.appendChild(controls)

  // File list, grouped by parent directory. Files at the repo root group
  // under "/". Grouping is a layout concern only — per-row expand/collapse
  // stays incremental (no full-tree rebuild) via _renderRowExpansion.
  const list = document.createElement("div")
  list.className = "cf-file-list"

  const groups = new Map<string, typeof sorted>()
  for (const file of sorted) {
    const slash = file.path.lastIndexOf("/")
    const dir = slash > 0 ? file.path.slice(0, slash) : ""
    let bucket = groups.get(dir)
    if (!bucket) { bucket = []; groups.set(dir, bucket) }
    bucket.push(file)
  }

  for (const [dir, groupFiles] of groups) {
    const group = document.createElement("div")
    group.className = "cf-dir-group"
    const header = document.createElement("div")
    header.className = "cf-dir-header"
    header.textContent = dir === "" ? "/" : dir
    group.appendChild(header)

    groupFiles.forEach((file) => {
      const parts = file.path.split("/")
      const fileName = parts[parts.length - 1] ?? file.path
      const status = _inferStatus(file.added, file.removed)
      const isExpanded = state.expandedFiles.has(file.path)

      const row = document.createElement("div")
      row.className = `cf-file-row${isExpanded ? " cf-file-row--expanded" : ""}`
      row.setAttribute("data-path", file.path)
      row.tabIndex = 0

      const badge = document.createElement("span")
      badge.className = `cf-status-badge cf-status-badge--${status}`
      badge.textContent = status
      badge.title = status === "A" ? "Added" : status === "D" ? "Deleted" : "Modified"

      const name = document.createElement("span")
      name.className = "cf-file-name"
      name.textContent = fileName
      name.title = file.path

      let planTag: HTMLElement | undefined
      if (file.isPlanDocument) {
        planTag = document.createElement("span")
        planTag.className = "cf-plan-tag"
        planTag.textContent = "plan"
        planTag.title = "Plan document written by the agent"
      }

      const stats = document.createElement("span")
      stats.className = "cf-file-stats"
      if (file.added > 0) {
        const a = document.createElement("span"); a.className = "cf-stat-added"; a.textContent = `+${file.added}`; stats.appendChild(a)
      }
      if (file.removed > 0) {
        const r = document.createElement("span"); r.className = "cf-stat-removed"; r.textContent = `−${file.removed}`; stats.appendChild(r)
      }

      const openBtn = document.createElement("button")
      openBtn.className = "cf-open-btn"
      openBtn.setAttribute("aria-label", "Open file")
      openBtn.title = "Open file"
      openBtn.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M5 7v12h12"/></svg>`
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        _onOpenFile(file.path)
      })

      const expandBtn = document.createElement("button")
      expandBtn.className = "cf-expand-btn"
      expandBtn.setAttribute("aria-label", isExpanded ? "Collapse diff" : "Expand diff")
      expandBtn.setAttribute("aria-expanded", String(isExpanded))
      expandBtn.innerHTML = _expandIcon(isExpanded)

      const preview = document.createElement("div")
      preview.className = `cf-hunk-preview${isExpanded ? " cf-hunk-preview--open" : ""}`
      preview.setAttribute("data-path", file.path)
      if (isExpanded) _renderHunk(preview, sessionId, file.path)

      row.addEventListener("click", (e) => {
        const target = e.target as HTMLElement
        if (target.closest(".cf-expand-btn") || target.closest(".cf-open-btn")) return
        _onOpenFile(file.path)
      })

      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { _onOpenFile(file.path) }
      })

      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        const willExpand = !state.expandedFiles.has(file.path)
        if (willExpand) {
          state.expandedFiles.add(file.path)
          if (!state.diffCache.has(file.path)) {
            _setDiffCache(state.diffCache, file.path, null)
            _postMessage?.({ type: "get_file_diff", path: file.path, sessionId })
          }
        } else {
          state.expandedFiles.delete(file.path)
        }
        // Mutate only this row — never rebuild the whole tree on expand/collapse.
        _renderRowExpansion(row, preview, expandBtn, willExpand, sessionId, file.path)
      })

      row.appendChild(badge)
      row.appendChild(name)
      if (planTag) row.appendChild(planTag)
      row.appendChild(stats)
      row.appendChild(openBtn)
      row.appendChild(expandBtn)
      group.appendChild(row)
      group.appendChild(preview)
    })

    list.appendChild(group)
  }

  container.appendChild(list)
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
  // Build into a fragment and attach once — appending each span+newline directly
  // to a live node triggers a layout pass per line.
  const frag = document.createDocumentFragment()
  lines.forEach((line) => {
    const span = document.createElement("span")
    span.className = `cf-hunk-line cf-hunk-line--${line.type}`
    const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " "
    span.textContent = prefix + line.content
    frag.appendChild(span)
    frag.appendChild(document.createTextNode("\n"))
  })
  if (data.length > 60) {
    const more = document.createElement("span")
    more.className = "cf-hunk-more"
    more.textContent = `… ${data.length - 60} more lines`
    frag.appendChild(more)
  }
  pre.appendChild(frag)
  el.appendChild(pre)
}
