import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"

describe("m1: toolBadgeText centralizes tool state -> badge mapping", () => {
  it("maps every known state and respects error precedence", async () => {
    const dom = installDom()
    try {
      const { toolBadgeText } = await import("./streamHandlers")
      assert.equal(toolBadgeText("pending"), "Pending")
      assert.equal(toolBadgeText("running"), "Running")
      assert.equal(toolBadgeText("stale"), "Stale")
      assert.equal(toolBadgeText("error"), "Error")
      assert.equal(toolBadgeText("completed"), "Done")
      assert.equal(toolBadgeText("result"), "Done")
      // hasError forces Error, but only after pending/running/stale (preserves
      // the original if/else precedence).
      assert.equal(toolBadgeText("completed", true), "Error")
      assert.equal(toolBadgeText("pending", true), "Pending")
      assert.equal(toolBadgeText("unknown-state"), null)
    } finally {
      dom.restore()
    }
  })
})

describe("m3: sameToolBlock is id-authoritative", () => {
  it("two calls with distinct ids are NOT the same, even with identical args", async () => {
    const { sameToolBlock } = await import("./streamEndHandler")
    const a = { id: "t1", name: "read", args: { path: "a.ts" } }
    const b = { id: "t2", name: "read", args: { path: "a.ts" } }
    assert.equal(sameToolBlock(a, b), false, "distinct ids must never merge")
  })

  it("matches by id when both have ids", async () => {
    const { sameToolBlock } = await import("./streamEndHandler")
    assert.equal(
      sameToolBlock({ id: "t1", name: "read", args: { p: 1 } }, { id: "t1", name: "read", args: { p: 2 } }),
      true,
      "same id wins regardless of args",
    )
  })

  it("falls back to name+args only when an id is missing", async () => {
    const { sameToolBlock } = await import("./streamEndHandler")
    assert.equal(sameToolBlock({ name: "read", args: { p: 1 } }, { name: "read", args: { p: 1 } }), true)
    assert.equal(sameToolBlock({ name: "read", args: { p: 1 } }, { name: "read", args: { p: 2 } }), false)
    assert.equal(sameToolBlock({ id: "t1", name: "read", args: {} }, { name: "read", args: {} }), true)
  })
})
