import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { PendingEventBuffer, type BufferedServerEvent } from "./PendingEventBuffer"

function evt(type: string, sessionId: string, extra: Record<string, unknown> = {}): BufferedServerEvent {
  return { type, sessionId, ...extra }
}

void describe("PendingEventBuffer", () => {
  let buf: PendingEventBuffer
  let warnings: string[]

  beforeEach(() => {
    warnings = []
    buf = new PendingEventBuffer({
      maxPerSession: 3,
      log: { warn: (m: string) => warnings.push(m), info: () => {} },
    })
  })

  afterEach(() => {
    buf.dispose()
  })

  void it("returns nothing when draining a session that has never buffered", () => {
    assert.deepEqual(buf.drain("ses_unknown"), [])
  })

  void it("buffers an event and replays it in FIFO order on drain", () => {
    buf.add("ses_A", evt("file_edited", "ses_A", { data: 1 }))
    buf.add("ses_A", evt("tool_start", "ses_A", { data: 2 }))
    buf.add("ses_A", evt("message_complete", "ses_A", { data: 3 }))

    const replayed = buf.drain("ses_A")
    assert.equal(replayed.length, 3)
    assert.equal(replayed[0]!.type, "file_edited")
    assert.equal(replayed[1]!.type, "tool_start")
    assert.equal(replayed[2]!.type, "message_complete")
  })

  void it("isolates buffers per sessionId", () => {
    buf.add("ses_A", evt("tool_start", "ses_A"))
    buf.add("ses_B", evt("file_edited", "ses_B"))

    const a = buf.drain("ses_A")
    const b = buf.drain("ses_B")
    assert.equal(a.length, 1)
    assert.equal(b.length, 1)
    assert.equal(a[0]!.type, "tool_start")
    assert.equal(b[0]!.type, "file_edited")
  })

  void it("clears the per-session buffer after drain so a second drain is empty", () => {
    buf.add("ses_A", evt("tool_start", "ses_A"))
    assert.equal(buf.drain("ses_A").length, 1)
    assert.equal(buf.drain("ses_A").length, 0)
  })

  void it("retains events until explicitly drained (no TTL — supports 45min sessions)", async () => {
    buf.add("ses_long", evt("subagent_update", "ses_long"))
    // Wait 500ms — ample time for any implicit TTL to fire if one existed
    await new Promise((r) => setTimeout(r, 500))
    const replayed = buf.drain("ses_long")
    assert.equal(replayed.length, 1, "events must persist until drained, no TTL expiry")
    assert.equal(warnings.length, 0, "no expiry warnings should fire — there is no TTL")
  })

  void it("caps buffered events per session and drops the oldest when full", () => {
    buf.add("ses_overflow", evt("e1", "ses_overflow"))
    buf.add("ses_overflow", evt("e2", "ses_overflow"))
    buf.add("ses_overflow", evt("e3", "ses_overflow"))
    buf.add("ses_overflow", evt("e4", "ses_overflow"))

    const replayed = buf.drain("ses_overflow")
    assert.equal(replayed.length, 3, "buffer must not exceed maxPerSession")
    assert.deepEqual(
      replayed.map((e: BufferedServerEvent) => e.type),
      ["e2", "e3", "e4"],
      "oldest event must be dropped when over capacity",
    )
  })

  void it("coalesces adjacent text chunks for the same pending session", () => {
    buf.add("ses_stream", evt("text_chunk", "ses_stream", { data: { text: "hel", messageId: "m1" } }))
    buf.add("ses_stream", evt("text_chunk", "ses_stream", { data: { text: "lo", messageId: "m1" } }))

    const replayed = buf.drain("ses_stream")
    assert.equal(replayed.length, 1)
    assert.equal(replayed[0]!.type, "text_chunk")
    assert.deepEqual(replayed[0]!.data, { text: "hello", messageId: "m1" })
  })

  void it("does not coalesce text chunks across tool boundaries", () => {
    buf.add("ses_stream", evt("text_chunk", "ses_stream", { data: { text: "before" } }))
    buf.add("ses_stream", evt("tool_start", "ses_stream", { data: { id: "tool-1" } }))
    buf.add("ses_stream", evt("text_chunk", "ses_stream", { data: { text: "after" } }))

    const replayed = buf.drain("ses_stream")
    assert.deepEqual(
      replayed.map((event) => event.type),
      ["text_chunk", "tool_start", "text_chunk"],
    )
    assert.deepEqual(replayed[0]!.data, { text: "before" })
    assert.deepEqual(replayed[2]!.data, { text: "after" })
  })

  void it("ignores events without a sessionId rather than crashing", () => {
    assert.doesNotThrow(() => buf.add("", evt("noop", "")))
    assert.equal(buf.drain("").length, 0)
  })

  void it("dispose() clears all state without warnings", () => {
    buf.add("ses_dispose", evt("tool_start", "ses_dispose"))
    buf.dispose()
    assert.equal(buf.drain("ses_dispose").length, 0, "buffer must be empty after dispose")
    assert.equal(warnings.length, 0, "no warnings must fire after dispose")
  })

  void it("sweep removes orphaned entries with an explicit ts older than minAge but leaves others intact", () => {
    const now = 1_000_000_000_000
    const stale = { ...evt("old", "ses_stale"), ts: now - 2_000_000 } // > 30 min old
    const fresh = { ...evt("new", "ses_fresh"), ts: now - 100_000 }    // < 30 min
    buf.add("ses_stale", stale)
    buf.add("ses_fresh", fresh)

    const pruned = buf.sweep({ minAgeMs: 1_800_000, now })
    assert.equal(pruned, 1, "only stale orphan entries must be pruned")
    assert.equal(buf.drain("ses_stale").length, 0, "stale session must be removed")
    assert.equal(buf.drain("ses_fresh").length, 1, "fresh session must survive")
  })

  void it("sweep does nothing when no events carry a ts field (production child session events)", () => {
    buf.add("ses_child", evt("subagent_update", "ses_child"))
    const pruned = buf.sweep({ minAgeMs: 0, now: Date.now() + 1_000_000 })
    assert.equal(pruned, 0, "events without ts must never be swept")
    assert.equal(buf.drain("ses_child").length, 1, "child session events survive sweep")
  })
})
