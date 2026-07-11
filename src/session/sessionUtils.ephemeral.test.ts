import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildPersistedSessions, buildSession } from "./sessionUtils"

describe("sessionUtils ephemeral sessions", () => {
  it("marks newly built sessions as ephemeral when requested", () => {
    const session = buildSession({ id: "tmp-1", ephemeral: true })
    assert.equal(session.ephemeral, true)
  })

  it("never persists ephemeral sessions, even with messages or pending backfill", () => {
    const persisted = buildPersistedSessions(new Map([
      ["keep", { messages: [{ id: "m1" }], needsBackfill: false }],
      ["temp", { messages: [{ id: "m2" }], ephemeral: true }],
      ["temp-backfill", { messages: [], needsBackfill: true, ephemeral: true }],
    ]), 50)

    assert.deepEqual(Object.keys(persisted), ["keep"])
  })
})
