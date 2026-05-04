import * as vscode from "vscode"
import { type ChatMessage } from "../chat/ChatProvider"
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
  private _onSessionsChanged = new vscode.EventEmitter<void>()
  readonly onSessionsChanged = this._onSessionsChanged.event

  private _onActiveSessionChanged = new vscode.EventEmitter<string>()
  readonly onActiveSessionChanged = this._onActiveSessionChanged.event

  constructor(private readonly globalState: vscode.Memento) {
    this.load()
  }

  private load(): void {
    const raw = this.globalState.get<Record<string, OpenCodeSession>>(STORAGE_KEY, {})
    for (const [id, sess] of Object.entries(raw)) {
      // Migrate old sessions without mode field
      if (!sess.mode) sess.mode = "normal"
      this.sessions.set(id, sess)
    }
  }

  private save(): void {
    const obj: Record<string, OpenCodeSession> = {}
    for (const [id, sess] of this.sessions) {
      obj[id] = sess
    }
    this.globalState.update(STORAGE_KEY, obj)
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
      mode: "normal",
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
      if (mode !== undefined && existing.mode !== mode) existing.mode = mode
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
    if (mode !== undefined) { session.mode = mode || "normal"; needsSave = true }
    if (needsSave) this.save()
    return session
  }

  getActive(): OpenCodeSession | undefined {
    if (!this.activeSessionId && this.sessions.size > 0) {
      // Restore last active
      const sorted = Array.from(this.sessions.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      this.activeSessionId = sorted[0].id
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
    this.save()
    this._onSessionsChanged.fire()
  }

  updateName(id: string, name: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.name = name
    this.save()
    this._onSessionsChanged.fire()
  }

  /** Alias for updateName – convenience for command handlers. */
  rename(id: string, name: string): void {
    this.updateName(id, name)
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
        this.setActive(remaining[0].id)
      }
    }
    this.save()
    this._onSessionsChanged.fire()
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
