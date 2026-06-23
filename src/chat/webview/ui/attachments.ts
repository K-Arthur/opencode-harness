import { REMOVE_SVG } from "../icons"

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "image/heic",
  "image/heif",
] as const

const ALLOWED_DOCUMENT_MIMES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/xml",
  "application/pdf",
  "application/x-yaml",
  "application/x-sh",
] as const

const DOCUMENT_ICONS: Record<string, string> = {
  "text/plain": "\u{1F4C4}",
  "text/markdown": "\u{1F4DD}",
  "text/csv": "\u{1F4CA}",
  "application/pdf": "\u{1F4D5}",
  "application/json": "\u{1F4E6}",
}

export interface Attachment {
  data: string
  mimeType: string
}

export interface AttachmentEls {
  inputArea: HTMLElement
  inputWrapper: HTMLElement
  promptInput: HTMLTextAreaElement
}

export interface ActiveFileSelectionInfo {
  startLine: number
  endLine: number
  text: string
}

export interface ActiveFileInfo {
  path: string | null
  languageId?: string
  lineCount?: number
  selection?: ActiveFileSelectionInfo | null
}

export interface AttachmentDeps {
  els: AttachmentEls
  postMessage: (msg: Record<string, unknown>) => void
  updateSendButton: () => void
  autoResizeTextarea: () => void
  updateContextChips: (els: AttachmentEls, chips?: import("../types").ContextChip[]) => void
  getActiveSession: () => { id: string } | undefined
}

