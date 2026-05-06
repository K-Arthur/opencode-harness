import * as vscode from "vscode"
import { type ChatMessage } from "../types"
import { log } from "../utils/outputChannel"
import {
  migrateLocalIdsToServerIds as migrateLocalIdsToServerIdsPure,
  mergeServerSessions as mergeServerSessionsPure,
  promotePendingServerLink as promotePendingServerLinkPure,
  type MigratableSession,
  type ServerSessionSnapshot,
  type ImportResult,
  type MigrationResult,
} from "./sessionMigration"

export interface OpenCodeSession {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string
  mode: string
  cliSessionId?: string
  /** True when the local session was created offline and has not yet been linked to a server session. */
  pendingServerLink?: boolean
  /** True when the session was imported from the server and its messages have not yet been backfilled. */
  needsBackfill?: boolean
  archived?: boolean
  messages: ChatMessage[]
  cost: number
  tokenUsage: { prompt: number; completion: number; total: number }
}

export interface CreateSessionOptions {
  /** Pre-resolved server session id. When set, used as the local map key. */
  id?: string
  /** Pre-resolved server session id to record on the entry (defaults to `id`). */
  cliSessionId?: string
  /** Mark the session as needing a server link on next connect. */
  pendingServerLink?: boolean
}

export type ServerSessionForImport = ServerSessionSnapshot

export interface SessionChangeEvent {
  kind: "deleted" | "renamed" | "active_changed" | "archived" | "unarchived"
  sessionId: string
  name?: string
}

export interface ClearSessionsPreview {
  empty: number
  testNamed: number
  orphanedExtensionOnly: number
  orphanedServerOnly: number
  archived: number
  corrupted: number
  totalRemovable: number
  retainedReal: number
  backupPath?: string
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

  private _onDidChangeSession = new vscode.EventEmitter<SessionChangeEvent>()
  readonly onDidChangeSession = this._onDidChangeSession.event

