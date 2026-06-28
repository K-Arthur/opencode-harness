/**
 * Drag-and-drop file upload module for the OpenCode chat webview.
 * Handles file drops from VS Code Explorer and external file managers.
 */

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

export interface DragDropDeps {
  els: {
    app: HTMLElement
    inputArea: HTMLElement
  }
  postMessage: (msg: Record<string, unknown>) => void
  attachmentManager: {
    attachImageBlob: (blob: Blob) => void
    attachFileBlob: (blob: Blob, mimeType: string) => void
    addPickedFile: (path: string) => void
  }
}

/**
 * Parse dataTransfer payload to extract workspace files and external files.
 * VS Code Explorer drags use text/uri-list MIME type.
 * External file manager drags use dataTransfer.files.
 */
function parseDataTransfer(dataTransfer: DataTransfer): {
  workspaceFiles: string[]
  externalFiles: File[]
} {
  const workspaceFiles: string[] = []
  const externalFiles: File[] = []

  // Check for VS Code Explorer drag (text/uri-list)
  if (dataTransfer.types.includes("text/uri-list")) {
    const uriList = dataTransfer.getData("text/uri-list")
    const uris = uriList.split("\n").filter((line) => line.trim() && !line.startsWith("#"))
    for (const uri of uris) {
      // Convert file:// URIs to workspace-relative paths
      if (uri.startsWith("file://")) {
        const path = decodeURIComponent(uri.slice(7))
        workspaceFiles.push(path)
      }
    }
  }

  // Fall back to external files (dataTransfer.files)
  const files = dataTransfer.files
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file) {
        externalFiles.push(file)
      }
    }
  }

  return { workspaceFiles, externalFiles }
}

/**
 * Process dropped items and add them to the context system.
 */
function processDroppedItems(
  workspaceFiles: string[],
  externalFiles: File[],
  attachmentManager: DragDropDeps["attachmentManager"],
  postMessage: DragDropDeps["postMessage"]
): void {
  // Process workspace files (VS Code Explorer drags)
  for (const path of workspaceFiles) {
    attachmentManager.addPickedFile(path)
  }

  // Process external files (file manager drags)
  for (const file of externalFiles) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      postMessage({
        type: "show_error",
        message: `File "${file.name}" exceeds 10 MB limit.`,
      })
      continue
    }

    // Images: attach as base64
    if (ALLOWED_IMAGE_MIMES.includes(file.type as typeof ALLOWED_IMAGE_MIMES[number])) {
      attachmentManager.attachImageBlob(file)
      continue
    }

    // Documents: check MIME type
    if (ALLOWED_DOCUMENT_MIMES.includes(file.type as typeof ALLOWED_DOCUMENT_MIMES[number])) {
      attachmentManager.attachFileBlob(file, file.type)
      continue
    }

    // Unsupported file type
    postMessage({
      type: "show_error",
      message: `Unsupported file type: ${file.type || "unknown"} for "${file.name}"`,
    })
  }
}

/**
 * Create and show the drag-over visual overlay.
 */
function createOverlay(): HTMLElement {
  const overlay = document.createElement("div")
  overlay.className = "drop-overlay"
  overlay.setAttribute("aria-hidden", "true")

  const text = document.createElement("div")
  text.className = "drop-overlay-text"
  text.textContent = "Drop files or images here to add to context"

  overlay.appendChild(text)
  document.body.appendChild(overlay)

  return overlay
}

/** Tracks app containers that already have drag-drop wired, so re-running
 *  setup (e.g. on webview re-init) never stacks duplicate, competing listeners. */
const boundDragDropApps = new WeakSet<HTMLElement>()

/**
 * Set up drag-and-drop event listeners on the app container.
 */
export function setupDragDrop(deps: DragDropDeps): void {
  const { els, postMessage, attachmentManager } = deps

  // Idempotency guard — duplicate listeners previously raced show/hide and
  // could leave the overlay stuck.
  if (boundDragDropApps.has(els.app)) return
  boundDragDropApps.add(els.app)

  let overlay: HTMLElement | null = null
  let dragCounter = 0
  let emergencyHideTimeout: number | undefined

  function clearEmergencyHide(): void {
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
      emergencyHideTimeout = undefined
    }
  }

  function showOverlay(): void {
    if (!overlay) {
      overlay = createOverlay()
    }
    clearEmergencyHide()
  }

  function hideOverlay(): void {
    if (overlay) {
      overlay.remove()
      overlay = null
    }
    clearEmergencyHide()
  }

  function forceHideOverlay(): void {
    dragCounter = 0
    hideOverlay()
  }

  // Self-heal: if a drag ends without a dragleave/drop reaching us (jittery DnD,
  // drag cancelled outside the window), the overlay still vanishes within 3s.
  // Any subsequent dragenter/dragover cancels this, so it only fires when the
  // drag has genuinely gone silent.
  function armEmergencyHide(): void {
    clearEmergencyHide()
    emergencyHideTimeout = window.setTimeout(() => forceHideOverlay(), 3000)
  }

  // Symmetric enter/leave counter. Every dragenter increments and every
  // dragleave decrements — moving parent → child fires dragenter(child) then
  // dragleave(parent), so the counter stays > 0 (no flicker) and only reaches 0
  // when the drag truly leaves the panel. The previous code incremented on every
  // enter but decremented only when leaving the app bounds, so the counter
  // leaked upward and the overlay never hid.
  els.app.addEventListener("dragenter", (e) => {
    e.preventDefault()
    e.stopPropagation()
    clearEmergencyHide()
    dragCounter++
    showOverlay()
  })

  els.app.addEventListener("dragover", (e) => {
    e.preventDefault()
    e.stopPropagation()
    clearEmergencyHide()
    showOverlay()
  })

  els.app.addEventListener("dragleave", (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter--
    if (dragCounter <= 0) {
      forceHideOverlay()
    } else {
      armEmergencyHide()
    }
  })

  els.app.addEventListener("drop", (e) => {
    e.preventDefault()
    e.stopPropagation()
    forceHideOverlay()

    // If the drop happened inside the input area, the input area handler
    // already processed the files (it has its own file-mention logic).
    // Skip processing so we don't double-attach.
    if (els.inputArea.contains(e.target as Node)) return

    const dataTransfer = e.dataTransfer
    if (!dataTransfer) return

    const { workspaceFiles, externalFiles } = parseDataTransfer(dataTransfer)
    processDroppedItems(workspaceFiles, externalFiles, attachmentManager, postMessage)
  })

  // Window-exit fallback: leaving the whole window yields relatedTarget === null.
  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) forceHideOverlay()
  })
}
