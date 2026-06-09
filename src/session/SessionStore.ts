import * as vscode from "vscode"
import { type ChatMessage } from "../types"
import { log } from "../utils/outputChannel"
import {
  buildSession,
  isLocalPlaceholderSessionId,
  isValidSession as isValidSessionPure,
  isAutoSessionName,
  sessionDisplayName as sessionDisplayNamePure,
  validateSessionName as validateSessionNamePure,
  generateTitleFromMessage as generateTitleFromMessagePure,
  type SessionData,
} from "./sessionUtils"
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
  variant?: string
  mode: string
  cliSessionId?: string
  /** True when the local session was created offline and has not yet been linked to a server session. */
  pendingServerLink?: boolean
  /** True when the session was imported from the server and its messages have not yet been backfilled. */
  needsBackfill?: boolean
  archived?: boolean
  pinned?: boolean
  tags?: string[]
  messages: ChatMessage[]
  cost: number
  tokenUsage: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }
  contextUsage?: SessionContextUsage
  changedFiles?: string[]
  /** Per-file cumulative diff stats, keyed by normalized path. */
  changedFileStats?: Record<string, { added: number; removed: number }>
  workspacePath?: string
  /** ID of the session this was forked from, if any. */
  parentSessionId?: string
  /** Index of the last turn included in the fork (0-based). */
  forkedAtTurn?: number
}

export interface SessionContextBreakdown {
  system: number
  history: number
  workspace: number
  queued?: number
  steer?: number
}

