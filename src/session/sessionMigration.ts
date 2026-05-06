/**
 * Pure migration / merge helpers for unified session identity (ADR-007).
 *
 * These functions are intentionally vscode-free so they can be unit tested
 * directly. SessionStore wraps them with persistence and event emission.
 */

export interface MigratableSession {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string
  mode: string
  cliSessionId?: string
  pendingServerLink?: boolean
  needsBackfill?: boolean
  archived?: boolean
  messages: unknown[]
  cost: number
  tokenUsage: { prompt: number; completion: number; total: number }
}

export interface ServerSessionSnapshot {
  id: string
  title?: string
  time?: { updated?: number; created?: number }
}

export interface MigrationResult {
  rekeyed: number
}

export interface ImportResult {
  imported: number
  skipped: number
}

/**
 * Rekey local sessions whose `cliSessionId` is set so that the map key
 * matches the server-issued ID. Mutates `bySessionId` in place.
 *
 * Idempotent: a session whose key already equals its `cliSessionId` is left
 * untouched.
 *
 * Conflict policy: if the target server-id is already in use by a different
 * entry, the migration is skipped for that session (non-destructive).
 */
export function migrateLocalIdsToServerIds(
  bySessionId: Map<string, MigratableSession>
): MigrationResult {
  let rekeyed = 0
  const targets: Array<{ from: string; to: string; sess: MigratableSession }> = []

  for (const [id, sess] of bySessionId) {
    if (!sess.cliSessionId) continue
    if (sess.cliSessionId === id) continue
    targets.push({ from: id, to: sess.cliSessionId, sess })
  }

  for (const { from, to, sess } of targets) {
    if (bySessionId.has(to)) continue
    bySessionId.delete(from)
    sess.id = to
    bySessionId.set(to, sess)
    rekeyed++
  }

  return { rekeyed }
}

/**
 * Merge server-side session snapshots into the local map.
 *
 * Behavior per server session:
 *  - If `bySessionId` already contains the same id: skip (local wins; the
 *    cliSessionId is reaffirmed).
 *  - Otherwise: insert a new entry keyed by the server id, marked
 *    `needsBackfill: true` so the caller can lazily fetch full message
 *    history when the session is first activated.
 *
 * Returns the count of newly imported entries and the count of skipped
 * (already-known) entries.
 */
export function mergeServerSessions(
  bySessionId: Map<string, MigratableSession>,
  serverSessions: readonly ServerSessionSnapshot[],
  now: () => number = Date.now
): ImportResult {
  let imported = 0
  let skipped = 0

  for (const srv of serverSessions) {
    if (!srv?.id) {
      skipped++
      continue
    }
    const existing = bySessionId.get(srv.id)
    if (existing) {
      // Reaffirm link; preserve local message history.
      if (!existing.cliSessionId) existing.cliSessionId = srv.id
      skipped++
      continue
    }
    const updated = srv.time?.updated ?? srv.time?.created ?? now()
    const created = srv.time?.created ?? updated
    const entry: MigratableSession = {
      id: srv.id,
      name: srv.title?.trim() || `Session ${srv.id.slice(-5)}`,
      createdAt: created,
      lastActiveAt: updated,
      model: "",
      mode: "build",
      cliSessionId: srv.id,
      needsBackfill: true,
      messages: [],
      cost: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    }
    bySessionId.set(srv.id, entry)
    imported++
  }

  return { imported, skipped }
}

/**
 * Promote a session that was created offline (pendingServerLink=true) to be
 * keyed by a real server id. Mutates `bySessionId` in place.
 *
 * Returns false if the source is missing or the target id is already in use.
 */
export function promotePendingServerLink(
  bySessionId: Map<string, MigratableSession>,
  fromId: string,
  serverId: string
): boolean {
  if (!fromId || !serverId || fromId === serverId) return false
  const sess = bySessionId.get(fromId)
  if (!sess) return false
  if (bySessionId.has(serverId)) return false
  bySessionId.delete(fromId)
  sess.id = serverId
  sess.cliSessionId = serverId
  delete sess.pendingServerLink
  bySessionId.set(serverId, sess)
  return true
}
