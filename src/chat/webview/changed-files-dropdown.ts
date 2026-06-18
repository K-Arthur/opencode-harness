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
import { renderHunksWithRevert, type FileHunkView } from "./hunkRevertView"
import { renderFileChipListHtml } from "./file-chip-list"

// ─── Per-session state ────────────────────────────────────────────────────────

const DIFF_CACHE_MAX = 50

interface ChangedFilesState {
  sortMode: "changes" | "alpha"
  expandedFiles: Set<string>
  collapsedDirs: Set<string>
  diffCache: Map<string, DiffLine[] | null | string>
  hunksCache: Map<string, FileHunkView[]>
  lastFiles: FileChange[]
  /** Sprint 3 / M3: hunks the user has expanded past the 60-line preview cap */
  expandedHunks: Set<string>
}

function _createState(): ChangedFilesState {
  return {
    sortMode: "changes",
    expandedFiles: new Set<string>(),
    collapsedDirs: new Set<string>(),
    diffCache: new Map<string, DiffLine[] | null | string>(),
    hunksCache: new Map<string, FileHunkView[]>(),
    lastFiles: [],
    expandedHunks: new Set<string>(),
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
/** Element that had focus before the dropdown opened — restored on close. */
let _previouslyFocused: HTMLElement | null = null
/** Roving-tabindex bookkeeping: the tree item currently carrying tabindex=0. */
let _rovingTabId: string | null = null
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
  _previouslyFocused = null
  _rovingTabId = null
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
  /** Toolbar button that opens/closes the panel — null to anchor to #changed-files-strip */
  btn: HTMLButtonElement | null
  /** Panel element to populate (now inline panel, not floating) */
  panel: HTMLElement
  /** Container inside the panel to render the file tree into */
  treeContainer: HTMLElement
  /** Optional legacy badge element on the button showing file count */
  badge: HTMLElement | null
  /** Callback to post a message to the extension host */
  postMessage: (msg: Record<string, unknown>) => void
  /** Open a file in the editor */
  onOpenFile: (path: string) => void
  /** Sprint 3 / M7: open a VS Code diff editor for a changed file */
  onOpenChangedFileDiff: (path: string, sessionId: string) => void
  /** Optional guard: when true, strip and panel are suppressed (e.g. welcome view) */
  isWelcomeVisible?: () => boolean
  /** Called before the panel toggles — used by the surface coordinator to close other surfaces. */
  beforeToggle?: () => void
}

let _onOpenFile: (path: string) => void = () => {}
let _onOpenChangedFileDiff: (path: string, sessionId: string) => void = () => {}
let _isWelcomeVisible: () => boolean = () => false
let _beforeToggle: (() => void) | undefined

export function setupChangedFilesDropdown(opts: ChangedFilesDropdownOptions): void {
  _btn = opts.btn
  _panel = opts.panel
  _treeContainer = opts.treeContainer
  _badge = opts.badge
  _postMessage = opts.postMessage
  _onOpenFile = opts.onOpenFile
  _onOpenChangedFileDiff = opts.onOpenChangedFileDiff
  _isWelcomeVisible = opts.isWelcomeVisible ?? (() => false)
  _beforeToggle = opts.beforeToggle

  // Initially hidden
  _panel.classList.add("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "false")

  // Update tree container to use the new panel structure
  const panelTree = document.getElementById("cf-panel-tree")
  if (panelTree) {
    _treeContainer = panelTree
  }
  _updateBadge(0)

  if (_btn) {
    _btn.addEventListener("click", (e) => {
      e.stopPropagation()
      _toggle()
    })
  }

  // Close button inside the panel
  const closeBtn = document.getElementById("cf-panel-close")
  if (closeBtn) {
    closeBtn.addEventListener("click", () => _close())
  }

  // Bind the strip's click handler ONCE. The strip container element is
  // stable across re-renders (only its innerHTML changes), so rebinding it on
  // every render — as the old code did — was pure churn.
  //
  // With interactive file chips, click targets are:
  //   .file-chip__remove → remove chip from strip (don't toggle dropdown)
  //   .file-chip         → open file in editor (don't toggle dropdown)
  //   elsewhere on strip → toggle dropdown
  const strip = document.getElementById("changed-files-strip")
  if (strip) {
    strip.addEventListener("click", (e) => {
      const target = e.target as HTMLElement

      // Remove button: remove the chip from the strip
      const removeBtn = target.closest(".file-chip__remove")
      if (removeBtn) {
        e.stopPropagation()
        const chip = removeBtn.closest(".file-chip")
        if (chip) {
          chip.remove()
          _updateStripSig()
        }
        return
      }

      // Chip click (not on remove): open file in editor
      const chip = target.closest(".file-chip") as HTMLElement | null
      if (chip) {
        e.stopPropagation()
        const path = chip.dataset.path
        if (path && _onOpenFile) {
          _onOpenFile(path)
        }
        return
      }

      // Click on empty strip area: toggle dropdown
      e.stopPropagation()
      _toggle()
    })

    // Keyboard navigation on chips: Delete/Backspace removes focused chip,
    // Enter/Space opens the file.
    strip.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement
      if (!target.classList.contains("file-chip")) return

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        e.stopPropagation()
        target.remove()
        _updateStripSig()
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        e.stopPropagation()
        const path = target.dataset.path
        if (path && _onOpenFile) {
          _onOpenFile(path)
        }
      }
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

/**
 * Re-apply the welcome-view guard to the already-rendered strip/dropdown.
 * The guard otherwise only runs at render time, so a strip rendered inside a
 * session would stay visible after the user navigates to the welcome screen.
 * Call whenever the welcome view is shown or hidden.
 */
export function refreshChangedFilesVisibility(): void {
  if (!_currentSessionId) return
  _refreshUI(_currentSessionId, _stateFor(_currentSessionId).lastFiles)
  // The dropdown panel must also close — it floats above the welcome screen.
  if (_isOpen && _isWelcomeVisible()) _close()
}

function _refreshUI(sessionId: string, files: FileChange[]): void {
  const welcome = _isWelcomeVisible()
  _updateBadge(welcome ? 0 : files.length)
  if (_btn && _btn.isConnected) {
    _btn.classList.toggle("hidden", files.length === 0 || welcome)
    _btn.classList.toggle("cf-btn--has-files", files.length > 0 && !welcome)
    _btn.setAttribute("aria-label", welcome ? "" : `Changed files (${files.length})`)
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
// The strip's job is to confirm scope (file count, +added/-removed) at a
// glance — the "N files changed +X -Y" prefix is the priority and always
// stays fully legible (.cf-strip-label/.cf-strip-stats are flex-shrink:0).
// Individual files are secondary here; the full list with diffs lives one
// click away in the dropdown modal (strip aria-label says "click to view").
// At typical panel widths, more than one chip squeezes below a legible
// width even with .file-chip's flex-shrink fallback, so we only tease one
// representative chip and fold the rest into "+N more".
const CF_STRIP_MAX = 1
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
  // Suppress the strip when the welcome view is visible — files are still
  // accumulated per session but must not leak into the welcome screen.
  if (_isWelcomeVisible()) {
    strip.classList.add("hidden")
    strip.innerHTML = ""
    strip.removeAttribute("data-cf-sig")
    return
  }
  if (files.length === 0) {
    strip.classList.add("hidden")
    strip.innerHTML = ""
    strip.removeAttribute("data-cf-sig")
    return
  }
  strip.classList.remove("hidden")
  const paths = files.map((f) => f.path ?? "").filter((p) => p.length > 0)
  const totalAdded = files.reduce((sum, f) => sum + (typeof f.added === "number" ? f.added : 0), 0)
  const totalRemoved = files.reduce((sum, f) => sum + (typeof f.removed === "number" ? f.removed : 0), 0)
  // Skip the innerHTML rebuild when the visible content is unchanged — the strip
  // shows basenames + count + aggregate stats, so these fully determine its markup.
  const sig = `${files.length}|${totalAdded}|${totalRemoved}|${paths.join("|")}`
  if (strip.getAttribute("data-cf-sig") === sig) return
  strip.setAttribute("data-cf-sig", sig)
  strip.innerHTML = renderFileChipListHtml(
    paths,
    {
      maxVisible: CF_STRIP_MAX,
      showLeadingIcon: true,
      showCountLabel: true,
      countLabelSuffix: "changed",
      stats: { added: totalAdded, removed: totalRemoved },
    },
  )
  // NOTE: the click-to-open handler is bound once in setupChangedFilesDropdown;
  // it survives innerHTML updates because it lives on the stable strip element.
  strip.setAttribute("aria-label", `${files.length} changed file${files.length !== 1 ? "s" : ""} — click to view`)
}

/**
 * Rebuild `data-cf-sig` from the current chip DOM after a user-initiated
 * chip removal. This keeps the signature in sync so the next
 * `_renderStrip` call can correctly decide whether to rebuild.
 */
function _updateStripSig(): void {
  const strip = document.getElementById("changed-files-strip")
  if (!strip) return
  const chips = strip.querySelectorAll<HTMLElement>(".file-chip[data-path]")
  const paths = Array.from(chips).map((c) => c.dataset.path ?? "").filter(Boolean)
  if (paths.length === 0) {
    strip.classList.add("hidden")
    strip.innerHTML = ""
    strip.removeAttribute("data-cf-sig")
    return
  }
  const sig = `chip|${paths.join("|")}`
  strip.setAttribute("data-cf-sig", sig)
  // Update count label if present
  const label = strip.querySelector<HTMLElement>(".cf-strip-label")
  if (label) {
    const suffix = label.textContent?.match(/\d+ files?(\s+\w+)?/)?.[1] ?? ""
    label.textContent = `${paths.length} file${paths.length !== 1 ? "s" : ""}${suffix}`
  }
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
  // Lazy stats refresh: count added/removed from the resolved diff lines and
  // push corrected stats back to the host so the chip shows accurate numbers.
  if (_postMessage && Array.isArray(lines) && lines.length > 0) {
    const added = lines.filter((l) => l.type === "added").length
    const removed = lines.filter((l) => l.type === "removed").length
    if (added > 0 || removed > 0) {
      _postMessage({ type: "changed_files_update", sessionId, files: [{ path, added, removed }] })
    }
  }
  if (sessionId !== _currentSessionId) return
  document.querySelectorAll<HTMLElement>(".cf-hunk-preview--open[data-path]").forEach((el) => {
    if (el.dataset.path === path) _renderHunk(el, sessionId, path)
  })
}

/** Close the dropdown if open. Called by the surface coordinator. */
export function closeChangedFilesDropdown(): void {
  if (_isOpen) _close()
}

/** Host-authoritative hunks for per-hunk Revert (audit §14.3 wiring). */
export function handleFileHunks(sessionId: string, path: string, hunks: FileHunkView[]): void {
  const state = _stateFor(sessionId)
  if (hunks.length > 0) state.hunksCache.set(path, hunks)
  else state.hunksCache.delete(path)
  if (sessionId !== _currentSessionId) return
  document.querySelectorAll<HTMLElement>(".cf-hunk-preview--open[data-path]").forEach((el) => {
    if (el.dataset.path === path) _renderHunk(el, sessionId, path)
  })
}

// ─── Dropdown open / close ────────────────────────────────────────────────────

function _toggle(): void {
  _beforeToggle?.()
  if (_isOpen) _close()
  else _open()
}

function _open(): void {
  if (!_panel || !_treeContainer) return
  if (_isWelcomeVisible()) return // Never open panel on welcome screen
  _isOpen = true
  _panel.classList.remove("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "true")

  // Render the tree with current files
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
  _keyHandler = (e: KeyboardEvent) => _handlePanelKeydown(e)
  requestAnimationFrame(() => {
    document.addEventListener("click", _outsideClickHandler!)
    document.addEventListener("keydown", _keyHandler!)
  })
}

/**
 * Query all focusable elements inside the panel in DOM order, excluding those
 * that are hidden (display:none / visibility:hidden / disabled / aria-hidden).
 */
function _focusableInPanel(): HTMLElement[] {
  if (!_panel) return []
  const sel = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",")
  const candidates = Array.from(_panel.querySelectorAll<HTMLElement>(sel))
  return candidates.filter((el) => {
    if (el.hasAttribute("aria-hidden")) return false
    if (el.getAttribute("disabled") !== null) return false
    // Skip elements inside a collapsed directory group (display:none ancestor)
    const hidden = el.closest("[data-collapsed-children='true']")
    if (hidden && hidden !== el) return false
    return el.offsetParent !== null || el === document.activeElement
  })
}

/** Move focus into the dialog on open. Prefers the close button, then toolbar. */
function _focusInitial(): void {
  if (!_panel) return
  // Prefer the close button so Escape is immediately obvious, then fall back
  // to the first toolbar control, then the first tree item.
  const closeBtn = _panel.querySelector<HTMLElement>("#cf-panel-close")
  if (closeBtn) { closeBtn.focus(); return }
  const focusable = _focusableInPanel()
  if (focusable.length > 0) { focusable[0]!.focus(); return }
  // Last resort: focus the panel itself
  _panel.setAttribute("tabindex", "-1")
  _panel.focus()
}

/**
 * Panel-level keydown handler: Escape closes the panel.
 * Arrow-key delegation to the tree is handled by per-row listeners.
 */
function _handlePanelKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    _close()
    return
  }
}


function _close(): void {
  if (!_panel) return
  _isOpen = false
  _panel.classList.add("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "false")
  if (_outsideClickHandler) document.removeEventListener("click", _outsideClickHandler)
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler)
  _outsideClickHandler = null
  _keyHandler = null
  _rovingTabId = null
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

/**
 * Shorten a directory path for display in headers and file subtitles.
 *
 * Strategy (matches VS Code Source Control breadcrumbs):
 *   1. Normalize separators to "/".
 *   2. Remove absolute path prefix if present (e.g., /home/user/project → src/components)
 *   3. If the path has more than `maxSegments` segments, collapse the MIDDLE
 *      with an ellipsis — keeping the first segment (anchor) and the last two
 *      (most specific location). e.g. "src/chat/handlers/deep/nested" →
 *      "src/…/deep/nested".
 *   4. Never uppercase — return natural case for readability (WCAG 1.4.8).
 *   5. Empty string → "/" (root group label).
 */
function shortenDirPath(dir: string, maxSegments = 3): string {
  if (!dir) return "/"
  let norm = dir.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "")
  
  // Remove absolute path prefix - detect common project roots
  // This is a heuristic; ideally workspace root would be passed from host
  const absPrefixes = [
    /^\/home\/[^/]+\/[^/]+\//,  // /home/user/project/
    /^\/Users\/[^/]+\/[^/]+\//, // /Users/user/project/
    /^\/[a-zA-Z]:\\/,          // Windows drive letters
  ]
  for (const prefix of absPrefixes) {
    if (prefix.test(norm)) {
      norm = norm.replace(prefix, "")
      break
    }
  }
  
  const segments = norm.split("/").filter(Boolean)
  if (segments.length <= maxSegments) return segments.join("/")
  const head = segments[0] ?? ""
  const tail = segments.slice(-2).join("/")
  return `${head}/…/${tail}`
}

/** Abbreviated per-file directory (subtitle under filename). Even shorter. */
function shortenFileDir(dir: string): string {
  if (!dir) return ""
  const norm = dir.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "")
  const segments = norm.split("/").filter(Boolean)
  if (segments.length === 0) return ""
  if (segments.length <= 2) return segments.join("/")
  // For deep paths show only the last segment prefixed with …/
  return `…/${segments[segments.length - 1] ?? ""}`
}

function _inferStatus(file: FileChange): "A" | "M" | "D" {
  // Trust explicit git status when available.
  if (file.status) return file.status
  // Without git status we cannot reliably distinguish Added/Deleted from
  // Modified based on line counts alone (a new file with only additions is
  // indistinguishable from a modified file that only gained lines). Default
  // to "M" — the honest representation. The UI tooltip still shows "Modified".
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
    container.innerHTML = `<div class="cf-empty" role="status">No changed files in this session.</div>`
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

  // Update the panel count for screen readers and visual display.
  const countEl = document.getElementById("cf-panel-count")
  if (countEl) {
    countEl.textContent = `${files.length} file${files.length !== 1 ? "s" : ""}`
  }

  // Also update the panel title to show total additions/deletions
  const titleEl = document.getElementById("cf-panel-title")
  if (titleEl) {
    const totalAdded = safe.reduce((s, f) => s + f.added, 0)
    const totalRemoved = safe.reduce((s, f) => s + f.removed, 0)
    titleEl.textContent = totalAdded > 0 || totalRemoved > 0 
      ? `Changed Files (+${totalAdded} -${totalRemoved})`
      : "Changed Files"
  }

  // File list, grouped by parent directory. role="tree" + per-item role=
  // "treeitem" gives screen-reader users proper hierarchical navigation.
  // Roving tabindex: exactly one item carries tabindex=0 (the "roving" one);
  // all others get -1. Arrow keys move the roving slot. This is the WAI-ARIA
  // treeview keyboard pattern (APG).
  const list = document.createElement("div")
  list.className = "cf-file-list"
  list.setAttribute("role", "tree")
  list.setAttribute("aria-label", "Changed files")
  list.setAttribute("aria-multiselectable", "false")
  // Tree-level keydown for arrow navigation (event delegation).
  list.addEventListener("keydown", (e) => _handleTreeKeydown(e, list))

  const groups = new Map<string, typeof sorted>()
  for (const file of sorted) {
    const slash = file.path.lastIndexOf("/")
    const dir = slash > 0 ? file.path.slice(0, slash) : ""
    let bucket = groups.get(dir)
    if (!bucket) { bucket = []; groups.set(dir, bucket) }
    bucket.push(file)
  }

  /** Track whether we've assigned the initial roving tabindex=0 slot. */
  let rovingAssigned = false

  for (const [dir, groupFiles] of groups) {
    const group = document.createElement("div")
    group.className = "cf-dir-group"

    const isCollapsed = state.collapsedDirs.has(dir)
    const shortDirLabel = shortenDirPath(dir)
    const header = document.createElement("button")
    header.className = "cf-dir-header"
    header.type = "button"
    header.setAttribute("role", "treeitem")
    header.setAttribute("aria-level", "1")
    header.setAttribute("aria-expanded", String(!isCollapsed))
    header.setAttribute("aria-label", `${shortDirLabel} directory${isCollapsed ? ", collapsed" : ", expanded"}`)
    header.setAttribute("data-cf-tree-id", `dir:${dir}`)
    // Roving tabindex: first item gets 0, rest get -1.
    header.tabIndex = (!rovingAssigned && !isCollapsed) ? 0 : -1
    if (!rovingAssigned && !isCollapsed) { _rovingTabId = `dir:${dir}`; rovingAssigned = true }

    const chevron = document.createElement("span")
    chevron.className = "cf-dir-chevron"
    chevron.setAttribute("aria-hidden", "true")
    chevron.textContent = isCollapsed ? "▶" : "▼"
    header.appendChild(chevron)

    const dirTitle = document.createElement("span")
    dirTitle.className = "cf-dir-path"
    dirTitle.textContent = shortDirLabel
    header.appendChild(dirTitle)

    group.appendChild(header)

    const filesContainer = document.createElement("div")
    filesContainer.className = "cf-dir-files"
    filesContainer.setAttribute("role", "group")
    filesContainer.setAttribute("aria-label", shortDirLabel)
    if (isCollapsed) {
      filesContainer.style.display = "none"
      // Marker for the focus-trap filter so it skips children of collapsed dirs.
      filesContainer.setAttribute("data-collapsed-children", "true")
    }
    group.appendChild(filesContainer)

    header.addEventListener("click", () => {
      const currentlyCollapsed = state.collapsedDirs.has(dir)
      if (currentlyCollapsed) {
        state.collapsedDirs.delete(dir)
      } else {
        state.collapsedDirs.add(dir)
      }
      const nowExpanded = currentlyCollapsed
      header.setAttribute("aria-expanded", String(nowExpanded))
      header.setAttribute("aria-label", `${shortDirLabel} directory${nowExpanded ? ", expanded" : ", collapsed"}`)
      chevron.textContent = nowExpanded ? "▼" : "▶"
      filesContainer.style.display = nowExpanded ? "" : "none"
      filesContainer.toggleAttribute("data-collapsed-children", !nowExpanded)
    })

    groupFiles.forEach((file) => {
      const parts = file.path.split("/")
      const fileName = parts[parts.length - 1] ?? file.path
      const dirParts = parts.slice(0, -1)
      const fileDir = dirParts.join("/")
      const shortDir = shortenFileDir(fileDir)
      const status = _inferStatus(file)
      const statusWord = status === "A" ? "Added" : status === "D" ? "Deleted" : "Modified"
      const isExpanded = state.expandedFiles.has(file.path)
      const totalLines = file.added + file.removed

      const row = document.createElement("div")
      row.className = `cf-file-row${isExpanded ? " cf-file-row--expanded" : ""}`
      row.setAttribute("data-path", file.path)
      row.setAttribute("role", "treeitem")
      row.setAttribute("aria-level", "2")
      row.setAttribute("aria-selected", "false")
      row.setAttribute("data-cf-tree-id", `file:${file.path}`)
      // Descriptive label: "filename, Status, +N additions −N deletions"
      row.setAttribute("aria-label",
        `${fileName}, ${statusWord}, ${file.added} addition${file.added !== 1 ? "s" : ""}, ${file.removed} deletion${file.removed !== 1 ? "s" : ""}`)
      // Roving tabindex.
      row.tabIndex = !rovingAssigned ? 0 : -1
      if (!rovingAssigned) { _rovingTabId = `file:${file.path}`; rovingAssigned = true }

      const badge = document.createElement("span")
      badge.className = `cf-status-badge cf-status-badge--${status}`
      badge.textContent = status
      badge.setAttribute("aria-hidden", "true") // redundant: row label already says "Modified"
      badge.title = statusWord

      const nameCol = document.createElement("span")
      nameCol.className = "cf-file-name-col"

      const name = document.createElement("span")
      name.className = "cf-file-name"
      name.textContent = fileName
      name.title = file.path

      if (shortDir) {
        const dirSpan = document.createElement("span")
        dirSpan.className = "cf-file-dir"
        dirSpan.textContent = shortDir
        nameCol.appendChild(name)
        nameCol.appendChild(dirSpan)
      } else {
        nameCol.appendChild(name)
      }

      let planTag: HTMLElement | undefined
      if (file.isPlanDocument) {
        planTag = document.createElement("span")
        planTag.className = "cf-plan-tag"
        planTag.textContent = "plan"
        planTag.title = "Plan document written by the agent"
      }

      const stats = document.createElement("span")
      stats.className = "cf-file-stats"
      stats.setAttribute("aria-hidden", "true") // row label already includes counts
      const addedEl = document.createElement("span")
      addedEl.className = "cf-stat-added"
      addedEl.textContent = `+${file.added}`
      const removedEl = document.createElement("span")
      removedEl.className = "cf-stat-removed"
      removedEl.textContent = `−${file.removed}`
      stats.appendChild(addedEl)
      stats.appendChild(removedEl)

      const changeBar = document.createElement("span")
      changeBar.className = "cf-change-bar"
      changeBar.setAttribute("aria-hidden", "true")
      changeBar.title = `${file.added} added, ${file.removed} removed`
      if (totalLines > 0) {
        const addPct = Math.round((file.added / totalLines) * 100)
        changeBar.innerHTML = `<span class="cf-change-bar-add" style="width:${addPct}%"></span><span class="cf-change-bar-remove" style="width:${100 - addPct}%"></span>`
      }

      const openBtn = document.createElement("button")
      openBtn.className = "cf-open-btn"
      openBtn.type = "button"
      openBtn.setAttribute("aria-label", `Open ${fileName}`)
      openBtn.title = "Open file"
      openBtn.tabIndex = -1
      openBtn.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M5 7v12h12"/></svg>`
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        _onOpenFile(file.path)
      })

      // M7: Open a real VS Code diff editor comparing git HEAD (before)
      // against current workspace content (after). Distinct from the inline
      // expandable hunk preview — this opens a tab in the editor area.
      const diffBtn = document.createElement("button")
      diffBtn.className = "cf-open-diff-btn"
      diffBtn.type = "button"
      diffBtn.setAttribute("aria-label", `Open diff for ${fileName}`)
      diffBtn.title = "Open diff in editor"
      diffBtn.tabIndex = -1
      diffBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v18M3 12h18M8 8l-5 4 5 4M16 8l5 4-5 4"/></svg>`
      diffBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        _onOpenChangedFileDiff(file.path, _currentSessionId || "")
      })

      const expandBtn = document.createElement("button")
      expandBtn.className = "cf-expand-btn"
      expandBtn.type = "button"
      expandBtn.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} diff for ${fileName}`)
      expandBtn.setAttribute("aria-expanded", String(isExpanded))
      expandBtn.tabIndex = -1
      expandBtn.innerHTML = _expandIcon(isExpanded)

      // W1.E: Undo button — revert this file to git HEAD
      const undoBtn = document.createElement("button")
      undoBtn.className = "cf-undo-btn"
      undoBtn.type = "button"
      undoBtn.setAttribute("aria-label", `Revert changes to ${fileName}`)
      undoBtn.title = "Undo changes"
      undoBtn.tabIndex = -1
      undoBtn.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`
      undoBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        _postMessage?.({ type: "undo_file", path: file.path, sessionId })
      })

      const preview = document.createElement("div")
      preview.className = `cf-hunk-preview${isExpanded ? " cf-hunk-preview--open" : ""}`
      preview.setAttribute("data-path", file.path)
      if (isExpanded) {
        preview.setAttribute("role", "region")
        preview.setAttribute("aria-label", `Diff preview for ${fileName}`)
        _renderHunk(preview, sessionId, file.path)
      }

      row.addEventListener("click", (e) => {
        const target = e.target as HTMLElement
        if (target.closest(".cf-expand-btn") || target.closest(".cf-open-btn")) return
        _onOpenFile(file.path)
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
          // Request host-authoritative hunks for per-hunk Revert (audit §14.3).
          if (!state.hunksCache.has(file.path)) {
            _postMessage?.({ type: "get_file_hunks", path: file.path, sessionId })
          }
        } else {
          state.expandedFiles.delete(file.path)
        }
        // Mutate only this row — never rebuild the whole tree on expand/collapse.
        _renderRowExpansion(row, preview, expandBtn, willExpand, sessionId, file.path)
        if (willExpand) {
          preview.setAttribute("role", "region")
          preview.setAttribute("aria-label", `Diff preview for ${fileName}`)
        } else {
          preview.removeAttribute("role")
          preview.removeAttribute("aria-label")
        }
      })

      row.appendChild(expandBtn)
      row.appendChild(badge)
      row.appendChild(nameCol)
      if (planTag) row.appendChild(planTag)
      row.appendChild(changeBar)
      row.appendChild(stats)
      row.appendChild(openBtn)
      row.appendChild(diffBtn)
      row.appendChild(undoBtn)
      filesContainer.appendChild(row)
      filesContainer.appendChild(preview)
    })

    list.appendChild(group)
  }

  container.appendChild(list)

  // If every directory happened to be collapsed, fall back to the first
  // header so the roving slot is never orphaned.
  if (!rovingAssigned) {
    const firstHeader = list.querySelector<HTMLElement>(".cf-dir-header")
    if (firstHeader) {
      firstHeader.tabIndex = 0
      _rovingTabId = firstHeader.getAttribute("data-cf-tree-id")
    }
  }
}

