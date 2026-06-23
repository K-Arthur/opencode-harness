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
  }

  function toggleActiveFile(include: boolean): void {
    const item = items.find((i) => i.type === "active_file")
    if (item) {
      item.isActive = include
    }
    deps.postMessage({ type: "toggle_active_file", sessionId: "", include })
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
  }

  function addPickedFile(path: string): void {
    items.push({
      id: generateId("file"),
      type: "picked_file",
      path,
      isActive: false,
    })
  }

  function removeItem(id: string): void {
    const idx = items.findIndex((i) => i.id === id)
    if (idx >= 0) items.splice(idx, 1)
  }

  function clear(): void {
    items.length = 0
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
  }
}
