/**
 * RED phase tests for the queue/steer "Send Now" fixes (2026-07-02 review).
 *
 * Backend bug: the send_queue_item router handler only honored the HEAD item
 * (`peek()` + id compare) — "Send Now" on any other item was silently ignored
 * on the host while the webview optimistically removed it locally. The item
 * then ghost-sent on the next drain, or reappeared after reload. And even for
 * the head item, sending into a busy tab hit reserveStreamSlotOrReject and
 * wrongly marked the prompt failed.
 *
 * Fix contract:
 *  - HostPromptQueue.moveToFront(sessionId, id): promote a queued item ahead
 *    of all other queued items (anchored sending items stay ahead).
 *  - Router: find by id anywhere; busy tab → moveToFront (next to drain);
 *    idle tab → moveToFront + dequeue + drain. ALWAYS postQueueState so the
 *    webview reconciles even when the id is stale.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { HostPromptQueue } from "./HostPromptQueue"

function makeMemento() {
  const data = new Map<string, unknown>()
  return {
    get: <T>(key: string, defaultValue?: T) => (data.has(key) ? (data.get(key) as T) : defaultValue),
    update: (key: string, value: unknown) => { data.set(key, value); return Promise.resolve() },
    keys: () => Array.from(data.keys()),
  }
}

const item = (text: string) => ({
  text,
  sessionId: "s1",
  attachments: [],
  mode: "queue" as const,
  isSteerPrompt: true,
})

describe("HostPromptQueue.moveToFront", () => {
  let q: HostPromptQueue

  beforeEach(() => {
    q = new HostPromptQueue(makeMemento() as never)
  })

  it("moves a middle queued item ahead of all other queued items", () => {
    q.enqueue("s1", item("a"))
    const bId = q.enqueue("s1", item("b"))!
    q.enqueue("s1", item("c"))
    assert.equal(q.moveToFront("s1", bId), true)
    assert.deepEqual(q.getAll("s1").map(i => i.text), ["b", "a", "c"])
  })

  it("keeps anchored 'sending' items ahead of the promoted item", () => {
    q.enqueue("s1", item("a"))
    const bId = q.enqueue("s1", item("b"))!
    // Dequeue marks "a" as sending — it stays first in the array.
    const sending = q.dequeue("s1")
    assert.equal(sending?.text, "a")
    assert.equal(q.moveToFront("s1", bId), true)
    const all = q.getAll("s1")
    assert.equal(all[0]?.text, "a")
    assert.equal(all[0]?.state, "sending")
    assert.equal(all[1]?.text, "b")
  })

  it("is a no-op (returns true) when the item is already the first queued item", () => {
    const aId = q.enqueue("s1", item("a"))!
    q.enqueue("s1", item("b"))
    assert.equal(q.moveToFront("s1", aId), true)
    assert.deepEqual(q.getAll("s1").map(i => i.text), ["a", "b"])
  })

  it("returns false for an unknown id", () => {
    q.enqueue("s1", item("a"))
    assert.equal(q.moveToFront("s1", "qp-nope"), false)
  })

  it("returns false for a non-queued item (failed items must be retried first)", () => {
    const aId = q.enqueue("s1", item("a"))!
    q.markFailed("s1", aId, "boom")
    assert.equal(q.moveToFront("s1", aId), false)
  })

  it("promoted item is the one dequeue() returns next", () => {
    q.enqueue("s1", item("a"))
    const bId = q.enqueue("s1", item("b"))!
    q.moveToFront("s1", bId)
    assert.equal(q.dequeue("s1")?.text, "b")
  })
})

describe("send_queue_item router contract", () => {
  const routerSource = readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "WebviewEventRouter.ts"),
    "utf8",
  )
  const handlerIdx = routerSource.indexOf('["send_queue_item"')
  const handler = handlerIdx >= 0 ? routerSource.slice(handlerIdx, handlerIdx + 2200) : ""

  it("finds the item by id anywhere in the queue, not only via peek()", () => {
    assert.ok(handler.length > 0, "send_queue_item handler must exist")
    assert.ok(
      !/const item = this\.opts\.hostQueue\.peek\(sessionId\)\s*\n\s*if \(!item \|\| item\.id !== msg\.itemId\) return/.test(handler),
      "handler must not silently drop non-head items (peek + id compare + bare return)"
    )
    assert.ok(
      handler.includes("moveToFront"),
      "handler must promote the requested item via moveToFront"
    )
  })

  it("defers to the drain path instead of startPrompt when the tab is busy", () => {
    assert.ok(
      handler.includes("isStreaming") || handler.includes("waitingForCompletion"),
      "handler must check tab busy state — startPrompt into a busy tab is rejected " +
      "by reserveStreamSlotOrReject and wrongly marks the item failed"
    )
  })

  it("always posts queue_state so a diverged webview reconciles", () => {
    assert.ok(
      handler.includes("postQueueState"),
      "handler must post queue state on every path (including stale ids)"
    )
  })
})