/**
 * Collect all VISIBLE tree items (role=treeitem) within the tree, in DOM order.
 * "Visible" means not inside a collapsed directory (display:none ancestor).
 * Used by the roving-tabindex arrow-key navigation.
 */
function _visibleTreeItems(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  return all.filter((el) => {
    // An item is hidden if any ancestor .cf-dir-files has display:none.
    const collapsedParent = el.closest('.cf-dir-files')
    if (collapsedParent && (collapsedParent as HTMLElement).style.display === "none") {
      return false
    }
    return true
  })
}

/**
 * Move the roving tabindex slot to a target tree item and focus it.
 * Scrolls into view if off-screen (WCAG 2.4.3 — focus must be visible).
 */
function _moveRoving(tree: HTMLElement, target: HTMLElement | null | undefined): void {
  if (!target) return
  const items = _visibleTreeItems(tree)
  items.forEach((it) => { it.tabIndex = it === target ? 0 : -1 })
  _rovingTabId = target.getAttribute("data-cf-tree-id")
  target.focus()
  // scrollIntoView with block:"nearest" avoids jumping when the item is
  // already partially visible — matches VS Code's tree scroll behavior.
  target.scrollIntoView({ block: "nearest", inline: "nearest" })
}

/**
 * Tree-level keyboard navigation (WAI-ARIA APG treeview pattern).
 * Attached via event delegation on the role="tree" container. Fires only when
 * a role="treeitem" element (or a button inside one) has focus.
 *
 *   ArrowDown   → next visible tree item
 *   ArrowUp     → previous visible tree item
 *   ArrowRight  → expand collapsed dir, or move into first child
 *   ArrowLeft   → collapse expanded dir, or move to parent dir header
 *   Home        → first visible tree item
 *   End         → last visible tree item
 *   Enter       → directory: toggle; file row: open file
 *   Space       → file row: toggle diff preview
 *
 * Note: Tab/Shift+Tab are handled by the dialog-level _trapTab, not here.
 */
