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
      ttlMs: 200,
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

  void it("expires events after the TTL and logs once per session", async () => {
    buf.add("ses_late", evt("tool_start", "ses_late"))
    await new Promise((r) => setTimeout(r, 250))
    assert.deepEqual(buf.drain("ses_late"), [], "expired events must not replay")
    assert.equal(
      warnings.filter((w) => w.includes("ses_late")).length,
      1,
      "expiry must log exactly one warning per session",
    )
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

  void it("dispose() cancels pending expiry timers and clears state", async () => {
    buf.add("ses_dispose", evt("tool_start", "ses_dispose"))
    buf.dispose()
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(warnings.length, 0, "expiry warnings must not fire after dispose")
  })

  void it("default TTL of 5 minutes keeps events alive for child session replay", () => {
    const longBuf = new PendingEventBuffer()
    longBuf.add("ses_child", evt("subagent_update", "ses_child"))
    // With 5-minute default TTL, events must survive synchronous drain
    assert.equal(longBuf.drain("ses_child").length, 1, "must drain before any expiry")
    longBuf.dispose()
  })
})
