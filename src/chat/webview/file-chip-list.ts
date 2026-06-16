/**
 * Single source of truth for rendering a compact inline file chip list.
 *
 * Used by:
 *  - the persistent bottom `#changed-files-strip` (aggregate, all session edits)
 *  - the inline `task-banner` (ephemeral, what just got edited)
 *
 * Each file is rendered as an interactive `.file-chip` button with an
 * extension badge, filename, and remove affordance. Click opens the file
 * in the editor; the remove button clears the chip from the strip without
 * reverting the file.
 */

export interface FileChipListOptions {
  /** Max file names to show before collapsing into `+N more`. */
  maxVisible?: number
  /** Show a leading file/document icon. */
  showLeadingIcon?: boolean
  /** Show a leading count label (e.g. "13 files"). */
  showCountLabel?: boolean
  /** Optional verb after the count, e.g. "changed" → "13 files changed". */
  countLabelSuffix?: string
  /** Aggregate diff totals — rendered as `+X −Y` after the count label. */
  stats?: { added: number; removed: number }
}

const DEFAULT_MAX = 5

/** Extension → short badge label map (2-3 chars, uppercase). */
const EXT_BADGE_MAP: Record<string, string> = {
  ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX",
  py: "PY", rs: "RS", go: "GO", rb: "RB",
  json: "JSON", yaml: "YML", yml: "YML", toml: "TOML",
  html: "HTML", css: "CSS", scss: "SCSS", less: "LESS",
  md: "MD", sh: "SH", bash: "SH", zsh: "SH",
  sql: "SQL", c: "C", h: "H", cpp: "C++", hpp: "C++", cc: "C++",
  java: "JAVA", cs: "CS", php: "PHP", swift: "SWIFT",
  kt: "KT", scala: "SCALA", lua: "LUA", r: "R",
  vue: "VUE", svelte: "SVELTE", graphql: "GQL", gql: "GQL",
  ini: "INI", cfg: "CFG", conf: "CONF",
  dockerfile: "DKR", makefile: "MK", cmake: "CMAKE",
}

/** Extension → inferLanguageFromPath-compatible language name. */
const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", rb: "ruby",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  html: "xml", css: "css", scss: "scss", less: "less",
  md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  java: "java", cs: "csharp", php: "php", swift: "swift",
  kt: "kotlin", scala: "scala", lua: "lua", r: "r",
  dockerfile: "dockerfile", makefile: "makefile", cmake: "cmake",
  vue: "xml", svelte: "html", graphql: "graphql", gql: "graphql",
  ini: "ini", cfg: "ini", conf: "ini",
}

/**
 * Return the short uppercase badge label for a file's extension.
 * e.g. "foo.ts" → "TS", "main.go" → "GO", "Makefile" → "MK"
 */
export function getExtBadgeLabel(filePath: string): string {
  const name = filePath.split("/").pop()?.split("\\").pop() || ""
  const lower = name.toLowerCase()
  const ext = lower.split(".").length > 1 ? lower.split(".").pop() || "" : ""
  if (ext && EXT_BADGE_MAP[ext]) return EXT_BADGE_MAP[ext]
  if (!ext && EXT_BADGE_MAP[lower]) return EXT_BADGE_MAP[lower]
  if (ext) return ext.toUpperCase()
  // Special case: files like Makefile, Dockerfile with no dot-extension
  return lower.slice(0, 2).toUpperCase()
}

/**
 * Return the language identifier for a file path (matching inferLanguageFromPath).
 * Used to set `data-lang` on the extension badge for CSS styling.
 */
function getExtLang(filePath: string): string {
  const name = filePath.split("/").pop()?.split("\\").pop() || ""
  const lower = name.toLowerCase()
  const ext = lower.split(".").length > 1 ? lower.split(".").pop() || "" : ""
  if (ext && EXT_LANG_MAP[ext]) return EXT_LANG_MAP[ext]
  if (!ext && EXT_LANG_MAP[lower]) return EXT_LANG_MAP[lower]
  return ""
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Render interactive file chip list HTML.
 * Each chip is a `<button class="file-chip">` with extension badge,
 * filename, and remove affordance. Click handlers use event delegation
 * on `.file-chip[data-path]` (open file) and `.file-chip__remove` (remove chip).
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
        `</svg>` +
      `</span>`
    )
  }

  if (opts.showCountLabel !== false) {
    const suffix = opts.countLabelSuffix ? ` ${opts.countLabelSuffix}` : ""
    parts.push(
      `<span class="cf-strip-label">${files.length} file${files.length !== 1 ? "s" : ""}${suffix}</span>`
    )
    if (opts.stats && (opts.stats.added > 0 || opts.stats.removed > 0)) {
      parts.push(
        `<span class="cf-strip-stats">` +
          `<span class="cf-strip-added">+${opts.stats.added}</span>` +
          `<span class="cf-strip-removed">−${opts.stats.removed}</span>` +
        `</span>`
      )
    }
    parts.push(`<span class="cf-strip-divider" aria-hidden="true">·</span>`)
  }

  for (const fpath of visible) {
    const name = fpath.split("/").pop() || fpath
    const badge = getExtBadgeLabel(fpath)
    const lang = getExtLang(fpath)
    const safePath = escapeHtml(fpath)
    const safeName = escapeHtml(name)
    const safeLabel = escapeHtml(`Remove ${name}`)
    parts.push(
      `<button class="file-chip" data-path="${safePath}" tabindex="0" title="${safePath}">` +
        `<span class="file-chip__ext" data-lang="${escapeHtml(lang)}">${escapeHtml(badge)}</span>` +
        `<span class="file-chip__name">${safeName}</span>` +
        `<span class="file-chip__remove" role="button" aria-label="${safeLabel}" tabindex="-1">&times;</span>` +
      `</button>`
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