function _handleTreeKeydown(e: KeyboardEvent, tree: HTMLElement): void {
  const target = e.target as HTMLElement
  // Only act when a treeitem (or element within one) is focused.
  const item = target.closest('[role="treeitem"]') as HTMLElement | null
  if (!item) return

  const items = _visibleTreeItems(tree)
  const idx = items.indexOf(item)
  if (idx === -1) return // focused item not in visible set

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault()
      const next = items[idx + 1]
      _moveRoving(tree, next)
      break
    }
    case "ArrowUp": {
      e.preventDefault()
      const prev = items[idx - 1]
      _moveRoving(tree, prev)
      break
    }
    case "ArrowRight": {
      // On a collapsed directory header → expand. On an expanded directory or
      // a file → move to first child / next item.
      const isDir = item.classList.contains("cf-dir-header")
      if (isDir) {
        const expanded = item.getAttribute("aria-expanded") === "true"
        if (!expanded) {
          e.preventDefault()
          item.click() // toggles via the existing click handler
          return
        }
      }
      // Move to next visible item (descendant or sibling)
      e.preventDefault()
      const next = items[idx + 1]
      _moveRoving(tree, next)
      break
    }
    case "ArrowLeft": {
      const isDir = item.classList.contains("cf-dir-header")
      if (isDir) {
        const expanded = item.getAttribute("aria-expanded") === "true"
        if (expanded) {
          e.preventDefault()
          item.click() // collapse
          return
        }
      }
      // Move to parent directory header (the closest preceding treeitem at level 1)
      e.preventDefault()
      for (let i = idx - 1; i >= 0; i--) {
        const prev = items[i]!
        if (prev.classList.contains("cf-dir-header")) {
          _moveRoving(tree, prev)
          return
        }
      }
      break
    }
    case "Home": {
      e.preventDefault()
      _moveRoving(tree, items[0])
      break
    }
    case "End": {
      e.preventDefault()
      _moveRoving(tree, items[items.length - 1])
      break
    }
    case "Enter": {
      // Directory header: toggle. File row: open file.
      if (item.classList.contains("cf-dir-header")) {
        e.preventDefault()
        item.click()
      } else if (item.classList.contains("cf-file-row")) {
        e.preventDefault()
        const path = item.getAttribute("data-path")
        if (path) _onOpenFile(path)
      }
      break
    }
    case " ": {
      // Space on a file row toggles the inline diff preview.
      if (item.classList.contains("cf-file-row")) {
        e.preventDefault()
        const expandBtn = item.querySelector<HTMLElement>(".cf-expand-btn")
        expandBtn?.click()
      }
      break
    }
  }
}

