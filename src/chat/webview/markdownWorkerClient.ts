/**
 * MarkdownWorkerClient — manages a Web Worker for async markdown rendering and syntax highlighting.
 * Extracted from renderer.ts to break the renderer↔toolCallRenderer dependency cycle.
 */

type WorkerMessage =
  | { id: number; html: string }
  | { id: number; error: string }

type PendingWorkerTask = {
  resolve: (html: string | undefined) => void
  timer: ReturnType<typeof setTimeout>
}

export const HIGHLIGHT_WORKER_TIMEOUT_MS = 10_000

class MarkdownWorkerClient {
  private worker: Worker | undefined
  private workerPromise: Promise<Worker | null> | undefined
  private objectUrl: string | undefined
  private pending = new Map<number, PendingWorkerTask>()
  private nextId = 1
  private disabled = false
  private highlightTimeout = HIGHLIGHT_WORKER_TIMEOUT_MS

  async render(normalized: string): Promise<string | undefined> {
    if (this.disabled) return undefined
    const worker = await this.getWorker()
    if (!worker) return undefined

    const id = this.nextId
    this.nextId = (this.nextId % 0x7fffffff) + 1
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(undefined)
      }, HIGHLIGHT_WORKER_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      try {
        worker.postMessage({ id, text: normalized })
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(undefined)
      }
    })
  }

  async highlight(code: string, language: string): Promise<string | undefined> {
    if (this.disabled) return undefined
    const worker = await this.getWorker()
    if (!worker) return undefined

    const id = this.nextId
    this.nextId = (this.nextId % 0x7fffffff) + 1
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(undefined)
      }, this.highlightTimeout)
      this.pending.set(id, { resolve, timer })
      try {
        worker.postMessage({ id, code, language, type: "highlight" })
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(undefined)
      }
    })
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve(undefined)
    }
    this.pending.clear()
    try {
      this.worker?.terminate()
    } catch {
      // Best-effort shutdown only.
    }
    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl)
      } catch {
        // Best-effort cleanup only.
      }
    }
    this.worker = undefined
    this.workerPromise = undefined
    this.objectUrl = undefined
    this.disabled = true
  }

  private async getWorker(): Promise<Worker | null> {
    if (this.worker) return this.worker
    if (this.workerPromise) return this.workerPromise
    this.workerPromise = this.createWorker().catch(() => {
      this.disabled = true
      this.dispose()
      return null
    })
    return this.workerPromise
  }

  private async createWorker(): Promise<Worker | null> {
    const sourceUri = window.__OC_MARKDOWN_WORKER_URI__
    if (!sourceUri) return null

    const response = await fetch(sourceUri)
    if (!response.ok) throw new Error(`Markdown worker fetch failed: ${response.status}`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const worker = new Worker(objectUrl, { name: "opencode-markdown-renderer" })
    this.objectUrl = objectUrl
    this.worker = worker

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      const entry = this.pending.get(message?.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      if ("error" in message) {
        console.warn("[opencode] Markdown worker error:", message.error)
      }
      entry.resolve("html" in message && typeof message.html === "string" ? message.html : undefined)
    }
    worker.onerror = () => {
      this.disabled = true
      this.dispose()
    }

    return worker
  }
}

let markdownWorkerClient: MarkdownWorkerClient | undefined

export function getMarkdownWorkerClient(): MarkdownWorkerClient {
  if (!markdownWorkerClient) markdownWorkerClient = new MarkdownWorkerClient()
  return markdownWorkerClient
}

export function resetMarkdownWorkerClient(): void {
  if (markdownWorkerClient) {
    markdownWorkerClient.dispose()
    markdownWorkerClient = undefined
  }
}
