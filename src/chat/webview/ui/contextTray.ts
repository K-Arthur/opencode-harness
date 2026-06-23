import type { AttachedContextItem, ContextTraySummary, Attachment } from "../types"

const IMAGE_TOKEN_ESTIMATE = 768
const ACTIVE_FILE_ID = "__active_file__"

export interface ContextTrayDeps {
  trayEl: HTMLElement
  summaryEl: HTMLElement
  itemsEl: HTMLElement
  postMessage: (msg: Record<string, unknown>) => void
}

interface ActiveFileInfo {
  path: string
  languageId: string
  lineCount: number
}

interface ImageInfo {
  data: string
  mimeType: string
  sizeBytes: number
}

interface DocumentInfo {
  data: string
  mimeType: string
  sizeBytes: number
  lineCount: number
}

function generateId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

function estimateDocumentTokens(data: string, lineCount: number): number {
  let decoded: string
  try {
    decoded = atob(data)
  } catch {
    decoded = data
  }
  const charCount = decoded.length
  const baseTokens = Math.ceil(charCount / 4)
  if (lineCount > 0) {
    return Math.max(baseTokens, lineCount)
  }
  return baseTokens
}

export function createContextTrayManager(deps: ContextTrayDeps) {
  const items: AttachedContextItem[] = []
  let expanded = false
  const TOKEN_BUDGET = 128000

  function getItems(): AttachedContextItem[] {
    return [...items]
  }

  function setActiveFile(info: ActiveFileInfo | null): void {
    const existingIdx = items.findIndex((i) => i.type === "active_file")
    if (info === null) {
      if (existingIdx >= 0) items.splice(existingIdx, 1)
    } else {
      const item: AttachedContextItem = {
        id: ACTIVE_FILE_ID,
        type: "active_file",
        path: info.path,
        languageId: info.languageId,
        lineCount: info.lineCount,
        isActive: true,
        tokenEstimate: estimateDocumentTokens(btoa("x".repeat(Math.max(info.lineCount * 40, 1))), info.lineCount),
      }
      if (existingIdx >= 0) {
        items.splice(existingIdx, 1)
      }
      items.push(item)
    }
    render()
  }

  function toggleActiveFile(include: boolean): void {
    const item = items.find((i) => i.type === "active_file")
    if (item) {
      item.isActive = include
    }
    deps.postMessage({ type: "toggle_active_file", sessionId: "", include })
    render()
  }

  function addImage(info: ImageInfo): void {
    items.push({
      id: generateId("img"),
      type: "image",
      data: info.data,
      mimeType: info.mimeType,
      sizeBytes: info.sizeBytes,
      isActive: false,
      tokenEstimate: IMAGE_TOKEN_ESTIMATE,
    })
    render()
  }

  function addDocument(info: DocumentInfo): void {
    items.push({
      id: generateId("doc"),
      type: "document",
      data: info.data,
      mimeType: info.mimeType,
      sizeBytes: info.sizeBytes,
      lineCount: info.lineCount,
      isActive: false,
      tokenEstimate: estimateDocumentTokens(info.data, info.lineCount),
    })
    render()
  }

  function addPickedFile(path: string): void {
    items.push({
      id: generateId("file"),
      type: "picked_file",
      path,
      isActive: false,
    })
    render()
  }

  function removeItem(id: string): void {
    const idx = items.findIndex((i) => i.id === id)
    if (idx >= 0) items.splice(idx, 1)
    render()
  }

  function clear(): void {
    items.length = 0
    render()
  }

  function getActiveFileItem(): AttachedContextItem | undefined {
    return items.find((i) => i.type === "active_file" && i.isActive)
  }

  function getActiveFilePath(): string | undefined {
    return getActiveFileItem()?.path
  }

  function getSummary(): ContextTraySummary {
    let fileCount = 0
    let imageCount = 0
    let documentCount = 0
    let totalTokens = 0

    for (const item of items) {
      if (item.type === "active_file" || item.type === "picked_file") {
        fileCount++
      } else if (item.type === "image") {
        imageCount++
      } else if (item.type === "document") {
        documentCount++
      }
      totalTokens += item.tokenEstimate ?? 0
    }

    return { fileCount, imageCount, documentCount, totalTokens }
  }

  function getAttachmentsForPayload(): Attachment[] {
    return items
      .filter((i) => (i.type === "image" || i.type === "document") && i.data && i.mimeType)
      .map((i) => ({ data: i.data!, mimeType: i.mimeType! }))
  }

  function toggleExpanded(): void {
    expanded = !expanded
    render()
  }

  function getItemIcon(item: AttachedContextItem): string {
    if (item.type === "active_file") return item.isActive ? "\u{1F441}" : "\u{1F6AB}"
    if (item.type === "image") return "\u{1F5BC}"
    if (item.type === "document") return "\u{1F4C4}"
    return "\u{1F4C1}"
  }

  function getItemLabel(item: AttachedContextItem): string {
    if (item.type === "active_file" || item.type === "picked_file") {
      const basename = item.path?.split(/[\\/]/).pop() || item.path || "unknown"
      return basename
    }
    if (item.type === "image") {
      return `image (${item.sizeBytes ?? 0}B)`
    }
    if (item.type === "document") {
      return `doc (${item.lineCount ?? 0} lines)`
    }
    return "item"
  }

  function render(): void {
    const summary = getSummary()
    const hasItems = items.length > 0

    if (!hasItems) {
      deps.trayEl.classList.add("hidden")
      return
    }
    deps.trayEl.classList.remove("hidden")
    deps.trayEl.setAttribute("aria-expanded", expanded ? "true" : "false")

    const labelEl = deps.summaryEl.querySelector("#context-tray-label") as HTMLElement | null
    if (labelEl) {
      const parts: string[] = []
      if (summary.fileCount > 0) parts.push(`${summary.fileCount} file${summary.fileCount > 1 ? "s" : ""}`)
      if (summary.imageCount > 0) parts.push(`${summary.imageCount} image${summary.imageCount > 1 ? "s" : ""}`)
      if (summary.documentCount > 0) parts.push(`${summary.documentCount} doc${summary.documentCount > 1 ? "s" : ""}`)
      const tokenPct = Math.round((summary.totalTokens / TOKEN_BUDGET) * 100)
      labelEl.textContent = `${parts.join(", ")} \u00B7 ~${summary.totalTokens.toLocaleString()} tokens (${tokenPct}%)`
    }

    if (expanded) {
      deps.itemsEl.classList.remove("hidden")
      deps.itemsEl.innerHTML = ""
      for (const item of items) {
        const el = document.createElement("div")
        el.className = "context-tray-item"
        el.title = item.path || getItemLabel(item)

        const icon = document.createElement("span")
        icon.className = "context-tray-item-icon"
        icon.textContent = getItemIcon(item)
        el.appendChild(icon)

        const label = document.createElement("span")
        label.className = "context-tray-item-label"
        label.textContent = getItemLabel(item)
        el.appendChild(label)

        if (item.tokenEstimate) {
          const tokens = document.createElement("span")
          tokens.className = "context-tray-item-tokens"
          tokens.style.opacity = "0.6"
          tokens.textContent = `~${item.tokenEstimate}`
          el.appendChild(tokens)
        }

        const removeBtn = document.createElement("button")
        removeBtn.className = "context-tray-item-remove"
        removeBtn.textContent = "\u00D7"
        removeBtn.setAttribute("aria-label", "Remove")
        removeBtn.addEventListener("click", () => removeItem(item.id))
        el.appendChild(removeBtn)

        deps.itemsEl.appendChild(el)
      }

      // Token bar
      const tokenPct = Math.min(100, (summary.totalTokens / TOKEN_BUDGET) * 100)
      const bar = document.createElement("div")
      bar.className = "context-tray-token-bar"
      const fill = document.createElement("div")
      fill.className = "context-tray-token-fill"
      fill.style.width = `${tokenPct}%`
      bar.appendChild(fill)
      deps.itemsEl.appendChild(bar)
    } else {
      deps.itemsEl.classList.add("hidden")
    }
  }

  // Wire up toggle on summary click
  deps.summaryEl.addEventListener("click", () => toggleExpanded())
  deps.summaryEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      toggleExpanded()
    }
  })

  return {
    getItems,
    setActiveFile,
    toggleActiveFile,
    addImage,
    addDocument,
    addPickedFile,
    removeItem,
    clear,
    getActiveFileItem,
    getActiveFilePath,
    getSummary,
    getAttachmentsForPayload,
    render,
    toggleExpanded,
  }
}