function _renderHunk(el: HTMLElement, sessionId: string, path: string): void {
  const state = _stateFor(sessionId)
  // Prefer host-authoritative hunks with per-hunk Revert when available.
  const hunks = state.hunksCache.get(path)
  if (hunks && hunks.length > 0) {
    renderHunksWithRevert(el, {
      path,
      hunks,
      onRevert: (p, hunkId) => _postMessage?.({ type: "revert_hunk", path: p, hunkId, sessionId }),
    })
    return
  }
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

  // M3: the preview is capped at 60 lines by default. A "Show all N lines"
  // button expands to a higher cap (500 lines). Beyond that, an "Open full
  // diff" CTA routes to the VS Code diff editor (M7).
  const isExpanded = state.expandedHunks.has(path)
  const cap = isExpanded ? 500 : 60
  const lines = data.slice(0, cap)
  el.innerHTML = ""
  const pre = document.createElement("pre")
  pre.className = "cf-hunk-code"
  const frag = document.createDocumentFragment()
  lines.forEach((line) => {
    const span = document.createElement("span")
    span.className = `cf-hunk-line cf-hunk-line--${line.type}`
    const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " "
    span.textContent = prefix + line.content
    frag.appendChild(span)
    frag.appendChild(document.createTextNode("\n"))
  })
  if (data.length > cap) {
    const remaining = data.length - cap
    const more = document.createElement("button")
    more.className = "cf-hunk-more-btn"
    more.setAttribute("aria-label", isExpanded ? "Show all changes" : `Show ${remaining} more lines`)
    more.textContent = isExpanded
      ? `Still truncated — open full diff for all ${data.length} lines`
      : `Show ${remaining} more lines`
    more.addEventListener("click", (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (isExpanded) {
        // Beyond the expanded cap: route to the VS Code diff editor.
        _onOpenChangedFileDiff(path, sessionId)
      } else {
        state.expandedHunks.add(path)
        _renderHunk(el, sessionId, path)
      }
    })
    frag.appendChild(more)
  }
  pre.appendChild(frag)
  el.appendChild(pre)
}
