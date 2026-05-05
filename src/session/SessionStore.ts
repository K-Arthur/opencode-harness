import * as vscode from "vscode"
import { type ChatMessage } from "../types"
import { log } from "../utils/outputChannel"

export interface OpenCodeSession {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string
  mode: string
  cliSessionId?: string
  messages: ChatMessage[]
  cost: number
  tokenUsage: { prompt: number; completion: number; total: number }
}

const STORAGE_KEY = "opencode-harness.sessions"

export class SessionStore {
  private sessions: Map<string, OpenCodeSession> = new Map()
  private activeSessionId = ""
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly SAVE_DEBOUNCE_MS = 500
  private static readonly MAX_SESSIONS = 50
  private _onSessionsChanged = new vscode.EventEmitter<void>()
  readonly onSessionsChanged = this._onSessionsChanged.event

  private _onActiveSessionChanged = new vscode.EventEmitter<string>()
  readonly onActiveSessionChanged = this._onActiveSessionChanged.event

  constructor(private readonly globalState: vscode.Memento) {
    this.load()
  }

  private isValidSession(sess: Record<string, unknown>): boolean {
    return (
      typeof sess.id === "string" &&
      typeof sess.name === "string" &&
      typeof sess.createdAt === "number" &&
      Array.isArray(sess.messages)
    )
  }

