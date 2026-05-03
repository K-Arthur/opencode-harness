import * as vscode from "vscode"
import { type ChatMessage } from "../chat/ChatProvider"

export interface OpenCodeSession {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string
  cliSessionId?: string
  messages: ChatMessage[]
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

  create(name?: string): OpenCodeSession {
    const id = crypto.randomUUID()
    const now = Date.now()
    const session: OpenCodeSession = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      createdAt: now,
      lastActiveAt: now,
      model: "",
      messages: [],
    }
    this.sessions.set(id, session)
    this.activeSessionId = id
    this.save()
    this._onSessionsChanged.fire()
    this._onActiveSessionChanged.fire(id)
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

  appendMessage(msg: ChatMessage): void {
    const session = this.getActive()
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

  updateCliSessionId(id: string, cliId: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.cliSessionId = cliId
    this.save()
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
