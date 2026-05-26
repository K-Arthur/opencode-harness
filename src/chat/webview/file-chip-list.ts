/**
 * Single source of truth for "render a horizontal list of file chips".
 *
 * Used by:
 *  - the persistent bottom `#changed-files-strip` (aggregate, all session edits)
 *  - the inline `task-banner` (ephemeral, what just got edited)
 *
 * One helper keeps the two surfaces visually consistent and prevents drift
 * — adding a chip variant (e.g. status icon, hover behavior) only needs to
 * happen once.
 */

export interface FileChipListOptions {
  /** Max chips to show before collapsing the rest into a `+N more` pill. */
  maxVisible?: number
  /** Show a leading file/document icon. */
  showLeadingIcon?: boolean
  /** Show a leading count label (e.g. "13 files"). */
  showCountLabel?: boolean
  /** Render compact (smaller font, less padding). */
  compact?: boolean
}

const DEFAULT_MAX = 5

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Render an HTML string for a horizontal file-chip list.
 * Caller is responsible for installing it (via .innerHTML) and wiring click
 * handlers via event delegation on `.cf-strip-chip[data-path]` elements.
 */
export function renderFileChipListHtml(files: string[], opts: FileChipListOptions = {}): string {
  const maxVisible = opts.maxVisible ?? DEFAULT_MAX
  const visible = files.slice(0, maxVisible)
  const overflow = files.length - visible.length

  const parts: string[] = []

  if (opts.showLeadingIcon !== false) {
    parts.push(
      `<span class="cf-strip-icon" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
          `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>` +
          `<polyline points="14 2 14 8 20 8"/>` +
          `<line x1="9" y1="15" x2="15" y2="15"/>` +
          `<line x1="12" y1="12" x2="12" y2="18"/>` +
        `</svg>` +
      `</span>`
    )
  }

  if (opts.showCountLabel !== false) {
    parts.push(
      `<span class="cf-strip-label">${files.length} file${files.length !== 1 ? "s" : ""}</span>`
    )
    parts.push(`<span class="cf-strip-divider" aria-hidden="true">·</span>`)
  }

  for (const fpath of visible) {
    const name = fpath.split("/").pop() || fpath
    parts.push(
      `<span class="cf-strip-chip" title="${escapeHtml(fpath)}" data-path="${escapeHtml(fpath)}">` +
        escapeHtml(name) +
      `</span>`
    )
  }

  if (overflow > 0) {
    parts.push(`<span class="cf-strip-overflow">+${overflow} more</span>`)
  }

  return parts.join("")
}

/**
 * Parse the file list out of a "Edited N files: …" or "Edited <path>" banner
 * text. Returns the de-duplicated file paths in order of first appearance.
 *
 * This is the inverse of how FileEditBatcher.flush() formats banner text
 * (see `src/chat/webview/ui/fileEditBatcher.ts`). Keeping it here lets the
 * merge helper below stay pure and unit-testable.
 */
export function parseEditBannerFiles(text: string): string[] {
  const multi = text.match(/^Edited \d+ files?:\s*(.*)$/)
  if (multi && multi[1]) {
    return multi[1].split(",").map((s) => s.trim()).filter(Boolean)
  }
  const single = text.match(/^Edited (.+)$/)
  if (single && single[1]) {
    return [single[1].trim()]
  }
  return []
}

/**
 * Combine the file lists from two banner texts (an existing banner plus a
 * newly-arrived one), preserving order, dropping duplicates, and producing
 * the canonical "Edited N files: …" string that renderTaskBanner expects.
 *
 * Used by the FileEditBatcher coalescing path: if a fresh batch flushes
 * while the previous banner is still visible, we merge in place instead
 * of stacking another card.
 */
export function mergeEditBannerFiles(existing: string, incoming: string): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const f of [...parseEditBannerFiles(existing), ...parseEditBannerFiles(incoming)]) {
    if (!seen.has(f)) {
      seen.add(f)
      merged.push(f)
    }
  }
  if (merged.length === 0) return existing
  if (merged.length === 1) return `Edited ${merged[0]}`
  // Use the basename in the comma-separated section, matching FileEditBatcher's
  // emit format, so renderTaskBanner's chip parsing matches what it expects.
  const basenames = merged.map((p) => p.split("/").pop() || p)
  return `Edited ${merged.length} files: ${basenames.join(", ")}`
}

/**
 * Lower-level: returns the file names visible at the front (after `maxVisible`)
 * and the overflow count. Useful for callers that need to know what's hidden
 * (e.g. an "expand" affordance).
 */
export function splitFileList(
  files: string[],
  maxVisible = DEFAULT_MAX,
): { visible: string[]; overflow: number } {
  return {
    visible: files.slice(0, maxVisible),
    overflow: Math.max(0, files.length - maxVisible),
  }
}