  private load(): void {
    const raw = this.globalState.get<Record<string, Record<string, unknown>>>(STORAGE_KEY, {})
    for (const [id, sess] of Object.entries(raw)) {
      if (typeof sess !== "object" || !sess || !this.isValidSession(sess)) {
        log.warn(`Skipping invalid session entry: ${id}`)
        continue
      }
      if (!sess.mode) sess.mode = "normal"
      if (typeof sess.lastActiveAt !== "number") sess.lastActiveAt = Date.now()
      if (typeof sess.model !== "string") sess.model = ""
      if (typeof sess.cost !== "number") sess.cost = 0
      if (typeof sess.tokenUsage !== "object") sess.tokenUsage = { prompt: 0, completion: 0, total: 0 }
      // Skip sessions with no messages unless they're the active session
      const msgCount = Array.isArray(sess.messages) ? sess.messages.length : 0
      if (msgCount === 0 && id !== this.activeSessionId) {
        continue
      }
      this.sessions.set(id, sess as unknown as OpenCodeSession)
    }
    this.pruneStaleSessions()
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.flush()
    }, SessionStore.SAVE_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      const obj: Record<string, OpenCodeSession> = {}
      for (const [id, sess] of this.sessions) {
        // Only persist sessions that have actual messages
        if (sess.messages.length > 0 || id === this.activeSessionId) {
          obj[id] = sess
        }
      }
      await this.globalState.update(STORAGE_KEY, obj)
    } catch (err) {
      log.error("Failed to save sessions to globalState", err)
    }
  }

  private pruneStaleSessions(): void {
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    const staleIds: string[] = []
    for (const [id, sess] of this.sessions) {
      if (sess.messages.length === 0 && (now - sess.lastActiveAt) > ONE_HOUR && id !== this.activeSessionId) {
        staleIds.push(id)
      }
    }
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.sessions.delete(id)
      }
      log.info(`Pruned ${staleIds.length} stale empty sessions`)
    }
    while (this.sessions.size > SessionStore.MAX_SESSIONS) {
      const sorted = Array.from(this.sessions.values()).sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      const oldest = sorted[0]
      if (oldest && oldest.id !== this.activeSessionId) {
        this.sessions.delete(oldest.id)
      } else {
        break
      }
    }
  }

  create(name?: string, id?: string): OpenCodeSession {
    const sessionId = id || crypto.randomUUID()
    const now = Date.now()
    const session: OpenCodeSession = {
      id: sessionId,
      name: name || `Session ${this.sessions.size + 1}`,
      createdAt: now,
      lastActiveAt: now,
      model: "",
      mode: "build",
      messages: [],
      cost: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    }
    this.sessions.set(sessionId, session)
    this.activeSessionId = sessionId
    this.save()
    this._onSessionsChanged.fire()
    this._onActiveSessionChanged.fire(sessionId)
    return session
  }

  ensure(id: string, name?: string, model?: string, mode?: string): OpenCodeSession {
    const existing = this.sessions.get(id)
    if (existing) {
      if (name !== undefined && existing.name !== name) existing.name = name
      if (model !== undefined && existing.model !== model) existing.model = model
      if (mode !== undefined && existing.mode !== mode) existing.mode = mode === "normal" ? "plan" : mode
      existing.lastActiveAt = Date.now()
      this.save()
      this._onSessionsChanged.fire()
      return existing
    }

    const session = this.create(name, id)
    // Set model/mode before persisting — create() already called save(),
    // but these fields weren't set yet. Single follow-up save is needed.
    let needsSave = false
    if (model !== undefined) { session.model = model; needsSave = true }
    if (mode !== undefined) { session.mode = mode === "normal" ? "plan" : (mode || "plan"); needsSave = true }
    if (needsSave) this.save()
    return session
  }

  getActive(): OpenCodeSession | undefined {
    if (!this.activeSessionId && this.sessions.size > 0) {
      // Restore last active
      const sorted = Array.from(this.sessions.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      this.activeSessionId = sorted[0]!.id
    }
    return this.sessions.get(this.activeSessionId)
  }

  get(id: string): OpenCodeSession | undefined {
    return this.sessions.get(id)
  }

  list(): OpenCodeSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  setActive(id: string): OpenCodeSession | undefined {
    const session = this.sessions.get(id)
    if (session) {
      this.activeSessionId = id
      this._onActiveSessionChanged.fire(id)
    }
    return session
  }

  appendMessage(sessionId: string, msg: ChatMessage): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.messages.push(msg)
    session.lastActiveAt = Date.now()

    // Auto-generate title from first user message if still generic
    if (msg.role === "user" && (session.name === "Default" || session.name.startsWith("Session "))) {
      const textBlock = msg.blocks.find((b) => b.type === "text")
      const text = typeof textBlock?.text === "string" ? textBlock.text : ""
      const generated = this.generateTitleFromMessage(text)
      if (generated) {
        session.name = generated
      }
    }

    this.save()
    this._onSessionsChanged.fire()
  }

  /**
   * Generate a session title from the first user message.
   * Uses the first sentence truncated at 40 chars.
   */
  generateTitleFromMessage(text: string): string {
    if (!text || !text.trim()) return ""
    // Take first sentence (up to first period, question mark, or exclamation)
    const firstSentence = text.split(/[.!?\n]/)[0] || text
    const trimmed = firstSentence.trim()
    if (trimmed.length === 0) return ""
    // Truncate at 40 chars with ellipsis
    if (trimmed.length > 40) {
      return trimmed.slice(0, 37).trimEnd() + "..."
    }
    return trimmed
  }

  /**
   * Validate a session rename.
   * Returns an error message if invalid, or null if valid.
   */
  validateSessionName(name: string): string | null {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return "Session name cannot be empty."
    }
    if (trimmed.length > 80) {
      return "Session name must be 80 characters or fewer."
    }
    if (/[\\/:*?"<>|]/.test(trimmed)) {
      return "Session name cannot contain path separator characters."
    }
    return null
  }

  updateName(id: string, name: string): boolean {
    const validationError = this.validateSessionName(name)
    if (validationError) {
      log.warn(`Invalid session name: ${validationError}`)
      return false
    }
    const session = this.sessions.get(id)
    if (!session) return false
    session.name = name.trim()
    this.save()
    this._onSessionsChanged.fire()
    return true
  }

  /** Alias for updateName – convenience for command handlers. */
  rename(id: string, name: string): boolean {
    return this.updateName(id, name)
  }

  updateCliSessionId(id: string, cliId: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.cliSessionId = cliId
    this.save()
  }

  /** Update the model associated with a specific session. */
  updateModel(id: string, model: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.model = model
    this.save()
  }

  updateMode(id: string, mode: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.mode = mode
    this.save()
  }

  updateCost(id: string, cost: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.cost = cost
    session.lastActiveAt = Date.now()
    this.save()
  }

  updateTokenUsage(id: string, usage: { prompt: number; completion: number; total: number }): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.tokenUsage = usage
    session.lastActiveAt = Date.now()
    this.save()
  }

  /**
   * Invalidate all CLI session IDs — called when the opencode server restarts
   * so that stale server-side session references are not reused.
   * Local message history is preserved; only the server link is cleared.
   */
  invalidateAllCliSessionIds(): void {
    for (const session of this.sessions.values()) {
      session.cliSessionId = undefined
    }
    this.save()
    log.info("All CLI session IDs invalidated (server restart detected)")
  }

  delete(id: string): void {
    this.sessions.delete(id)
    if (this.activeSessionId === id) {
      this.activeSessionId = ""
      const remaining = this.list()
      if (remaining.length > 0) {
        this.setActive(remaining[0]!.id)
      }
    }
    this.save()
    this._onSessionsChanged.fire()
  }

  dispose(): void {
    this.flush()
    this._onSessionsChanged.dispose()
    this._onActiveSessionChanged.dispose()
  }

  truncateMessages(id: string, keepUpToIndex: number): number {
    const session = this.sessions.get(id)
    if (!session) return 0
    const removed = session.messages.splice(keepUpToIndex)
    this.save()
    this._onSessionsChanged.fire()
    return removed.length
  }

  duplicate(id: string): OpenCodeSession | undefined {
    const source = this.sessions.get(id)
    if (!source) return
    const clone: OpenCodeSession = {
      ...JSON.parse(JSON.stringify(source)),
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.sessions.set(clone.id, clone)
    this.activeSessionId = clone.id
    this.save()
    this._onSessionsChanged.fire()
    return clone
  }

  get activeId(): string {
    return this.activeSessionId
  }

  get count(): number {
    return this.sessions.size
  }
}
