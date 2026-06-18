export interface SessionData {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  messages: unknown[]
  cost: number
  tokenUsage: { prompt: number; completion: number; total: number }
  contextUsage?: {
    percent: number
    tokens: number
    maxTokens: number
    source?: "estimated" | "actual"
    updatedAt?: number
    breakdown?: {
      system: number
      history: number
      workspace: number
      queued?: number
      steer?: number
    }
    projected?: { withQueue: number; overflow: boolean }
    cost?: number
  }
  model?: string
  mode?: string
  cliSessionId?: string
  pendingServerLink?: boolean
  needsBackfill?: boolean
  workspacePath?: string
  archived?: boolean
  changedFiles?: string[]
  variant?: string
}

export interface CreateSessionParams {
  name?: string
  id?: string
  cliSessionId?: string
  pendingServerLink?: boolean
}

export function isLocalPlaceholderSessionId(id: string | undefined): boolean {
  return typeof id === "string" && /^session-[0-9a-f]{8}$/i.test(id)
}

export function buildSession(params: CreateSessionParams): SessionData {
  const sessionId = params.id || crypto.randomUUID()
  const cliSessionId = params.pendingServerLink ? params.cliSessionId : (params.cliSessionId ?? params.id)
  const now = Date.now()
  const session: SessionData = {
    id: sessionId,
    name: params.name?.trim() || "",
    createdAt: now,
    lastActiveAt: now,
    model: "",
    mode: "build",
    messages: [],
    cost: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
  }
  if (cliSessionId) session.cliSessionId = cliSessionId
  if (params.pendingServerLink) session.pendingServerLink = true
  return session
}

export function isValidSession(sess: Record<string, unknown> | null | undefined): boolean {
  if (!sess || typeof sess !== "object") return false
  return (
    typeof sess.id === "string" &&
    typeof sess.name === "string" &&
    typeof sess.createdAt === "number" &&
    Array.isArray(sess.messages)
  )
}

export function sessionDisplayName(session?: { name?: string }): string {
  const raw = (session?.name || "").trim()
  if (isAutoSessionName(raw)) return "Untitled session"
  return raw
}

export function isAutoSessionName(name?: string): boolean {
  const raw = (name || "").trim()
  return (
    !raw ||
    raw === "Default" ||
    raw === "New Chat" ||
    raw === "New Session" ||
    raw === "Untitled session" ||
    /^Session [A-Za-z0-9]{1,8}$/.test(raw) ||
    /^Session \d+$/.test(raw) ||
    /^New session\b/i.test(raw) ||
    /^Tab session\b/i.test(raw)
  )
}

export function validateSessionName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "Session name cannot be empty."
  if (trimmed.length > 80) return "Session name must be 80 characters or fewer."
  if (/[\\/:*?"<>|]/.test(trimmed)) return "Session name cannot contain path separator characters."
  return null
}

import { extractTitle, dedupeTitle, dedupeTitleAgainst } from "./titleExtractor"

export { extractTitle, dedupeTitle, dedupeTitleAgainst }

/**
 * Generate a session title from the first user message.
 *
 * Delegates to the shared `extractTitle` pure module (used by both host and
 * webview). Kept for backwards compatibility — existing callers (host-side
 * `SessionStore.autoTitleFromMessages`, structural tests) continue to work;
 * new code should call `extractTitle` directly.
 */
export function generateTitleFromMessage(text: string): string {
  return extractTitle(text)
}

export type SessionClassification = "corrupted" | "archived" | "empty" | "test_named" | "orphaned" | "real"

export function classifySession(session: {
  name?: string
  createdAt?: number
  messages: unknown[]
  cliSessionId?: string
  archived?: boolean
}): SessionClassification {
  if (typeof session.name !== "string" || typeof session.createdAt !== "number") return "corrupted"
  if (session.archived) return "archived"
  if (session.messages.length === 0) return "empty"
  const name = session.name
  if (isAutoSessionName(name)) return "test_named"
  if (!session.cliSessionId) return "orphaned"
  return "real"
}

/**
 * Build the object handed to globalState.update() on flush. Two jobs:
 *
 * 1. The existing flush contract: persist sessions with messages, plus
 *    server-imported sessions awaiting backfill; empty local placeholder
 *    tabs are transient by design.
 * 2. Bound the persisted transcript per session. flush() runs on a 500ms
 *    debounce during streaming, and VS Code JSON-serializes the WHOLE value
 *    (then writes it to the state DB) on every update — so the per-flush
 *    cost must scale with this bound, never with total store size. The
 *    in-memory store keeps the full transcript; the server remains the
 *    source of truth for full history (resume/backfill re-fetch it).
 *
 * Pure; never mutates the live sessions (capped entries are shallow copies).
 */
export function buildPersistedSessions<T extends { messages: unknown[]; needsBackfill?: boolean }>(
  sessions: Iterable<[string, T]>,
  maxMessagesPerSession: number,
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, sess] of sessions) {
    const exempt = sess.needsBackfill === true
    if (sess.messages.length === 0 && !exempt) continue
    out[id] = sess.messages.length > maxMessagesPerSession
      ? { ...sess, messages: sess.messages.slice(-maxMessagesPerSession) }
      : sess
  }
  return out
}