export interface SessionContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  breakdown?: SessionContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
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
  kind: "deleted" | "renamed" | "active_changed" | "archived" | "unarchived" | "pinned" | "tags_changed"
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
  private emptySessionCleanupTimer: ReturnType<typeof setInterval> | null = null
  private static readonly SAVE_DEBOUNCE_MS = 500
  private static readonly MAX_SESSIONS = 50
  private static readonly ONE_HOUR = 60 * 60 * 1000
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
    this.startEmptySessionCleanup()
  }

  private isValidSession(sess: Record<string, unknown>): boolean {
    return isValidSessionPure(sess)
  }

  private load(): void {
    const raw = this.globalState.get<Record<string, Record<string, unknown>>>(STORAGE_KEY, {})
    for (const [id, sess] of Object.entries(raw)) {
      if (typeof sess !== "object" || !sess || !this.isValidSession(sess)) {
        log.warn(`Skipping invalid session entry: ${id}`)
        continue
      }
      if (!sess.mode) sess.mode = "build"
      if (typeof sess.lastActiveAt !== "number") sess.lastActiveAt = Date.now()
      if (typeof sess.model !== "string") sess.model = ""
      if (typeof sess.cost !== "number") sess.cost = 0
      if (typeof sess.tokenUsage !== "object") sess.tokenUsage = { prompt: 0, completion: 0, total: 0 }
      if (sess.contextUsage && !SessionStore.isValidContextUsage(sess.contextUsage)) {
        delete sess.contextUsage
      }
      // Skip sessions with no messages — empty sessions serve no purpose
      // on restore (they were never interacted with). Imported server
      // sessions are exempt: they are intentionally empty until backfill.
      const msgCount = Array.isArray(sess.messages) ? sess.messages.length : 0
      const exempt = sess.needsBackfill === true
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
        // Persist sessions with messages and server-imported sessions awaiting
        // backfill. Empty local placeholder tabs are intentionally transient so
        // an unused "New session" click does not survive reload and clutter
        // history.
        const exempt = sess.needsBackfill === true
        if (sess.messages.length > 0 || exempt) {
          obj[id] = sess
        }
      }
      await this.globalState.update(STORAGE_KEY, obj)
    } catch (err) {
      log.error("Failed to save sessions to globalState", err)
    }
  }

  private pruneStaleSessions(): void {
    this.pruneEmptySessions()
    if (this.sessions.size <= SessionStore.MAX_SESSIONS) return
    const sorted = Array.from(this.sessions.values()).sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    const beforePrune = this.sessions.size
    for (const oldest of sorted) {
      if (this.sessions.size <= SessionStore.MAX_SESSIONS) break
      if (oldest.id !== this.activeSessionId) {
        this.sessions.delete(oldest.id)
      }
    }
    if (this.sessions.size < beforePrune) {
      this.save()
    }
  }

  private getEmptySessionTtlMinutes(): number {
    const defaultMinutes = SessionStore.ONE_HOUR / 60 / 1000
    const configured = vscode.workspace.getConfiguration("opencode").get<number>("sessions.emptySessionTtlMinutes", defaultMinutes)
    return Math.max(1, Number.isFinite(configured) ? configured : defaultMinutes)
  }

  private getCleanupIntervalMinutes(): number {
    const configured = vscode.workspace.getConfiguration("opencode").get<number>("sessions.cleanupIntervalMinutes", 15)
    return Math.max(1, Number.isFinite(configured) ? configured : 15)
  }

  private startEmptySessionCleanup(): void {
    const intervalMs = this.getCleanupIntervalMinutes() * 60 * 1000
    this.emptySessionCleanupTimer = setInterval(() => {
      const removed = this.pruneEmptySessions()
      if (removed > 0) {
        this.save()
        this._onSessionsChanged.fire()
      }
    }, intervalMs)
    this.emptySessionCleanupTimer.unref?.()
  }

  pruneEmptySessions(ttlMinutes = this.getEmptySessionTtlMinutes()): number {
    const now = Date.now()
    const ttlMs = Math.max(1, ttlMinutes) * 60 * 1000
    const staleIds: string[] = []
    for (const [id, sess] of this.sessions) {
      const exempt = sess.needsBackfill === true
      if (sess.messages.length === 0 && (now - sess.lastActiveAt) > ttlMs && id !== this.activeSessionId && !exempt) {
        staleIds.push(id)
      }
    }
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.sessions.delete(id)
      }
      log.info(`Pruned ${staleIds.length} stale empty sessions`)
    }
    return staleIds.length
  }

  deleteIfEmpty(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    const exempt = session.needsBackfill === true
    if (session.messages.length > 0 || exempt) return false
    this.delete(id)
    return true
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

  setPinned(id: string, pinned: boolean): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.pinned = pinned
    session.lastActiveAt = Date.now()
    this.save()
    this._onSessionsChanged.fire()
    this.fireChangeEvent({ kind: "pinned", sessionId: id })
    return true
  }

  setTags(id: string, tags: readonly string[]): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.tags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
    session.lastActiveAt = Date.now()
    this.save()
    this._onSessionsChanged.fire()
    this.fireChangeEvent({ kind: "tags_changed", sessionId: id })
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
    const options: CreateSessionOptions = typeof opts === "string" ? { id: opts } : (opts ?? {})
    const data: SessionData = buildSession({ name, ...options })
    const session: OpenCodeSession = data as unknown as OpenCodeSession
    // Stamp the current workspace so the session shows up in this project's
    // picker on subsequent reloads (mirrors opencode CLI's directory scoping).
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      session.workspacePath = folders[0]!.uri.fsPath
    }
    this.sessions.set(session.id, session)
    this.activeSessionId = session.id
    this.save()
    this._onSessionsChanged.fire()
    this._onActiveSessionChanged.fire(session.id)
    this._onSessionCreated.fire(session.id)
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

    // Prune orphaned imported sessions: any local entry that was previously
    // imported (`needsBackfill`) but is no longer present in the server's
    // top-level session list is either deleted server-side or was a subagent
    // session imported before the filter existed. Either way, it should not
    // linger in the picker.
    const visibleServerIds = new Set(serverSessions.map((s) => s.id))
    let pruned = 0
    for (const [id, sess] of this.sessions) {
      if (sess.needsBackfill === true && !visibleServerIds.has(id)) {
        this.sessions.delete(id)
        pruned++
      }
    }

    if (result.imported > 0 || pruned > 0) {
      this.save()
      this._onSessionsChanged.fire()
      log.info(`Imported ${result.imported} server session(s), pruned ${pruned} orphan(s), skipped ${result.skipped} already-known`)
    }
    return result
  }

  /**
   * Import a single server session on demand — used when the user clicks a
   * server session in the unified modal that has no local counterpart yet.
   *
   * Returns the existing local session if one with the same `cliSessionId`
   * already exists (idempotent). Otherwise creates a new local entry marked
   * `needsBackfill: true` so `handleResumeSession` will fetch the transcript.
   *
   * Unlike `create()`, this method uses the server session's `directory` as
   * `workspacePath` rather than the current VS Code workspace folder — the
   * session belongs to that project and should be scoped to it.
   */
  importOneServerSession(serverId: string, title?: string, directory?: string): OpenCodeSession {
    // Prefer an existing entry keyed by the server id or whose cliSessionId matches.
    const existing =
      this.sessions.get(serverId) ??
      Array.from(this.sessions.values()).find((s) => s.cliSessionId === serverId)
    if (existing) return existing

    const now = Date.now()
    const session: OpenCodeSession = {
      id: serverId,
      name: title?.trim() || "",
      createdAt: now,
      lastActiveAt: now,
      model: "",
      mode: "build",
      messages: [],
      cost: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      cliSessionId: serverId,
      needsBackfill: true,
      workspacePath: directory,
    }
    this.sessions.set(serverId, session)
    this.save()
    this._onSessionsChanged.fire()
    return session
  }

  /**
   * One-shot migrator: rekey local sessions whose `cliSessionId` is set so
   * that the map key matches the server-issued ID. Idempotent.
   */
  migrateLocalIdsToServerIds(): MigrationResult {
    const result = migrateLocalIdsToServerIdsPure(this.sessions as unknown as Map<string, MigratableSession>)
    if (result.rekeyed > 0 || result.merged > 0) {
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
      log.info(`Migrated ${result.rekeyed} local session id(s) to server ids, merged ${result.merged} duplicate link(s)`)
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
  applyBackfilledMessages(id: string, messages: ChatMessage[], usage?: { cost: number; tokenUsage: OpenCodeSession["tokenUsage"] }): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.messages = messages
    if (usage) {
      session.cost = usage.cost
      session.tokenUsage = usage.tokenUsage
    }
    delete session.needsBackfill
    this.save()
    this._onSessionsChanged.fire()
    return true
  }

  /**
   * Clear the `needsBackfill` flag without touching messages. Called when
   * repeated backfill attempts return empty — the session is treated as
   * genuinely empty on the server, so we stop retrying and stop logging.
   */
  clearNeedsBackfill(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session || !session.needsBackfill) return false
    delete session.needsBackfill
    this.save()
    return true
  }

  ensure(id: string, name?: string, model?: string, mode?: string): OpenCodeSession {
    const existing = this.sessions.get(id)
    if (existing) {
      // Only overwrite name with a non-empty value — passing "" means the
      // caller has no real title to set, not "clear the title".
      if (typeof name === "string" && name.trim() && existing.name !== name) existing.name = name
      if (model !== undefined && existing.model !== model) existing.model = model
      if (mode !== undefined && existing.mode !== mode) existing.mode = mode === "normal" ? "build" : mode
      existing.lastActiveAt = Date.now()
      this.save()
      this._onSessionsChanged.fire()
      return existing
    }

    const session = this.create(name, isLocalPlaceholderSessionId(id) ? { id, pendingServerLink: true } : id)
    // Set model/mode before persisting — create() already called save(),
    // but these fields weren't set yet. Single follow-up save is needed.
    let needsSave = false
    if (model !== undefined) { session.model = model; needsSave = true }
    if (mode !== undefined) { session.mode = mode === "normal" ? "build" : (mode || "build"); needsSave = true }
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

  clearActive(): void {
    if (!this.activeSessionId) return
    this.activeSessionId = ""
    this._onActiveSessionChanged.fire("")
    this.fireChangeEvent({ kind: "active_changed", sessionId: "" })
  }

  appendMessage(sessionId: string, msg: ChatMessage): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.messages.push(msg)
    session.lastActiveAt = Date.now()

    // Auto-generate title from first user message when no real title exists.
    const isAutoName = isAutoSessionName(session.name)
    if (msg.role === "user" && isAutoName) {
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
   * Mark a question block as answered so the transcript renders the answered
   * record and a reload doesn't re-prompt. Matches by toolCallId within the
   * session's messages. Returns true when a block was found and updated.
   */
  markQuestionAnswered(
    sessionId: string,
    toolCallId: string,
    answer: string,
    source: "option" | "freetext" | "skip" | "response",
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    for (const msg of session.messages) {
      for (const block of msg.blocks) {
        const b = block as Record<string, unknown>
        if (b.type !== "question" || b.answered === true) continue
        if (b.toolCallId !== toolCallId && b.id !== toolCallId) continue
        b.answered = true
        b.answer = answer
        b.answerSource = source
        session.lastActiveAt = Date.now()
        this.save()
        this._onSessionsChanged.fire()
        return true
      }
    }
    return false
  }


  /**
   * Public-facing display name for a session. Empty/auto-generated names
   * fall back to "Untitled session" so we never leak internals like
   * "Session owSyH" into the UI.
   */
  static displayName(session: { name?: string }): string {
    return sessionDisplayNamePure(session)
  }

  /**
   * Promote an empty / auto-generated name to one derived from the first
   * user message, mirroring opencode's server-side titling. Returns true
   * when the name was changed.
   */
  autoTitleFromMessages(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    if (!isAutoSessionName(session.name)) return false
    const firstUser = session.messages.find((m) => m.role === "user")
    if (!firstUser) return false
    const textBlock = firstUser.blocks.find((b) => b.type === "text")
    const text = typeof textBlock?.text === "string" ? textBlock.text : ""
    const generated = this.generateTitleFromMessage(text)
    if (!generated) return false
    session.name = generated
    this.save()
    this._onSessionsChanged.fire()
    return true
  }

  /**
   * Generate a session title from the first user message.
   * Uses the first sentence truncated at 40 chars.
   */
generateTitleFromMessage(text: string): string {
    return generateTitleFromMessagePure(text)
  }

  /**
   * Validate a session rename.
   * Returns an error message if invalid, or null if valid.
   */
validateSessionName(name: string): string | null {
    return validateSessionNamePure(name)
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

  /**
   * Server-side title updater. Wired by the extension host on startup; tests
   * inject a fake. Returning a promise lets us optionally await the server
   * roundtrip; current call sites fire-and-forget so a slow server doesn't
   * stall UI.
   *
   * Spec: ADR-008 §5.4 (bidirectional session title sync).
   */
  private serverTitleUpdater: ((cliSessionId: string, title: string) => Promise<void>) | null = null
  setServerTitleUpdater(updater: (cliSessionId: string, title: string) => Promise<void>): void {
    this.serverTitleUpdater = updater
  }

  /**
   * Canonical, SDK-aligned setter for session title. Persists locally
   * (mirroring `name` for now until Layer 6b renames the field everywhere)
   * and propagates to the SDK server via the injected updater so the title
   * appears in CLI and sibling windows.
   *
   * Returns false when the title fails validation (empty / oversize); local
   * state is untouched in that case and the server is not called.
   */
  setTitle(id: string, title: string): boolean {
    const trimmed = title.trim()
    const validationError = this.validateSessionName(trimmed)
    if (validationError) {
      log.warn(`Invalid session title: ${validationError}`)
      return false
    }
    const session = this.sessions.get(id)
    if (!session) return false
    session.name = trimmed
    this.save()
    this._onSessionsChanged.fire()
    this.fireChangeEvent({ kind: "renamed", sessionId: id, name: trimmed })

    // Best-effort server propagation. Skip when no cliSessionId yet (local-
    // only sessions; server learns the title on first prompt).
    const serverId = session.cliSessionId || (!isLocalPlaceholderSessionId(session.id) ? session.id : undefined)
    if (this.serverTitleUpdater && serverId) {
      void this.serverTitleUpdater(serverId, trimmed).catch(err =>
        log.warn(`Failed to propagate session title to server for ${id}: ${(err as Error).message}`),
      )
    }
    return true
  }

  /**
   * Apply a title received from the server (`session.updated` SSE event).
   * Looks the local session up by cliSessionId. No-op when unknown. Does
   * NOT re-call `serverTitleUpdater` (avoid feedback loop).
   */
  applyServerTitle(cliSessionId: string, title: string): boolean {
    const trimmed = title.trim()
    if (!trimmed) return false
    for (const session of this.sessions.values()) {
      if (session.cliSessionId === cliSessionId || session.id === cliSessionId) {
        if (session.name === trimmed) return false
        session.name = trimmed
        this.save()
        this._onSessionsChanged.fire()
        this.fireChangeEvent({ kind: "renamed", sessionId: session.id, name: trimmed })
        return true
      }
    }
    return false
  }

  updateCliSessionId(id: string, cliId: string): void {
    // Validate: prevent duplicate cliSessionId across sessions (one-to-one mapping)
    for (const [otherId, otherSess] of this.sessions) {
      if (otherId !== id && otherSess.cliSessionId === cliId) {
        log.warn(`Duplicate cliSessionId ${cliId} detected on sessions ${otherId} and ${id} - clearing old mapping`)
        otherSess.cliSessionId = undefined
      }
    }
    const session = this.sessions.get(id)
    if (!session) return
    session.cliSessionId = cliId
    delete session.pendingServerLink
    this.save()
  }

  /**
   * Get all sessions as an array
   */
  getAllSessions(): OpenCodeSession[] {
    return Array.from(this.sessions.values())
  }
  
  /** Update the model associated with a specific session. */
  updateModel(id: string, model: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.model = model
    this.save()
  }

  updateVariant(id: string, variant: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.variant = variant
    this.save()
  }

  updateMode(id: string, mode: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.mode = mode === "normal" ? "build" : mode
    this.save()
  }

  updateCost(id: string, cost: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.cost = cost
    session.lastActiveAt = Date.now()
    this.save()
  }

  accumulateCost(id: string, costDelta: number): void {
    if (!Number.isFinite(costDelta) || costDelta <= 0) return
    const session = this.sessions.get(id)
    if (!session) return
    if (session.cost === undefined) session.cost = 0
    const result = session.cost + costDelta
    session.cost = Number.isFinite(result) ? result : session.cost
    session.lastActiveAt = Date.now()
    this.save()
  }

  accumulateTokenUsage(id: string, delta: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }): void {
    if (!Number.isFinite(delta.prompt) || !Number.isFinite(delta.completion)) return
    const session = this.sessions.get(id)
    if (!session) return
    if (!session.tokenUsage) {
      session.tokenUsage = { prompt: 0, completion: 0, total: 0 }
    }
    const safe = (cur: number, d: number) => Number.isFinite(cur + d) ? cur + d : cur
    const deltaTotal = Number.isFinite(delta.total)
      ? delta.total
      : delta.prompt + delta.completion + (delta.reasoning ?? 0) + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0)
    session.tokenUsage.prompt = safe(session.tokenUsage.prompt, delta.prompt)
    session.tokenUsage.completion = safe(session.tokenUsage.completion, delta.completion)
    session.tokenUsage.total = safe(session.tokenUsage.total, deltaTotal)
    if (delta.reasoning && Number.isFinite(delta.reasoning)) session.tokenUsage.reasoning = safe(session.tokenUsage.reasoning ?? 0, delta.reasoning)
    if (delta.cacheRead && Number.isFinite(delta.cacheRead)) session.tokenUsage.cacheRead = safe(session.tokenUsage.cacheRead ?? 0, delta.cacheRead)
    if (delta.cacheWrite && Number.isFinite(delta.cacheWrite)) session.tokenUsage.cacheWrite = safe(session.tokenUsage.cacheWrite ?? 0, delta.cacheWrite)
    session.lastActiveAt = Date.now()
    this.save()
  }

  updateTokenUsage(id: string, usage: OpenCodeSession["tokenUsage"]): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.tokenUsage = usage
    session.lastActiveAt = Date.now()
    this.save()
  }

  getContextUsage(id: string): SessionContextUsage | undefined {
    const usage = this.sessions.get(id)?.contextUsage
    return usage ? SessionStore.cloneContextUsage(usage) : undefined
  }

  updateContextUsage(id: string, usage: SessionContextUsage): boolean {
    const session = this.sessions.get(id)
    if (!session) return false

    const merged = SessionStore.mergeContextUsage(session.contextUsage, usage)
    if (!merged) {
      log.debug(`Ignored empty context usage update for ${id}; keeping previous value`)
      return false
    }
    const previous = session.contextUsage
    if (previous && SessionStore.contextUsageEquals(previous, merged)) {
      return true
    }

    session.contextUsage = merged
    session.lastActiveAt = Date.now()
    this.save()
    log.debug(`Persisted context usage for ${id}: ${merged.tokens}/${merged.maxTokens} (${merged.percent}%, ${merged.source ?? "estimated"})`)
    return true
  }

  private static mergeContextUsage(existing: SessionContextUsage | undefined, incoming: SessionContextUsage): SessionContextUsage | undefined {
    if (!SessionStore.isValidContextUsage(incoming)) {
      return existing ? SessionStore.cloneContextUsage(existing) : undefined
    }

    const normalized = SessionStore.normalizeContextUsage(incoming)
    const incomingIsEmpty = normalized.tokens <= 0 && normalized.percent <= 0
    const existingHasFill = existing !== undefined && (existing.tokens > 0 || existing.percent > 0)
    if (incomingIsEmpty && existingHasFill) {
      return SessionStore.cloneContextUsage(existing)
    }

    if (existing) {
      const existingTime = existing.updatedAt ?? 0
      const incomingTime = normalized.updatedAt ?? 0
      const incomingOlder = incomingTime > 0 && existingTime > 0 && incomingTime < existingTime
      const wouldDowngradeActual = existing.source === "actual" && normalized.source === "estimated" && incomingOlder
      if (incomingOlder || wouldDowngradeActual) {
        return SessionStore.cloneContextUsage(existing)
      }
    }

    return normalized
  }

  private static isValidContextUsage(value: unknown): value is SessionContextUsage {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<SessionContextUsage>
    return (
      typeof candidate.percent === "number" &&
      Number.isFinite(candidate.percent) &&
      typeof candidate.tokens === "number" &&
      Number.isFinite(candidate.tokens) &&
      typeof candidate.maxTokens === "number" &&
      Number.isFinite(candidate.maxTokens)
    )
  }

  private static normalizeContextUsage(usage: SessionContextUsage): SessionContextUsage {
    const safeTokens = Math.max(0, usage.tokens)
    const safeMaxTokens = Math.max(0, usage.maxTokens)
    const computedPercent = safeMaxTokens > 0 ? (safeTokens / safeMaxTokens) * 100 : usage.percent
    const safePercent = Number.isFinite(usage.percent) && usage.percent > 0
      ? usage.percent
      : computedPercent
    const normalized: SessionContextUsage = {
      percent: Math.min(100, Math.max(0, Number.isFinite(safePercent) ? safePercent : 0)),
      tokens: safeTokens,
      maxTokens: safeMaxTokens,
      updatedAt: Number.isFinite(usage.updatedAt ?? NaN) ? usage.updatedAt : Date.now(),
      source: usage.source === "actual" ? "actual" : "estimated",
    }
    if (usage.breakdown) normalized.breakdown = { ...usage.breakdown }
    if (usage.projected) normalized.projected = { ...usage.projected }
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) normalized.cost = usage.cost
    return normalized
  }

  private static cloneContextUsage(usage: SessionContextUsage): SessionContextUsage {
    return {
      ...usage,
      breakdown: usage.breakdown ? { ...usage.breakdown } : undefined,
      projected: usage.projected ? { ...usage.projected } : undefined,
    }
  }

  private static contextUsageEquals(a: SessionContextUsage, b: SessionContextUsage): boolean {
    return JSON.stringify(SessionStore.cloneContextUsage(a)) === JSON.stringify(SessionStore.cloneContextUsage(b))
  }

  private normalizeChangedFilePath(filePath: string): string | undefined {
    const normalized = filePath.trim().replace(/\\/g, "/")
    return normalized.length > 0 ? normalized : undefined
  }

  /**
   * Track changed files for a session.
   */
  addChangedFiles(
    id: string,
    files: string[],
    stats?: Array<{ path: string; added: number; removed: number }>,
  ): void {
    const session = this.sessions.get(id)
    if (!session) return

    const existing = new Set((session.changedFiles || [])
      .map((f) => this.normalizeChangedFilePath(f))
      .filter((f): f is string => Boolean(f)))
    const next = [...existing]
    for (const file of files) {
      const normalized = this.normalizeChangedFilePath(file)
      if (!normalized || existing.has(normalized)) continue
      existing.add(normalized)
      next.push(normalized)
    }

    // Persist cumulative diff stats, accumulating additions/deletions per file
    if (stats && stats.length > 0) {
      const stored = session.changedFileStats ?? {}
      for (const s of stats) {
        const key = this.normalizeChangedFilePath(s.path)
        if (!key) continue
        const prev = stored[key] ?? { added: 0, removed: 0 }
        stored[key] = {
          added: prev.added + (Number.isFinite(s.added) ? s.added : 0),
          removed: prev.removed + (Number.isFinite(s.removed) ? s.removed : 0),
        }
      }
      session.changedFileStats = stored
    }

    if (next.length !== (session.changedFiles || []).length) {
      session.changedFiles = next
    }
    this.save()
  }

  /**
   * Track changed files for a session
   */
  addChangedFile(id: string, filePath: string): void {
    this.addChangedFiles(id, [filePath])
  }

  getChangedFileStats(id: string): Record<string, { added: number; removed: number }> {
    return this.sessions.get(id)?.changedFileStats ?? {}
  }

  /**
   * Get changed files for a session
   */
  getChangedFiles(id: string): string[] {
    const session = this.sessions.get(id)
    return session?.changedFiles || []
  }

  /** 
   * Clear changed files tracking
   */
  clearChangedFiles(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.changedFiles = []
      session.changedFileStats = {}
      this.save()
    }
  }

  /** 
   * Get sessions filtered by workspace folder
   */
  getSessionsByWorkspace(workspacePath?: string): OpenCodeSession[] {
    const all = this.list()
    if (!workspacePath) return all
    return all.filter(s => s.workspacePath === workspacePath)
  }

  /**
   * Set workspace path for a session
   */
  setWorkspacePath(id: string, workspacePath: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.workspacePath = workspacePath
      this.save()
    }
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
    if (this.emptySessionCleanupTimer) {
      clearInterval(this.emptySessionCleanupTimer)
      this.emptySessionCleanupTimer = null
    }
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

  /**
   * Fork a session at a specific turn index. The new session contains messages
   * [0..atTurn] (inclusive) from the source, is marked with `parentSessionId`
   * and `forkedAtTurn`, and starts as the active session.
   * Returns `undefined` if the source session does not exist.
   */
  forkSession(sourceId: string, atTurn: number): OpenCodeSession | undefined {
    const source = this.sessions.get(sourceId)
    if (!source) return undefined
    const clampedTurn = Math.min(Math.max(atTurn, 0), source.messages.length - 1)
    const forked: OpenCodeSession = {
      ...JSON.parse(JSON.stringify(source)),
      id: crypto.randomUUID(),
      name: `${source.name} (Fork from Turn ${clampedTurn + 1})`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: source.messages.slice(0, clampedTurn + 1),
      cliSessionId: undefined,
      pendingServerLink: true,
      parentSessionId: sourceId,
      forkedAtTurn: clampedTurn,
      cost: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      contextUsage: undefined,
    }
    this.sessions.set(forked.id, forked)
    this.activeSessionId = forked.id
    this.save()
    this._onSessionsChanged.fire()
    this._onSessionCreated.fire(forked.id)
    return forked
  }

  get activeId(): string {
    return this.activeSessionId
  }

  get count(): number {
    return this.sessions.size
  }
}
