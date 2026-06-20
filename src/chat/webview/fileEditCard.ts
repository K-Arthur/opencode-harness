import type { ToolCallBlock } from "./types"
import { escapeHtml } from "./htmlUtils"
import { truncateMiddle } from "./stringUtils"
import { isTerminalState } from "./toolState"

export interface FileEditCardOptions {
  postMessage?: (msg: Record<string, unknown>) => void
  mode?: string
}

const MAX_PREVIEW_LINES = 50

/**
 * Renders a compact inline preview card for write-class file edits.
 *
 * Returns null for non-write tools or write tools without a file path so the
 * caller can fall back to the default tool-call details panel.
 */
export function renderFileEditCard(
  toolBlock: ToolCallBlock,
  opts: FileEditCardOptions = {},
): HTMLElement | null {
  if (toolBlock.class !== "write") return null

  const args = toolBlock.args
  const obj =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null
  if (!obj) return null

  const filePath =
    typeof obj.path === "string"
      ? obj.path
      : typeof obj.file === "string"
        ? obj.file
        : typeof obj.filename === "string"
          ? obj.filename
          : null
  if (!filePath || !filePath.trim()) return null

  const postMessage =
    opts.postMessage ??
    (typeof window !== "undefined"
      ? (window as any).vscode?.postMessage?.bind((window as any).vscode)
      : undefined)

  const wrapper = document.createElement("div")
  const state = toolBlock.state || "running"
  const stateClasses = ["file-edit-card", `file-edit-card--${state}`]
  if (toolBlock.error || state === "error" || state === "timed_out") {
    stateClasses.push("file-edit-card--error")
  }
  wrapper.className = stateClasses.join(" ")
  wrapper.dataset.toolId = toolBlock.id

  const header = document.createElement("div")
  header.className = "file-edit-card__header"

  const icon = document.createElement("span")
  icon.className = "file-edit-card__icon"
  icon.setAttribute("aria-hidden", "true")
  icon.textContent = "📝"
  header.appendChild(icon)

  const path = document.createElement("span")
  path.className = "file-edit-card__path"
  path.textContent = truncateMiddle(filePath, 42)
  path.title = filePath
  header.appendChild(path)

  const status = document.createElement("span")
  status.className = "file-edit-card__status"
  status.textContent = statusLabel(state)
  header.appendChild(status)

  wrapper.appendChild(header)

  const preview = buildPreview(obj)
  if (preview) {
    const previewEl = document.createElement("div")
    previewEl.className = "file-edit-card__preview"
    previewEl.appendChild(preview)
    wrapper.appendChild(previewEl)
  }

  const actions = document.createElement("div")
  actions.className = "file-edit-card__actions"

  const openBtn = document.createElement("button")
  openBtn.className = "file-edit-card__open-btn file-edit-card__action"
  openBtn.textContent = "Open file"
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    e.preventDefault()
    postMessage?.({ type: "open_file", path: filePath })
  })
  actions.appendChild(openBtn)

  const diffBtn = document.createElement("button")
  diffBtn.className = "file-edit-card__diff-btn file-edit-card__action"
  diffBtn.textContent = "Show diff"
  diffBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    e.preventDefault()
    postMessage?.({ type: "get_file_diff", path: filePath, toolId: toolBlock.id })
  })
  actions.appendChild(diffBtn)

  wrapper.appendChild(actions)

  return wrapper
}

function statusLabel(state: string): string {
  if (state === "pending") return "Pending"
  if (state === "running") return "Running"
  if (state === "stale") return "Stale"
  if (state === "error" || state === "timed_out") return "Error"
  if (state === "cancelled") return "Cancelled"
  if (state === "retried") return "Retried"
  if (isTerminalState(state)) return "Done"
  return state
}

function firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") return v
  }
  return null
}

function buildPreview(obj: Record<string, unknown>): DocumentFragment | null {
  const oldStr = firstStringField(obj, ["oldString", "old_string", "old", "search"])
  const newStr = firstStringField(obj, ["newString", "new_string", "new", "replace"])
  if (oldStr !== null || newStr !== null) {
    return buildDiffPreview(oldStr ?? "", newStr ?? "")
  }

  const content = firstStringField(obj, ["content", "contents", "text", "fileText"])
  if (content !== null) {
    return buildContentPreview(content)
  }

  return null
}

function buildDiffPreview(oldStr: string, newStr: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const maxLines = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine === newLine && i < MAX_PREVIEW_LINES) {
      fragment.appendChild(createPreviewLine(oldLine ?? "", "context"))
    } else if (oldLine !== undefined) {
      fragment.appendChild(createPreviewLine(oldLine, "removed"))
    }
    if (newLine !== undefined && oldLine !== newLine) {
      fragment.appendChild(createPreviewLine(newLine, "added"))
    }
  }
  return fragment
}

function buildContentPreview(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const lines = content.split("\n")
  const visible = lines.slice(0, MAX_PREVIEW_LINES)
  for (const line of visible) {
    fragment.appendChild(createPreviewLine(line, "context"))
  }
  if (lines.length > MAX_PREVIEW_LINES) {
    const more = document.createElement("div")
    more.className = "file-edit-card__preview-more"
    more.textContent = `+ ${lines.length - MAX_PREVIEW_LINES} more lines`
    fragment.appendChild(more)
  }
  return fragment
}

function createPreviewLine(text: string, kind: "context" | "added" | "removed"): HTMLDivElement {
  const line = document.createElement("div")
  line.className = `file-edit-card__preview-line file-edit-card__preview-line--${kind}`
  const marker = document.createElement("span")
  marker.className = "file-edit-card__preview-marker"
  marker.setAttribute("aria-hidden", "true")
  marker.textContent = kind === "removed" ? "-" : kind === "added" ? "+" : " "
  const content = document.createElement("span")
  content.className = "file-edit-card__preview-content"
  content.textContent = escapeHtml(text) || " "
  line.appendChild(marker)
  line.appendChild(content)
  return line
}