export function createAttachmentManager(deps: AttachmentDeps) {
  const pendingAttachments: Attachment[] = []
  let workspaceFiles: string[] = []
  let activeFile: string | null = null
  let activeFileSelection: ActiveFileSelectionInfo | null = null
  let activeFileIncluded = true
  const dismissedActiveFiles = new Set<string>()

  function getAttachments(): Attachment[] {
    // Return a shallow copy — clearAttachments() mutates the internal array
    // in place, so callers that capture the reference before clearing would
    // see an empty array by the time they read it.
    return [...pendingAttachments]
  }

  function attachImageBlob(blob: Blob): void {
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      console.warn(`[opencode-harness] attachImageBlob: image too large (${blob.size} bytes)`)
      deps.postMessage({ type: "show_error", message: "Image attachment exceeds 10 MB limit." })
      return
    }
    console.log(`[opencode-harness] attachImageBlob: reading ${blob.size} bytes as data URL`)
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      if (!result) return
      const base64Match = result.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)
      if (base64Match && base64Match[1] && base64Match[2]) {
        pendingAttachments.push({ data: base64Match[2], mimeType: base64Match[1] })
        console.log(`[opencode-harness] attachImageBlob: attached ${base64Match[1]} (${base64Match[2].length} chars base64), total=${pendingAttachments.length}`)
        renderAttachmentChips()
        updatePromptContextChips()
        deps.updateSendButton()
      } else {
        console.warn("[opencode-harness] attachImageBlob: failed to parse data URL")
      }
    }
    reader.onerror = () => {
      console.error("[opencode-harness] Failed to read image")
    }
    reader.readAsDataURL(blob)
  }

  // W4.A: Support non-image file attachments (PDF, etc.)
  function attachFileBlob(blob: Blob, mimeType: string): void {
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      deps.postMessage({ type: "show_error", message: `File attachment exceeds 10 MB limit.` })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      if (!result) return
      const base64Match = result.match(/^data:[\w./+-]+;base64,(.+)$/)
      if (base64Match && base64Match[1]) {
        pendingAttachments.push({ data: base64Match[1], mimeType })
        renderAttachmentChips()
        updatePromptContextChips()
        deps.updateSendButton()
      }
    }
    reader.onerror = () => {
      console.error("[opencode-harness] Failed to read file attachment")
    }
    reader.readAsDataURL(blob)
  }

  function onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData
    if (!data) {
      console.warn("[opencode-harness] onPaste: no clipboardData")
      return
    }

    // First pass: DataTransferItemList. Some platforms duplicate the same
    // MIME type with a string-typed entry whose getAsFile() returns null —
    // keep iterating past those instead of bailing on the first MIME match.
    const items = data.items
    let attached = false
    if (items) {
      console.log(`[opencode-harness] onPaste: ${items.length} items in clipboardData`)
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        console.log(`[opencode-harness] onPaste: item ${i} type=${item.type} kind=${item.kind}`)
        if (!ALLOWED_IMAGE_MIMES.includes(item.type as typeof ALLOWED_IMAGE_MIMES[number])) continue
        const blob = item.getAsFile()
        if (blob) {
          console.log(`[opencode-harness] onPaste: attaching image blob ${blob.size} bytes`)
          attachImageBlob(blob)
          attached = true
          break
        }
      }
    }

    // Fallback: DataTransfer.files. Some hosts (notably some Wayland and
    // Linux DE clipboards) surface pasted images only here.
    if (!attached) {
      const files = data.files
      if (files && files.length > 0) {
        console.log(`[opencode-harness] onPaste: ${files.length} files in clipboardData.files`)
        for (let i = 0; i < files.length; i++) {
          // Index access works for both FileList and plain arrays (tests use
          // arrays); FileList also exposes `.item(i)` but it's not required.
          const f = (files as unknown as { [k: number]: File | undefined })[i]
          if (f) {
            console.log(`[opencode-harness] onPaste: file ${i} name=${f.name} type=${f.type} size=${f.size}`)
            if (ALLOWED_IMAGE_MIMES.includes(f.type as typeof ALLOWED_IMAGE_MIMES[number])) {
              attachImageBlob(f)
              attached = true
              break
            }
          }
        }
      } else {
        console.log("[opencode-harness] onPaste: no items and no files in clipboardData")
      }
    }

    if (attached) e.preventDefault()
  }

  function renderAttachmentChips(): void {
    const existing = deps.els.inputArea.querySelector(".attachment-chips")
    if (existing) existing.remove()

    if (pendingAttachments.length === 0) {
      updatePromptContextChips()
      return
    }

    const container = document.createElement("div")
    container.className = "attachment-chips"

    pendingAttachments.forEach((att, idx) => {
      const chip = document.createElement("div")
      chip.className = "attachment-chip"
      if (att.mimeType.startsWith("image/")) {
        const thumbnail = document.createElement("img")
        thumbnail.src = `data:${att.mimeType};base64,${att.data}`
        thumbnail.alt = "Attached image"
        chip.appendChild(thumbnail)
      } else {
        const icon = document.createElement("span")
        icon.className = "attachment-chip-icon"
        icon.textContent = att.mimeType === "application/pdf" ? "PDF" : "FILE"
        chip.appendChild(icon)
      }
      const remove = document.createElement("button")
      remove.className = "attachment-chip-remove"
      remove.title = "Remove attachment"
      remove.setAttribute("aria-label", "Remove attachment")
      remove.innerHTML = REMOVE_SVG
      remove.addEventListener("click", () => {
        pendingAttachments.splice(idx, 1)
        renderAttachmentChips()
        updatePromptContextChips()
        deps.updateSendButton()
      })
      chip.appendChild(remove)
      container.appendChild(chip)
    })

    deps.els.inputArea.insertBefore(container, deps.els.inputWrapper)
    updatePromptContextChips()
  }

  function updatePromptContextChips(): void {
    const mentions = parsePromptMentions(deps.els.promptInput.value)
    const chips: import("../types").ContextChip[] = mentions.map((mention) => ({
      label: mention.label,
      title: mention.title,
      kind: mention.kind,
      removable: true,
      onRemove: () => {
        deps.els.promptInput.value = removePromptToken(deps.els.promptInput.value, mention.token)
        deps.autoResizeTextarea()
        updatePromptContextChips()
        deps.updateSendButton()
        deps.els.promptInput.focus()
      },
    }))

    // Add active file chip if there is an active file and it hasn't been dismissed
    if (activeFile && !dismissedActiveFiles.has(activeFile)) {
      const basename = activeFile.split(/[\\/]/).pop() || activeFile
      const selectionLabel = activeFileSelection
        ? ` (L${activeFileSelection.startLine}-${activeFileSelection.endLine})`
        : ""
      const toggleIcon = activeFileIncluded ? "\u{1F441}" : "\u{1F6AB}"
      chips.push({
        label: `${toggleIcon} ${basename}${selectionLabel}`,
        title: activeFile + selectionLabel,
        kind: "file",
        removable: true,
        onRemove: () => {
          if (activeFile) {
            dismissedActiveFiles.add(activeFile)
          }
          updatePromptContextChips()
        },
      })
      // Add toggle chip for include/exclude
      chips.push({
        label: activeFileIncluded ? "Included" : "Excluded",
        kind: "toggle",
        removable: false,
      })
    }

    if (pendingAttachments.length > 0) {
      const hasImages = pendingAttachments.some(a => a.mimeType.startsWith("image/"))
      const hasFiles = pendingAttachments.some(a => !a.mimeType.startsWith("image/"))
      let label = ""
      if (hasImages && hasFiles) {
        label = `${pendingAttachments.length} files attached`
      } else if (hasImages) {
        label = pendingAttachments.length === 1 ? "1 image attached" : `${pendingAttachments.length} images attached`
      } else {
        label = pendingAttachments.length === 1 ? "1 file attached" : `${pendingAttachments.length} files attached`
      }
      chips.push({
        label,
        kind: "file",
        removable: false,
      })
    }

    deps.updateContextChips(deps.els, chips)
  }

  function clearAttachments(): void {
    pendingAttachments.length = 0
    renderAttachmentChips()
  }

  function setActiveFile(info: ActiveFileInfo | null): void {
    const path = info?.path ?? null
    activeFile = path
    activeFileSelection = info?.selection ?? null
    // Reset to included when switching files (per-session reset)
    activeFileIncluded = true
    // When switching to a file, always clear it from dismissed set so it reappears
    if (path) {
      dismissedActiveFiles.delete(path)
    }
    updatePromptContextChips()
  }

  function toggleActiveFileInclude(): void {
    activeFileIncluded = !activeFileIncluded
    const session = deps.getActiveSession()
    deps.postMessage({
      type: "toggle_active_file",
      sessionId: session?.id ?? "",
      include: activeFileIncluded,
    })
    updatePromptContextChips()
  }

  function isActiveFileIncluded(): boolean {
    return activeFileIncluded && !!activeFile && !dismissedActiveFiles.has(activeFile)
  }

  function getActiveFileSelection(): ActiveFileSelectionInfo | null {
    return activeFileSelection
  }

  function setWorkspaceFiles(files: string[]): void {
    workspaceFiles = files
    // Clear dismissed set when workspace files are refreshed to prevent unbounded growth
    dismissedActiveFiles.clear()
  }

  function getWorkspaceFiles(): string[] {
    return [...workspaceFiles]
  }

  function getActiveFile(): string | null {
    return activeFile
  }

  return {
    getAttachments,
    attachImageBlob,
    attachFileBlob,
    onPaste,
    renderAttachmentChips,
    updatePromptContextChips,
    clearAttachments,
    setActiveFile,
    setWorkspaceFiles,
    getWorkspaceFiles,
    getActiveFile,
    toggleActiveFileInclude,
    isActiveFileIncluded,
    getActiveFileSelection,
  }
}