  private _onSessionCreated = new vscode.EventEmitter<string>()
  /** Fires after a brand-new session is created (not on import or migration). */
  readonly onSessionCreated = this._onSessionCreated.event

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
      // Skip sessions with no messages — empty sessions serve no purpose
      // on restore (they were never interacted with). Imported server
      // sessions and pending-link sessions are exempt: they are intentionally
      // empty until backfill or first prompt.
      const msgCount = Array.isArray(sess.messages) ? sess.messages.length : 0
      const exempt = sess.needsBackfill === true || sess.pendingServerLink === true
      if (msgCount === 0 && !exempt) {
        log.info(`Skipping empty session on load: ${id}`)
        continue
      }
      this.sessions.set(id, sess as unknown as OpenCodeSession)
    }
    // Run the one-shot id-unification migration on load. Idempotent.
    this.migrateLocalIdsToServerIds()
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
        // Persist sessions with messages, the active session, sessions awaiting
        // server backfill, and offline-created sessions awaiting promotion.
        const exempt = sess.needsBackfill === true || sess.pendingServerLink === true
        if (sess.messages.length > 0 || id === this.activeSessionId || exempt) {
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
      const exempt = sess.needsBackfill === true || sess.pendingServerLink === true
      if (sess.messages.length === 0 && (now - sess.lastActiveAt) > ONE_HOUR && id !== this.activeSessionId && !exempt) {
        staleIds.push(id)
      }
    }
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.sessions.delete(id)
      }
      log.info(`Pruned ${staleIds.length} stale empty sessions`)
    }
    if (this.sessions.size > SessionStore.MAX_SESSIONS) {
      const sorted = Array.from(this.sessions.values()).sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      for (const oldest of sorted) {
        if (this.sessions.size <= SessionStore.MAX_SESSIONS) break
        if (oldest.id !== this.activeSessionId) {
          this.sessions.delete(oldest.id)
        }
      }
    }
  }

  private fireChangeEvent(event: SessionChangeEvent): void {
    this._onDidChangeSession.fire(event)
  }

  archive(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.archived = true
    session.lastActiveAt = Date.now()
    this.save()
    this._onSessionsChanged.fire()
    this.fireChangeEvent({ kind: "archived", sessionId: id })
    return true
  }

  unarchive(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.archived = false
    session.lastActiveAt = Date.now()
    this.save()
    this._onSessionsChanged.fire()
    this.fireChangeEvent({ kind: "unarchived", sessionId: id })
    return true
  }

  /**
   * Preview or execute clearing of test/empty sessions.
   * dryRun=true returns counts without deleting.
   * Never deletes active streaming sessions.
   * Creates a JSON backup of removed sessions before deletion.
   */
  clearAll(dryRun: boolean, streamingIds?: Set<string>): ClearSessionsPreview {
    const preview: ClearSessionsPreview = {
      empty: 0,
      testNamed: 0,
      orphanedExtensionOnly: 0,
      orphanedServerOnly: 0,
      archived: 0,
      corrupted: 0,
      totalRemovable: 0,
      retainedReal: 0,
    }

    const activeStreaming = streamingIds || new Set<string>()
    const removed: Array<{ id: string; name: string; messages: number }> = []

    for (const [id, sess] of this.sessions) {
      if (activeStreaming.has(id)) {
        preview.retainedReal++
        continue
      }

      // Check for corrupted entries (missing required fields)
      const isCorrupted = typeof sess.name !== "string" || typeof sess.createdAt !== "number"
      if (isCorrupted) {
        preview.corrupted++
        preview.totalRemovable++
        if (!dryRun) {
          removed.push({ id, name: sess.name || "(corrupted)", messages: sess.messages?.length || 0 })
          this.sessions.delete(id)
        }
        continue
      }

      const isEmpty = sess.messages.length === 0
      const isTestNamed = !isEmpty && (sess.name === "Default" || sess.name.startsWith("Session ") || sess.name.startsWith("New session") || sess.name.startsWith("Tab session"))
      const isOrphaned = !sess.cliSessionId
      const isArchived = sess.archived === true

      if (isArchived) {
        preview.archived++
        preview.totalRemovable++
        if (!dryRun) {
          removed.push({ id, name: sess.name, messages: sess.messages.length })
          this.sessions.delete(id)
        }
      } else if (isEmpty) {
        preview.empty++
        preview.totalRemovable++
        if (!dryRun) {
          removed.push({ id, name: sess.name, messages: 0 })
          this.sessions.delete(id)
        }
      } else if (isTestNamed) {
        preview.testNamed++
        preview.totalRemovable++
        if (!dryRun) {
          removed.push({ id, name: sess.name, messages: sess.messages.length })
          this.sessions.delete(id)
        }
      } else if (isOrphaned) {
        preview.orphanedExtensionOnly++
        preview.totalRemovable++
        if (!dryRun) {
          removed.push({ id, name: sess.name, messages: sess.messages.length })
          this.sessions.delete(id)
        }
      } else {
        preview.retainedReal++
      }
    }

    if (!dryRun) {
      // Create a JSON backup log of removed sessions
      if (removed.length > 0) {
        try {
          const backupEntry = JSON.stringify({
            timestamp: Date.now(),
            removed,
            preview,
          })
          log.info(`Session cleanup backup: ${backupEntry}`)
        } catch (err) {
          log.warn("Failed to create cleanup backup log", err)
        }
      }

      if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
        this.activeSessionId = ""
        const remaining = this.list()
        if (remaining.length > 0) {
          this.setActive(remaining[0]!.id)
        }
      }
      this.save()
      log.info(`Cleared ${preview.totalRemovable} session(s) (empty=${preview.empty}, test=${preview.testNamed}, archived=${preview.archived}, corrupted=${preview.corrupted}, orphaned=${preview.orphanedExtensionOnly})`)
    }

    return preview
  }

  /** Alias — returns list of unarchived sessions sorted by lastActiveAt desc. */
  listActive(): OpenCodeSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => !s.archived)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  create(name?: string, opts?: CreateSessionOptions | string): OpenCodeSession {
    // Backwards compat: legacy callers passed (name, id: string).
    const options: CreateSessionOptions = typeof opts === "string" ? { id: opts } : (opts ?? {})
    const sessionId = options.id || crypto.randomUUID()
    const cliSessionId = options.cliSessionId ?? options.id
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
    if (cliSessionId) session.cliSessionId = cliSessionId
    if (options.pendingServerLink) session.pendingServerLink = true
    this.sessions.set(sessionId, session)
    this.activeSessionId = sessionId
    this.save()
    this._onSessionsChanged.fire()
    this._onActiveSessionChanged.fire(sessionId)
    this._onSessionCreated.fire(sessionId)
    return session
  }

  /**
   * Import server-side session snapshots that the extension does not already
   * know about. Returns counts of newly imported and skipped (already-known)
   * entries. Imported entries are marked `needsBackfill: true` so the caller
   * can lazily fetch full message history on first activation.
   *
   * Idempotent.
   */
  importServerSessions(serverSessions: readonly ServerSessionForImport[]): ImportResult {
    const result = mergeServerSessionsPure(this.sessions as unknown as Map<string, MigratableSession>, serverSessions)
    if (result.imported > 0) {
      this.save()
      this._onSessionsChanged.fire()
      log.info(`Imported ${result.imported} server session(s) (skipped ${result.skipped} already-known)`)
    }
    return result
  }

  /**
   * One-shot migrator: rekey local sessions whose `cliSessionId` is set so
   * that the map key matches the server-issued ID. Idempotent.
   */
  migrateLocalIdsToServerIds(): MigrationResult {
    const result = migrateLocalIdsToServerIdsPure(this.sessions as unknown as Map<string, MigratableSession>)
    if (result.rekeyed > 0) {
      // If the active session was rekeyed, follow it.
      const active = this.sessions.get(this.activeSessionId)
      if (!active) {
        // The active id may have been rekeyed; find the entry whose new id replaced it.
        for (const [newId, sess] of this.sessions) {
          if (sess.cliSessionId === this.activeSessionId) {
            this.activeSessionId = newId
            break
          }
        }
      }
      this.save()
      this._onSessionsChanged.fire()
      log.info(`Migrated ${result.rekeyed} local session id(s) to server ids`)
    }
    return result
  }

  /**
   * Promote a pendingServerLink session to be keyed by a real server id.
   * Returns false when source is missing or target id is already in use.
   */
  promotePendingServerLink(fromId: string, serverId: string): boolean {
    const ok = promotePendingServerLinkPure(this.sessions as unknown as Map<string, MigratableSession>, fromId, serverId)
    if (ok) {
      if (this.activeSessionId === fromId) {
        this.activeSessionId = serverId
        this._onActiveSessionChanged.fire(serverId)
      }
      this.save()
      this._onSessionsChanged.fire()
      log.info(`Promoted pendingServerLink ${fromId} → ${serverId}`)
    }
    return ok
  }

  /**
   * Replace the message list of an imported session and clear `needsBackfill`.
   * Used after fetching full history from the server for a session that was
   * imported via `importServerSessions`.
   */
  applyBackfilledMessages(id: string, messages: ChatMessage[]): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.messages = messages
    delete session.needsBackfill
    this.save()
    this._onSessionsChanged.fire()
    return true
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

  list(includeArchived = false): OpenCodeSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => includeArchived || !s.archived)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  setActive(id: string): OpenCodeSession | undefined {
    const session = this.sessions.get(id)
    if (session) {
      this.activeSessionId = id
      this._onActiveSessionChanged.fire(id)
      this.fireChangeEvent({ kind: "active_changed", sessionId: id })
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
    this.fireChangeEvent({ kind: "renamed", sessionId: id, name: name.trim() })
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
    this.fireChangeEvent({ kind: "deleted", sessionId: id })
  }

  dispose(): void {
    this.flush()
    this._onSessionsChanged.dispose()
    this._onActiveSessionChanged.dispose()
    this._onDidChangeSession.dispose()
    this._onSessionCreated.dispose()
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
