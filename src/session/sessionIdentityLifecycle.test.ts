/**
 * Regression tests for the session-identity lifecycle bug (ADR-014).
 *
 * Root cause being guarded against: the SessionStore map key was rekeyed from
 * the webview/tab-local id (`session-<8hex>`) to the opencode server id
 * (`ses_…`) on server import (`mergeServerSessions`, fired on every
 * `sessions_recovered`) and on load (`migrateLocalIdsToServerIds`, fired in the
 * SessionStore constructor). Nothing propagated that rename to TabManager or to
 * the webview, both of which keep the original `session-<8hex>` key. The result
 * was a store entry that diverged from its still-live tab: SSE rendered live
 * (routed by `cliSessionId`), but persistence keyed by the tab id silently
 * no-oped, and the next webview message re-created an empty duplicate entry.
 *
 * Invariant under test: **the map key is immutable for the life of a session.**
 * The server link lives only in the `cliSessionId` field. Import/merge/migrate
 * must never change an existing entry's key.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  migrateLocalIdsToServerIds,
  mergeServerSessions,
  type MigratableSession,
} from "./sessionMigration"

function makeSession(overrides: Partial<MigratableSession> = {}): MigratableSession {
  return {
    id: "session-ab0c12d3",
    name: "",
    createdAt: 1000,
    lastActiveAt: 1500,
    model: "anthropic/claude",
    mode: "build",
    messages: [],
    cost: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    ...overrides,
  }
}

describe("session-identity lifecycle (ADR-014: immutable map key)", () => {
  it("mergeServerSessions does NOT rekey a live local session on server reconnect", () => {
    // 1. Webview created a session; first prompt linked it to server id ses_x.
    const map = new Map<string, MigratableSession>()
    map.set(
      "session-ab0c12d3",
      makeSession({
        id: "session-ab0c12d3",
        cliSessionId: "ses_x",
        name: "My task",
        messages: [{ role: "user" }, { role: "assistant" }],
      }),
    )

    // 2. Server reconnect → sessions_recovered → import reports ses_x.
    const result = mergeServerSessions(map, [{ id: "ses_x", title: "My task" }])

    // 3. The key MUST stay put so the live tab + webview stay bound.
    assert.equal(result.imported, 0, "must not import a session we already track")
    assert.equal(map.has("session-ab0c12d3"), true, "original local key must survive")
    assert.equal(map.has("ses_x"), false, "must NOT create/rekey to the server id")
    assert.equal(map.size, 1, "no duplicate entry")
    const s = map.get("session-ab0c12d3")!
    assert.equal(s.id, "session-ab0c12d3", "entry.id must equal its (unchanged) key")
    assert.equal(s.cliSessionId, "ses_x", "server link is reaffirmed in cliSessionId")
    assert.equal(s.messages.length, 2, "local transcript preserved")
  })

  it("migrateLocalIdsToServerIds does NOT rekey a solo local session on load", () => {
    const map = new Map<string, MigratableSession>()
    map.set(
      "session-ab0c12d3",
      makeSession({ id: "session-ab0c12d3", cliSessionId: "ses_x", messages: [{ role: "user" }] }),
    )

    const result = migrateLocalIdsToServerIds(map)

    assert.equal(result.rekeyed, 0, "solo entries must never be rekeyed")
    assert.equal(map.has("session-ab0c12d3"), true, "local key survives across reload")
    assert.equal(map.has("ses_x"), false, "no server-keyed clone is created")
    assert.equal(map.get("session-ab0c12d3")!.cliSessionId, "ses_x")
    assert.equal(map.get("session-ab0c12d3")!.messages.length, 1)
  })

  it("a full create→prompt→reconnect→reload cycle keeps one stable key", () => {
    const map = new Map<string, MigratableSession>()
    // create (offline placeholder, no server link yet)
    map.set("session-ab0c12d3", makeSession({ id: "session-ab0c12d3", pendingServerLink: true }))
    // first prompt links to server (updateCliSessionId sets the field, no rekey)
    const created = map.get("session-ab0c12d3")!
    created.cliSessionId = "ses_x"
    delete created.pendingServerLink
    // server reconnect
    mergeServerSessions(map, [{ id: "ses_x" }])
    // extension reload
    migrateLocalIdsToServerIds(map)

    assert.equal(map.size, 1, "exactly one entry — no duplicates ever spawned")
    assert.equal(map.has("session-ab0c12d3"), true, "the original key is the only key")
    assert.equal(map.get("session-ab0c12d3")!.cliSessionId, "ses_x")
  })

  it("still collapses a genuine LEGACY duplicate (two entries, same cliSessionId)", () => {
    // Pre-ADR-014 data: an old run already created both a local-keyed and a
    // server-keyed row for the same server session. Migrate should fold them
    // back into a single entry rather than leave two history rows.
    const map = new Map<string, MigratableSession>()
    // Surviving (server-keyed) entry has no real title yet, so the user-chosen
    // name from the duplicate should win during the merge.
    map.set("ses_x", makeSession({ id: "ses_x", cliSessionId: "ses_x", name: "", messages: [] }))
    map.set(
      "session-ab0c12d3",
      makeSession({
        id: "session-ab0c12d3",
        cliSessionId: "ses_x",
        name: "User named",
        messages: [{ role: "user" }, { role: "assistant" }],
      }),
    )

    const result = migrateLocalIdsToServerIds(map)

    assert.equal(result.merged, 1, "the duplicate is collapsed")
    assert.equal(map.size, 1, "one surviving entry")
    assert.equal(map.get("ses_x")!.messages.length, 2, "richer transcript preserved")
    assert.equal(map.get("ses_x")!.name, "User named", "user-chosen name preserved")
  })
})
