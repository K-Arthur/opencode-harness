/**
 * Layer 6 RED tests — bidirectional session title sync.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.4
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L6-T1..T14)
 *
 * SessionStore imports `vscode` at module load, so we can't instantiate it
 * from node's test runner without a heavyweight stub. The existing
 * `SessionStore.test.ts` uses source-level structural assertions for the
 * same reason; we follow that pattern here.
 *
 * SessionUpdatedHandler does NOT depend on `vscode`, so its tests are
 * full behavioral.
 *
 * L6-T12..T14 (Playwright integration) deferred (`it.skip`).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SessionUpdatedHandler } from "./eventHandlers/SessionUpdatedHandler"

const STORE_SRC = readFileSync(join(__dirname, "SessionStore.ts"), "utf8")

describe("SessionStore.setTitle — Layer 6 RED (structural)", () => {
  it("L6-T1: setTitle method exists and writes to session.name", () => {
    assert.match(STORE_SRC, /setTitle\s*\(\s*id\s*:\s*string\s*,\s*title\s*:\s*string\s*\)\s*:\s*boolean/)
    const fnBody = STORE_SRC.slice(STORE_SRC.indexOf("setTitle("))
    assert.match(fnBody, /session\.name\s*=\s*trimmed/, "setTitle must write to session.name")
  })

  it("L6-T2: setTitle invokes serverTitleUpdater with the canonical server id", () => {
    const fnBody = STORE_SRC.slice(STORE_SRC.indexOf("setTitle("))
    assert.match(
      fnBody,
      /serverTitleUpdater\(\s*serverId/,
      "setTitle must propagate the title to the SDK via serverTitleUpdater(serverId, …)",
    )
  })

  it("L6-T3: setTitle validates via validateSessionName", () => {
    const fnBody = STORE_SRC.slice(STORE_SRC.indexOf("setTitle("))
    assert.match(fnBody, /validateSessionName\s*\(/, "setTitle must call validateSessionName")
    assert.match(fnBody, /return\s+false/, "setTitle must return false on invalid input")
  })

  it("L6-T4: setTitle no-ops the server call when no canonical server id exists", () => {
    const fnBody = STORE_SRC.slice(STORE_SRC.indexOf("setTitle("))
    assert.match(
      fnBody,
      /const serverId = session\.cliSessionId/,
      "setTitle must resolve a canonical server id before calling the SDK",
    )
  })

  it("L6-T5: setServerTitleUpdater dependency-injection method exists", () => {
    assert.match(
      STORE_SRC,
      /setServerTitleUpdater\s*\(\s*updater\s*:/,
      "SessionStore must expose setServerTitleUpdater(updater) for DI",
    )
  })

  it("L6-T6: applyServerTitle exists for inbound (server→extension) sync", () => {
    assert.match(
      STORE_SRC,
      /applyServerTitle\s*\(\s*cliSessionId\s*:\s*string\s*,\s*title\s*:\s*string\s*\)\s*:\s*boolean/,
    )
    const fnBody = STORE_SRC.slice(STORE_SRC.indexOf("applyServerTitle("))
    // Must NOT call serverTitleUpdater (avoid feedback loop).
    const slice = fnBody.slice(0, 2000)
    assert.doesNotMatch(
      slice,
      /serverTitleUpdater\(/,
      "applyServerTitle must NOT invoke serverTitleUpdater (avoid echo loop)",
    )
  })
})

describe("SessionUpdatedHandler — Layer 6 RED (behavioral)", () => {
  it("L6-T7: session.updated event yields a normalized 'session_updated' event with the new title", () => {
    const handler = new SessionUpdatedHandler()
    assert.ok(handler.canHandle("session.updated"))
    const out = handler.handle(
      {
        type: "session.updated",
        properties: { info: { id: "s1", title: "Renamed by CLI", projectID: "", directory: "", version: "1" } },
      },
      {} as never,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "session_updated")
    assert.equal(out[0]!.sessionId, "s1")
    const data = out[0]!.data as { title?: string }
    assert.equal(data.title, "Renamed by CLI")
  })

  it("L6-T8: session.updated for an unknown session id still emits (consumers decide what to do)", () => {
    const handler = new SessionUpdatedHandler()
    const out = handler.handle(
      {
        type: "session.updated",
        properties: { info: { id: "unknown", title: "x", projectID: "", directory: "", version: "1" } },
      },
      {} as never,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]!.sessionId, "unknown")
  })

  it("L6-T9: session.updated event with missing info still yields a normalised event (graceful degradation)", () => {
    const handler = new SessionUpdatedHandler()
    const out = handler.handle({ type: "session.updated", properties: {} }, {} as never)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "session_updated")
  })

  it("L6-T10: handler ignores non-session.updated event types", () => {
    const handler = new SessionUpdatedHandler()
    assert.equal(handler.canHandle("session.created"), false)
    assert.equal(handler.canHandle("session.deleted"), false)
    assert.equal(handler.canHandle("message.updated"), false)
  })

  it.skip("L6-T11: session.deleted event handler — deferred", () => {})
})

// L6-T12..T14: Playwright integration. Tracked separately.