export interface PromptMention {
  /** Raw matched token, e.g. `@file:"src/a b.ts"` — used for removal. */
  token: string
  /** Clean, human-readable chip label, e.g. `a b.ts`. */
  label: string
  /** Full value for the chip tooltip, e.g. the full path or URL. */
  title: string
  /** Chip kind drives the icon/colour: file | image | folder | url | problems | terminal. */
  kind: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

/** Strip the `@kind:` prefix and surrounding quotes from a mention token. */
function mentionValue(token: string): string {
  const colon = token.indexOf(":")
  const raw = colon === -1 ? token : token.slice(colon + 1)
  return raw.replace(/^["']/, "").replace(/["']$/, "")
}

/** Last non-empty path segment (basename) of a slash/backslash path. */
function basename(value: string): string {
  const segments = value.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] || value
}

/**
 * Parse `@file:` / `@folder:` / `@url:` / `@problems:` / `@terminal:` mentions
 * out of the prompt text and derive a specialised, readable chip for each.
 * Files use the basename and switch to the `image` kind for image extensions
 * so the chip surfaces an image icon instead of a generic file icon; the full
 * path/URL is preserved in `title` for the hover tooltip.
 */
export function parsePromptMentions(text: string): PromptMention[] {
  const pattern = /@(file|folder|url|problems|terminal):(?:"[^"]+"|'[^']+'|\S+)/g
  const seen = new Set<string>()
  const matches: PromptMention[] = []
  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    if (!token || seen.has(token)) continue
    seen.add(token)
    const rawKind = match[1] || "file"
    const value = mentionValue(token)
    let label = value
    let kind = rawKind
    let title = value
    switch (rawKind) {
      case "file":
        label = basename(value)
        kind = IMAGE_EXT.test(value) ? "image" : "file"
        break
      case "folder":
        label = `${basename(value)}/`
        break
      case "url":
        try {
          label = new URL(value).hostname || value
        } catch {
          label = value
        }
        break
      case "problems":
        label = "Problems"
        title = "Workspace problems"
        break
      case "terminal":
        label = "Terminal"
        title = "Terminal output"
        break
    }
    matches.push({ token, label, title, kind })
  }
  return matches
}

export function removePromptToken(text: string, token: string): string {
  return text.replace(token, "").replace(/[ \t]{2,}/g, " ").trimStart()
}
