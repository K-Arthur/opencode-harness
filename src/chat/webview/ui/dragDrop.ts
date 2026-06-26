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

/**
 * Set up drag-and-drop event listeners on the app container.
 */
export function setupDragDrop(deps: DragDropDeps): void {
  const { els, postMessage, attachmentManager } = deps
  let overlay: HTMLElement | null = null
  let dragCounter = 0
  let rafId: number | undefined
  let emergencyHideTimeout: number | undefined

  function showOverlay(): void {
    if (!overlay) {
      overlay = createOverlay()
    }
    // Clear any emergency hide timeout when overlay is shown
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
      emergencyHideTimeout = undefined
    }
  }

  function hideOverlay(): void {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
    rafId = requestAnimationFrame(() => {
      if (overlay && dragCounter === 0) {
        overlay.remove()
        overlay = null
      }
    })
  }

  function forceHideOverlay(): void {
    if (overlay) {
      overlay.remove()
      overlay = null
    }
    dragCounter = 0
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
      emergencyHideTimeout = undefined
    }
  }

  // Check if the related target is outside the app bounds
  function isOutsideApp(relatedTarget: EventTarget | null): boolean {
    if (!relatedTarget) return true
    const target = relatedTarget as Node
    return !els.app.contains(target)
  }

  // dragenter: increment counter, show overlay
  els.app.addEventListener("dragenter", (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter++
    showOverlay()
  })

  // dragover: prevent default to allow drop
  els.app.addEventListener("dragover", (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Ensure overlay is visible during dragover
    showOverlay()
  })

  // dragleave: decrement counter only if leaving app bounds, hide overlay if no more drags
  els.app.addEventListener("dragleave", (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Only decrement if we're actually leaving the app container
    if (isOutsideApp(e.relatedTarget)) {
      dragCounter--
      if (dragCounter <= 0) {
        dragCounter = 0
        hideOverlay()
      }
    }
  })

  // drop: process files, force-hide overlay
  els.app.addEventListener("drop", (e) => {
    e.preventDefault()
    e.stopPropagation()
    forceHideOverlay()

    const dataTransfer = e.dataTransfer
    if (!dataTransfer) return

    const { workspaceFiles, externalFiles } = parseDataTransfer(dataTransfer)
    processDroppedItems(workspaceFiles, externalFiles, attachmentManager, postMessage)
  })

  // Document-level dragleave fallback: if the drag leaves the window entirely, hide the overlay
  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) {
      // Drag left the window
      forceHideOverlay()
    }
  })

  // Emergency hide timeout: overlay cannot survive more than 3 seconds after last drag event
  els.app.addEventListener("dragenter", () => {
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
      emergencyHideTimeout = undefined
    }
  })

  els.app.addEventListener("dragover", () => {
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
      emergencyHideTimeout = undefined
    }
  })

  function setEmergencyHideTimeout(): void {
    if (emergencyHideTimeout) {
      clearTimeout(emergencyHideTimeout)
    }
    emergencyHideTimeout = window.setTimeout(() => {
      forceHideOverlay()
    }, 3000)
  }

  // Set emergency timeout on dragleave (outside app) and drop
  els.app.addEventListener("dragleave", (e) => {
    if (isOutsideApp(e.relatedTarget)) {
      setEmergencyHideTimeout()
    }
  })

  els.app.addEventListener("drop", () => {
    setEmergencyHideTimeout()
  })
}
