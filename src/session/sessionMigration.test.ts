/**
 * Behavioral tests for sessionMigration helpers (ADR-007).
 * These functions are pure and vscode-free, so they are exercised directly.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  migrateLocalIdsToServerIds,
  mergeServerSessions,
  promotePendingServerLink,
  type MigratableSession,
} from "./sessionMigration"

function makeSession(overrides: Partial<MigratableSession> = {}): MigratableSession {
  return {
    id: "local-1",
    name: "Local 1",
    createdAt: 1000,
    lastActiveAt: 1500,
    model: "",
    mode: "build",
    messages: [],
    cost: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    ...overrides,
  }
}

describe("migrateLocalIdsToServerIds", () => {
  it("does NOT rekey a solo entry whose cliSessionId differs from its key (ADR-014)", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession({ id: "local-1", cliSessionId: "srv-A" }))
    const result = migrateLocalIdsToServerIds(map)
    // ADR-014: the local key is immutable; the server link lives in cliSessionId.
    assert.equal(result.rekeyed, 0)
    assert.equal(map.has("local-1"), true, "immutable local key survives")
    assert.equal(map.has("srv-A"), false, "no server-keyed clone is created")
    assert.equal(map.get("local-1")!.id, "local-1")
    assert.equal(map.get("local-1")!.cliSessionId, "srv-A", "server link stays in the field")
  })

  it("leaves entries without cliSessionId untouched", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession())
    const result = migrateLocalIdsToServerIds(map)
    assert.equal(result.rekeyed, 0)
    assert.equal(map.has("local-1"), true)
  })

  it("is idempotent — second invocation rekeys nothing", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession({ id: "local-1", cliSessionId: "srv-A" }))
    migrateLocalIdsToServerIds(map)
    const result = migrateLocalIdsToServerIds(map)
    assert.equal(result.rekeyed, 0)
  })

  it("preserves message history under the immutable local key", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession({
      id: "local-1",
      cliSessionId: "srv-A",
      messages: [{ role: "user" }, { role: "assistant" }],
    }))
    migrateLocalIdsToServerIds(map)
    assert.equal(map.get("local-1")!.messages.length, 2)
  })

  it("merges a duplicate local-keyed entry into the existing server-keyed entry", () => {
    const map = new Map<string, MigratableSession>()
    map.set("srv-A", makeSession({ id: "srv-A", cliSessionId: "srv-A", name: "Session A", messages: [] }))
    map.set("local-1", makeSession({
      id: "local-1",
      cliSessionId: "srv-A",
      name: "User named session",
      messages: [{ role: "user" }, { role: "assistant" }],
    }))
    const result = migrateLocalIdsToServerIds(map)
    assert.equal(result.rekeyed, 0)
    assert.equal(result.merged, 1)
    assert.equal(map.has("local-1"), false)
    assert.equal(map.size, 1)
    assert.equal(map.get("srv-A")!.name, "User named session")
    assert.equal(map.get("srv-A")!.messages.length, 2)
  })
})

describe("mergeServerSessions", () => {
  it("imports unknown server sessions with needsBackfill=true", () => {
    const map = new Map<string, MigratableSession>()
    const result = mergeServerSessions(map, [
      { id: "srv-A", title: "Server A", time: { updated: 2000, created: 1000 } },
    ])
    assert.equal(result.imported, 1)
    assert.equal(result.skipped, 0)
    const a = map.get("srv-A")!
    assert.equal(a.needsBackfill, true)
    assert.equal(a.cliSessionId, "srv-A")
    assert.equal(a.name, "Server A")
    assert.equal(a.lastActiveAt, 2000)
    assert.equal(a.createdAt, 1000)
  })

  it("skips server sessions that are already in the local map", () => {
    const map = new Map<string, MigratableSession>()
    map.set("srv-A", makeSession({ id: "srv-A", cliSessionId: "srv-A", name: "Local A" }))
    const result = mergeServerSessions(map, [{ id: "srv-A", title: "Renamed on server" }])
    assert.equal(result.imported, 0)
    assert.equal(result.skipped, 1)
    assert.equal(map.get("srv-A")!.name, "Local A", "local name preserved")
  })

  it("does not rekey a known local entry when the server reports its id (ADR-014)", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession({ id: "local-1", cliSessionId: "srv-A", name: "Local A" }))
    const result = mergeServerSessions(map, [{ id: "srv-A", title: "Server A" }])
    // Dedup is by cliSessionId: the already-tracked session is recognized, so
    // nothing is imported and — per ADR-014 — the immutable local key stays put.
    assert.equal(result.imported, 0)
    assert.equal(result.skipped, 1)
    assert.equal(map.has("local-1"), true, "immutable local key survives")
    assert.equal(map.has("srv-A"), false, "no server-keyed clone is created")
    assert.equal(map.get("local-1")!.cliSessionId, "srv-A")
  })

  it("reaffirms cliSessionId on a previously unlinked local entry", () => {
    const map = new Map<string, MigratableSession>()
    map.set("srv-A", makeSession({ id: "srv-A", name: "X" }))
    mergeServerSessions(map, [{ id: "srv-A", title: "X" }])
    assert.equal(map.get("srv-A")!.cliSessionId, "srv-A")
  })

  it("falls back to a synthetic name when the server session has no title", () => {
    const map = new Map<string, MigratableSession>()
    mergeServerSessions(map, [{ id: "abcdef-12345" }])
    assert.equal(map.get("abcdef-12345")!.name, "Session 12345")
  })

  it("is idempotent — re-importing the same set is a no-op", () => {
    const map = new Map<string, MigratableSession>()
    mergeServerSessions(map, [{ id: "srv-A", title: "A" }])
    const result = mergeServerSessions(map, [{ id: "srv-A", title: "A" }])
    assert.equal(result.imported, 0)
    assert.equal(result.skipped, 1)
    assert.equal(map.size, 1)
  })

  it("ignores entries without an id", () => {
    const map = new Map<string, MigratableSession>()
    const result = mergeServerSessions(map, [{ id: "" } as never, { id: "srv-A" }])
    assert.equal(result.imported, 1)
    assert.equal(result.skipped, 1)
    assert.equal(map.size, 1)
  })
})

describe("promotePendingServerLink", () => {
  it("rekeys a session under the new server id and clears pendingServerLink", () => {
    const map = new Map<string, MigratableSession>()
    map.set("local-1", makeSession({ id: "local-1", pendingServerLink: true }))
    const ok = promotePendingServerLink(map, "local-1", "srv-NEW")
    assert.equal(ok, true)
    assert.equal(map.has("local-1"), false)
    const s = map.get("srv-NEW")!
    assert.equal(s.id, "srv-NEW")
    assert.equal(s.cliSessionId, "srv-NEW")
    assert.equal(s.pendingServerLink, undefined)
  })

  it("returns false when source is missing", () => {
    const map = new Map<string, MigratableSession>()
    assert.equal(promotePendingServerLink(map, "missing", "srv-X"), false)
  })

  it("returns false when target id is already in use", () => {
    const map = new Map<string, MigratableSession>()
    map.set("srv-X", makeSession({ id: "srv-X", cliSessionId: "srv-X" }))
    map.set("local-1", makeSession({ id: "local-1", pendingServerLink: true }))
    const ok = promotePendingServerLink(map, "local-1", "srv-X")
    assert.equal(ok, false)
    assert.equal(map.has("local-1"), true, "source preserved on failure")
  })

  it("returns false when fromId equals serverId", () => {
    const map = new Map<string, MigratableSession>()
    map.set("srv-A", makeSession({ id: "srv-A" }))
    assert.equal(promotePendingServerLink(map, "srv-A", "srv-A"), false)
  })
})
