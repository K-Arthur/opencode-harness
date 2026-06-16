/**
 * Tests for hunk-reject planning (audit §14.3). Verifies the host can revert one
 * hunk of an agent edit (keep the rest) by computing the resulting file content
 * from git before/after — to be applied as a single undoable WorkspaceEdit.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getFileHunks, planHunkRevert } from "./hunkRevertPlan"

describe("getFileHunks", () => {
  it("summarizes each hunk with id and +/- counts", () => {
    const before = "a\nb\nc"
    const after = "a\nB\nc"
    const hunks = getFileHunks(before, after)
    assert.equal(hunks.length, 1)
    assert.ok(hunks[0]!.id.length > 0)
    assert.equal(hunks[0]!.additions, 1)
    assert.equal(hunks[0]!.deletions, 1)
  })
})

describe("planHunkRevert", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
  const after = before.split("\n").map((l, i) => (i === 1 ? "FIRST" : i === 18 ? "SECOND" : l)).join("\n")

  it("reverts only the chosen hunk, keeping the others (result applied to disk)", () => {
    const hunks = getFileHunks(before, after)
    assert.equal(hunks.length, 2)
    // Reject the first hunk → FIRST reverts to line1, SECOND stays applied.
    const plan = planHunkRevert(before, after, hunks[0]!.id)!
    assert.ok(plan, "plan produced")
    assert.ok(!plan.newContent.includes("FIRST"), "rejected hunk reverted")
    assert.ok(plan.newContent.includes("SECOND"), "other hunk kept")
    assert.ok(plan.newContent.includes("line1"), "first region back to original")
  })

  it("reverting every hunk reproduces the before content", () => {
    const hunks = getFileHunks(before, after)
    let content = after
    // Revert hunks one at a time (ids are stable for a given before/after).
    for (const h of hunks) {
      const plan = planHunkRevert(before, after, h.id)
      assert.ok(plan)
    }
    // Reverting both via the planner against `before` yields `before`.
    const planAll = planHunkRevert(before, after, hunks[0]!.id)!
    const planAll2 = planHunkRevert(before, planAll.newContent, getFileHunks(before, planAll.newContent)[0]!.id)
    content = planAll2 ? planAll2.newContent : planAll.newContent
    assert.equal(content, before)
  })

  it("returns null for an unknown hunk id (stale request)", () => {
    assert.equal(planHunkRevert(before, after, "nope-9"), null)
  })
})
