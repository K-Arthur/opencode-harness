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

export function generateTitleFromMessage(text: string): string {
  if (!text || !text.trim()) return ""
  const firstSentence = text.split(/[.!?\n]/)[0] || text
  const trimmed = firstSentence.trim()
  if (trimmed.length === 0) return ""
  if (trimmed.length > 40) {
    return trimmed.slice(0, 37).trimEnd() + "..."
  }
  return trimmed
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
