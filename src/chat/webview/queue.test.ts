import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createPromptQueue } from "./queue"

describe("createPromptQueue", () => {
  describe("enqueue", () => {
    it("returns null for empty + no attachments", () => {
      const q = createPromptQueue()
      assert.equal(q.enqueue(""), null)
      assert.equal(q.enqueue("   "), null)
    })

    it("allows attachment-only items", () => {
      const q = createPromptQueue()
      const item = q.enqueue("", [{ data: "x", mimeType: "image/png" }])
      assert.ok(item)
      assert.equal(item!.attachments.length, 1)
    })

    it("trims text and assigns monotonic position", () => {
      const q = createPromptQueue()
      const a = q.enqueue("  one  ")!
      const b = q.enqueue("two")!
      assert.equal(a.text, "one")
      assert.equal(a.position, 0)
      assert.equal(b.position, 1)
    })

    it("estimates tokens (~4 chars/token)", () => {
      const q = createPromptQueue()
      const item = q.enqueue("12345678")! // 8 chars → 2 tokens
      assert.equal(item.estimatedTokens, 2)
    })
  })

  describe("remove / edit", () => {
    it("removes a queued item and compacts positions", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      q.enqueue("b")
      q.enqueue("c")
      assert.ok(q.remove(a.id))
      const items = q.getItems()
      assert.deepEqual(items.map(i => i.position), [0, 1])
    })

    it("refuses to remove a sending or streaming item", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      a.state = "sending"
      assert.equal(q.remove(a.id), false)
    })

    it("edit refuses empty text and refuses non-queued items", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      assert.equal(q.edit(a.id, "   "), false)
      a.state = "sending"
      assert.equal(q.edit(a.id, "new"), false)
    })

    it("edit re-estimates tokens", () => {
      const q = createPromptQueue()
      const a = q.enqueue("short")!
      assert.ok(q.edit(a.id, "a much longer prompt that costs more tokens"))
      assert.ok(a.estimatedTokens! > 5)
    })
  })

  describe("processNext / isNextReady", () => {
    it("returns null when nothing is queued", () => {
      const q = createPromptQueue()
      assert.equal(q.isNextReady(), false)
      assert.equal(q.processNext(), null)
    })

    it("processes items in FIFO order and marks them sending", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      q.enqueue("b")
      assert.equal(q.isNextReady(), true)
      const next = q.processNext()
      assert.deepEqual(next, { text: "a", attachments: [] })
      assert.equal(a.state, "sending")
    })
  })

  describe("getTotalEstimatedTokens", () => {
    it("sums tokens across all items, including sending ones", () => {
      const q = createPromptQueue()
      q.enqueue("12345678") // 2 tokens
      q.enqueue("1234")     // 1 token
      assert.equal(q.getTotalEstimatedTokens(), 3)
    })

    it("decreases when an item is removed", () => {
      const q = createPromptQueue()
      const a = q.enqueue("12345678")!
      q.enqueue("1234")
      q.remove(a.id)
      assert.equal(q.getTotalEstimatedTokens(), 1)
    })
  })

  describe("persist / restore", () => {
    it("round-trips the queue across a snapshot", () => {
      const q1 = createPromptQueue()
      q1.enqueue("first")
      q1.enqueue("second")
      const snapshot = q1.persist()

      const q2 = createPromptQueue()
      q2.restore(snapshot)
      assert.deepEqual(
        q2.getItems().map(i => i.text),
        ["first", "second"]
      )
    })

    it("restore replaces existing items rather than appending", () => {
      const q = createPromptQueue()
      q.enqueue("existing")
      q.restore([])
      assert.equal(q.getItems().length, 0)
    })

    it("persist returns a defensive copy (mutations don't leak)", () => {
      const q = createPromptQueue()
      q.enqueue("a")
      const snapshot = q.persist()
      snapshot.length = 0
      assert.equal(q.getItems().length, 1)
    })
  })

  describe("markAsSteer", () => {
    it("flags a queued item as a steer prompt", () => {
      const q = createPromptQueue()
      const a = q.enqueue("steer me")!
      assert.ok(q.markAsSteer(a.id))
      assert.equal(a.isSteerPrompt, true)
    })

    it("returns false for unknown ids", () => {
      const q = createPromptQueue()
      assert.equal(q.markAsSteer("nope"), false)
    })
  })

  describe("reorder / moveToFront / moveToBack", () => {
    it("reorders moves an item from one index to another and compacts positions", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      const b = q.enqueue("b")!
      const c = q.enqueue("c")!
      assert.ok(q.reorder(0, 2))
      const ids = q.getItems().map(i => i.id)
      assert.deepEqual(ids, [b.id, c.id, a.id])
      assert.deepEqual(q.getItems().map(i => i.position), [0, 1, 2])
    })

    it("reorder rejects out-of-bounds and no-op moves", () => {
      const q = createPromptQueue()
      q.enqueue("a")
      q.enqueue("b")
      assert.equal(q.reorder(0, 0), false)
      assert.equal(q.reorder(-1, 0), false)
      assert.equal(q.reorder(0, 99), false)
    })

    it("reorder refuses to move sending or streaming items", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      q.enqueue("b")
      a.state = "sending"
      assert.equal(q.reorder(0, 1), false)
    })

    it("reorder refuses to bury a queued item behind a sending one", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      q.enqueue("b")
      a.state = "sending"
      // 'b' is queued at idx 1, the only valid target is idx 1 (itself, no-op)
      assert.equal(q.reorder(1, 0), false)
    })

    it("moveToFront promotes a queued item to the first movable slot", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      const b = q.enqueue("b")!
      const c = q.enqueue("c")!
      assert.ok(q.moveToFront(c.id))
      assert.deepEqual(q.getItems().map(i => i.id), [c.id, a.id, b.id])
    })

    it("moveToFront returns false for already-first or unknown ids", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      assert.equal(q.moveToFront(a.id), false)
      assert.equal(q.moveToFront("nope"), false)
    })

    it("moveToFront skips sending items at the head", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      const b = q.enqueue("b")!
      const c = q.enqueue("c")!
      a.state = "sending"
      assert.ok(q.moveToFront(c.id))
      // c moved to position 1 (just after the sending 'a')
      assert.deepEqual(q.getItems().map(i => i.id), [a.id, c.id, b.id])
    })

    it("moveToBack pushes a queued item to the end", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      const b = q.enqueue("b")!
      const c = q.enqueue("c")!
      assert.ok(q.moveToBack(a.id))
      assert.deepEqual(q.getItems().map(i => i.id), [b.id, c.id, a.id])
    })
  })

  describe("clear", () => {
    it("empties everything", () => {
      const q = createPromptQueue()
      q.enqueue("a")
      q.enqueue("b")
      q.clear()
      assert.equal(q.getItems().length, 0)
      assert.equal(q.getTotalEstimatedTokens(), 0)
    })
  })

  describe("markStuckSendingAsQueued", () => {
    it("resets sending items back to queued", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      const b = q.enqueue("b")!
      a.state = "sending"
      b.state = "sending"
      q.markStuckSendingAsQueued()
      assert.equal(a.state, "queued")
      assert.equal(b.state, "queued")
    })

    it("does not affect already-queued items", () => {
      const q = createPromptQueue()
      q.enqueue("a")
      const b = q.enqueue("b")!
      b.state = "sending"
      q.markStuckSendingAsQueued()
      const items = q.getItems()
      assert.equal(items[0]!.state, "queued")
      assert.equal(items[1]!.state, "queued")
    })

    it("is idempotent when called multiple times", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!
      a.state = "sending"
      q.markStuckSendingAsQueued()
      q.markStuckSendingAsQueued()
      assert.equal(a.state, "queued")
    })

    it("is safe on an empty queue", () => {
      const q = createPromptQueue()
      q.markStuckSendingAsQueued()
      assert.equal(q.getItems().length, 0)
    })

    it("does not affect completed, failed, streaming, or queued items", () => {
      const q = createPromptQueue()
      const a = q.enqueue("a")!; a.state = "queued"
      const b = q.enqueue("b")!; b.state = "sending"
      const c = q.enqueue("c")!; c.state = "streaming"
      const d = q.enqueue("d")!; d.state = "completed"
      const e = q.enqueue("e")!; e.state = "failed"

      q.markStuckSendingAsQueued()

      assert.equal(a.state, "queued")
      assert.equal(b.state, "queued") // was sending → queued
      assert.equal(c.state, "streaming")
      assert.equal(d.state, "completed")
      assert.equal(e.state, "failed")
    })
  })
})
