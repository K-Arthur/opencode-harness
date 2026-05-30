import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { upsertMessageById } from "./messageUpsert"
import type { ChatMessage } from "../../types"

const mk = (id: string | undefined, text: string): ChatMessage => ({
  role: "assistant",
  id,
  blocks: [{ type: "text", text }],
  timestamp: 1,
})

describe("upsertMessageById (C1: stream_end must not duplicate the streamed message)", () => {
  it("replaces an existing message with the same id in place", () => {
    const arr = [mk("m1", "partial")]
    const replaced = upsertMessageById(arr, mk("m1", "final blocks"))
    assert.equal(arr.length, 1, "must not grow the array for a known id")
    assert.equal(replaced, true)
    const block = arr[0]!.blocks[0] as unknown as { text: string }
    assert.equal(block.text, "final blocks", "content must be the upserted version")
  })

  it("preserves array order when replacing in place", () => {
    const arr = [mk("a", "A"), mk("m1", "partial"), mk("b", "B")]
    upsertMessageById(arr, mk("m1", "final"))
    assert.deepEqual(arr.map((m) => m.id), ["a", "m1", "b"])
  })

  it("pushes a message whose id is not present", () => {
    const arr = [mk("a", "A")]
    const replaced = upsertMessageById(arr, mk("m2", "new"))
    assert.equal(arr.length, 2)
    assert.equal(replaced, false)
  })

  it("always pushes when the message has no id (cannot dedup)", () => {
    const arr = [mk(undefined, "x")]
    upsertMessageById(arr, mk(undefined, "y"))
    assert.equal(arr.length, 2, "id-less messages must never collapse together")
  })
})
