/**
 * Per-hunk revert view (audit §14.3 wiring).
 *
 * Renders host-issued hunks (from the `file_hunks` host message) each with a
 * "Revert" button. Clicking posts `revert_hunk{path, hunkId}`; the host reverts
 * that hunk as a single undoable WorkspaceEdit and re-emits the remaining hunks.
 * Host-authoritative ids guarantee the clicked id maps to the right hunk.
 */
export interface FileHunkView {
  id: string
  additions: number
  deletions: number
  /** Unified-diff lines, prefixed " "/"-"/"+". */
  lines: string[]
}

export interface HunkRevertViewOptions {
  path: string
  hunks: readonly FileHunkView[]
  onRevert: (path: string, hunkId: string) => void
  /** Cap rendered lines per hunk (perf). Default 60. */
  maxLinesPerHunk?: number
}

function lineKind(raw: string): "added" | "removed" | "context" {
  if (raw.startsWith("+")) return "added"
  if (raw.startsWith("-")) return "removed"
  return "context"
}

export function renderHunksWithRevert(el: HTMLElement, opts: HunkRevertViewOptions): void {
  el.innerHTML = ""
  if (opts.hunks.length === 0) {
    el.innerHTML = '<div class="cf-hunk-empty">No revertable hunks</div>'
    return
  }
  const cap = opts.maxLinesPerHunk ?? 60
  const frag = document.createDocumentFragment()

  opts.hunks.forEach((h, i) => {
    const block = document.createElement("div")
    block.className = "cf-hunk-block"
    block.setAttribute("data-hunk-id", h.id)

    const header = document.createElement("div")
    header.className = "cf-hunk-block-header"
    const stat = document.createElement("span")
    stat.className = "cf-hunk-block-stat"
    stat.textContent = `Hunk ${i + 1} · +${h.additions} −${h.deletions}`
    const revert = document.createElement("button")
    revert.className = "cf-hunk-revert"
    revert.type = "button"
    revert.textContent = "Revert"
    revert.title = "Revert just this hunk (undoable)"
    revert.addEventListener("click", (e) => {
      e.stopPropagation()
      opts.onRevert(opts.path, h.id)
    })
    header.appendChild(stat)
    header.appendChild(revert)
    block.appendChild(header)

    const pre = document.createElement("pre")
    pre.className = "cf-hunk-code"
    const lineFrag = document.createDocumentFragment()
    h.lines.slice(0, cap).forEach((raw) => {
      const span = document.createElement("span")
      span.className = `cf-hunk-line cf-hunk-line--${lineKind(raw)}`
      span.textContent = raw
      lineFrag.appendChild(span)
      lineFrag.appendChild(document.createTextNode("\n"))
    })
    if (h.lines.length > cap) {
      const more = document.createElement("span")
      more.className = "cf-hunk-more"
      more.textContent = `… ${h.lines.length - cap} more lines`
      lineFrag.appendChild(more)
    }
    pre.appendChild(lineFrag)
    block.appendChild(pre)
    frag.appendChild(block)
  })

  el.appendChild(frag)
}
