/**
 * Behavioral tests for restore-point collection (audit §14.5).
 *
 * Turns a session's snapshot-bearing message parts into an ordered "restore to
 * here" rail, each entry carrying precise `session.revert` coordinates
 * (messageID + partID + snapshot). Message-level revert is already wired; this is
 * the granularity + surfacing core.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { collectRestorePoints, buildRevertRequest, type RestorePointMessage } from "./restorePoints"

const msg = (id: string, role: "user" | "assistant", parts: RestorePointMessage["parts"], time?: number): RestorePointMessage =>
  ({ id, role, parts, ...(time !== undefined ? { time } : {}) })

describe("collectRestorePoints", () => {
  it("returns [] for no messages and for messages without snapshots", () => {
    assert.deepEqual(collectRestorePoints([]), [])
    assert.deepEqual(
      collectRestorePoints([msg("m1", "assistant", [{ id: "p1", type: "text" }])]),
      [],
    )
  })

  it("emits one point per snapshot-bearing part with revert coordinates", () => {
    const points = collectRestorePoints([
      msg("m1", "user", [{ id: "u1", type: "text" }], 100),
      msg("m2", "assistant", [
        { id: "s1", type: "step-start", snapshot: "snapA", title: "Edit auth.ts" },
        { id: "t1", type: "tool", tool: "edit" },
      ], 200),
    ])
    assert.equal(points.length, 1)
    const p = points[0]!
    assert.equal(p.messageID, "m2")
    assert.equal(p.partID, "s1")
    assert.equal(p.snapshot, "snapA")
    assert.equal(p.kind, "step")
    assert.equal(p.index, 0)
    assert.equal(p.time, 200)
    assert.ok(p.label.length > 0)
  })

  it("orders points chronologically with incrementing index", () => {
    const points = collectRestorePoints([
      msg("m1", "assistant", [{ id: "a", type: "snapshot", snapshot: "s1" }]),
      msg("m2", "assistant", [{ id: "b", type: "snapshot", snapshot: "s2" }]),
      msg("m3", "assistant", [{ id: "c", type: "step-finish", snapshot: "s3" }]),
    ])
    assert.deepEqual(points.map((p) => p.snapshot), ["s1", "s2", "s3"])
    assert.deepEqual(points.map((p) => p.index), [0, 1, 2])
  })

  it("collapses consecutive duplicate snapshots", () => {
    const points = collectRestorePoints([
      msg("m1", "assistant", [
        { id: "a", type: "step-start", snapshot: "same" },
        { id: "b", type: "step-finish", snapshot: "same" },
      ]),
      msg("m2", "assistant", [{ id: "c", type: "step-start", snapshot: "diff" }]),
    ])
    assert.deepEqual(points.map((p) => p.snapshot), ["same", "diff"])
  })

  it("labels a user-turn snapshot distinctly from an assistant snapshot", () => {
    const points = collectRestorePoints([
      msg("m1", "user", [{ id: "u", type: "snapshot", snapshot: "s1" }]),
      msg("m2", "assistant", [{ id: "a", type: "snapshot", snapshot: "s2", tool: "write" }]),
    ])
    assert.equal(points[0]!.kind, "user-turn")
    assert.equal(points[1]!.kind, "snapshot")
    assert.ok(points[1]!.label.includes("write"))
  })
})

describe("buildRevertRequest", () => {
  it("maps coordinates and omits undefined partID/snapshot", () => {
    assert.deepEqual(buildRevertRequest("ses1", { messageID: "m1" }), { sessionID: "ses1", messageID: "m1" })
    assert.deepEqual(
      buildRevertRequest("ses1", { messageID: "m1", partID: "p1", snapshot: "s1" }),
      { sessionID: "ses1", messageID: "m1", partID: "p1", snapshot: "s1" },
    )
  })
})
