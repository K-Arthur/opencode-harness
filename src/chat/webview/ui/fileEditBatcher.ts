import { timers } from "../timerRegistry"

export class FileEditBatcher {
  private pending = new Map<string, { files: Set<string>; timer: ReturnType<typeof setTimeout> | null }>()
  private readonly FLUSH_MS = 500

  constructor(private onFlush: (sessionId: string, text: string) => void) {}

  add(sessionId: string, filePath: string) {
    let entry = this.pending.get(sessionId)
    if (!entry) {
      entry = { files: new Set<string>(), timer: null }
      this.pending.set(sessionId, entry)
    }
    entry.files.add(filePath)
    if (entry.timer !== null) timers.clearTimeout(entry.timer)
    entry.timer = timers.setTimeout(() => this.flush(sessionId), this.FLUSH_MS)
  }

  private flush(sessionId: string) {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    this.pending.delete(sessionId)
    const files = Array.from(entry.files)
    if (files.length === 0) return
    const text = files.length === 1
      ? `Edited ${files[0]}`
      : `Edited ${files.length} files: ${files.map(f => f.split("/").pop()).join(", ")}`
    this.onFlush(sessionId, text)
  }

  cancelAll() {
    for (const entry of this.pending.values()) {
      if (entry.timer !== null) timers.clearTimeout(entry.timer)
    }
    this.pending.clear()
  }
}
