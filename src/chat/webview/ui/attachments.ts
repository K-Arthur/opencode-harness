import { REMOVE_SVG } from "../icons"

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const

export interface Attachment {
  data: string
  mimeType: string
}

export interface AttachmentEls {
  inputArea: HTMLElement
  inputWrapper: HTMLElement
  promptInput: HTMLTextAreaElement
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

  function getAttachments(): Attachment[] {
    return pendingAttachments
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

  return {
    getAttachments,
    attachImageBlob,
    attachFileBlob,
    onPaste,
    renderAttachmentChips,
    updatePromptContextChips,
    clearAttachments,
  }
}

export function parsePromptMentions(text: string): Array<{ token: string; label: string; kind: string }> {
  const pattern = /@(file|folder|url|problems|terminal):(?:"[^"]+"|'[^']+'|\S+)/g
  const seen = new Set<string>()
  const matches: Array<{ token: string; label: string; kind: string }> = []
  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    if (!token || seen.has(token)) continue
    seen.add(token)
    matches.push({ token, label: token, kind: match[1] || "file" })
  }
  return matches
}

export function removePromptToken(text: string, token: string): string {
  return text.replace(token, "").replace(/[ \t]{2,}/g, " ").trimStart()
}
