import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { HostMessageBatcher } from "./HostMessageBatcher"

void describe("HostMessageBatcher", () => {
  void it("wraps non-critical messages in a batch envelope", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) })

    batcher.post({ type: "context_usage", sessionId: "s1", percent: 80 })
    batcher.post({ type: "server_status", sessionId: "s1", status: "thinking" })
    batcher.flush()

    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "host_message_batch")
    assert.deepEqual((posted[0]!.messages as Record<string, unknown>[]).map((m) => m.type), [
      "context_usage",
      "server_status",
    ])
  })

  void it("sends stream lifecycle messages immediately and in order", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) })

    batcher.post({ type: "context_usage", sessionId: "s1", percent: 80 })
    batcher.post({ type: "stream_start", sessionId: "s1", messageId: "m1" })
    batcher.flush()

    assert.equal(posted[0]!.type, "stream_start")
    assert.equal(posted[1]!.type, "host_message_batch")
  })

  void it("treats tool updates as batchable but tool start/end as immediate", () => {
    assert.equal(HostMessageBatcher.isBatchable({ type: "stream_tool_update" }), true)
    assert.equal(HostMessageBatcher.isBatchable({ type: "stream_tool_start" }), false)
    assert.equal(HostMessageBatcher.isBatchable({ type: "stream_tool_end" }), false)
  })

  void it("buffers stream chunks by session through the same post API", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) })

    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "Hello ", messageId: "m1" })
    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "World", messageId: "m1" })
    batcher.flush()

    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "stream_chunk")
    assert.equal(posted[0]!.sessionId, "s1")
    assert.equal(posted[0]!.text, "Hello World")
    assert.equal(posted[0]!.messageId, "m1")
  })

  void it("flushes pending chunks before stream_end", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) })

    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "tail" })
    batcher.post({ type: "stream_end", sessionId: "s1" })

    assert.deepEqual(posted.map((m) => m.type), ["stream_chunk", "stream_end"])
  })

  void it("pauses and resumes chunk delivery for lifecycle retries", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) })

    batcher.pauseSession("s1")
    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "held" })
    batcher.flush()
    assert.equal(posted.length, 0)

    batcher.resumeSession("s1")
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "stream_chunk")
    assert.equal(posted[0]!.text, "held")
  })

  void it("retains stream chunks when async webview post resolves false", async () => {
    let resolvePost: ((ok: boolean) => void) | undefined
    const posted: Record<string, unknown>[] = []
    let failOnce = true
    const batcher = new HostMessageBatcher((msg) => {
      posted.push(msg)
      if (!failOnce) return true
      failOnce = false
      return new Promise<boolean>((resolve) => { resolvePost = resolve })
    })

    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "retry" })
    batcher.flush()
    assert.equal(posted.length, 1)
    resolvePost?.(false)
    await Promise.resolve()

    batcher.flush()
    assert.equal(posted.length, 2)
    assert.equal(posted[1]!.type, "stream_chunk")
    assert.equal(posted[1]!.text, "retry")
    batcher.dispose()
  })

  void it("retains stream chunks when async webview post rejects", async () => {
    let rejectPost: ((err: Error) => void) | undefined
    const posted: Record<string, unknown>[] = []
    let failOnce = true
    const batcher = new HostMessageBatcher((msg) => {
      posted.push(msg)
      if (!failOnce) return true
      failOnce = false
      return new Promise<boolean>((_, reject) => { rejectPost = reject })
    })

    batcher.post({ type: "stream_chunk", sessionId: "s1", text: "retry" })
    batcher.flush()
    assert.equal(posted.length, 1)
    rejectPost?.(new Error("webview closed"))
    await Promise.resolve()

    batcher.flush()
    assert.equal(posted.length, 2)
    assert.equal(posted[1]!.type, "stream_chunk")
    assert.equal(posted[1]!.text, "retry")
    batcher.dispose()
  })

  // ── F8: payload discipline (per-payload cap, dedup, total cap) ─────────
  // Pathological inputs (a single huge payload, the same payload repeated
  // thousands of times, or a session that buffers megabytes) must not be
  // able to grow the webview's message queue unbounded. The batcher
  // should drop with a warning at well-defined limits.

  void it("drops (with warning) a single batchable payload larger than maxPayloadBytes", () => {
    const posted: Record<string, unknown>[] = []
    const warnings: string[] = []
    const batcher = new HostMessageBatcher(
      (msg) => { posted.push(msg) },
      (msg) => warnings.push(msg),
      { maxPayloadBytes: 1024 },
    )
    // 2KB context_usage payload — well over the 1KB cap.
    const huge = { type: "context_usage", sessionId: "s1", percent: 80, blob: "x".repeat(2048) }
    const accepted = batcher.post(huge)
    assert.equal(accepted, false, "oversized payload must be rejected from the batch")
    batcher.flush()
    assert.equal(posted.length, 0, "oversized payload must not be flushed")
    assert.ok(
      warnings.some((w) => /oversized|too large|max-payload/i.test(w)),
      "must warn when rejecting an oversized payload",
    )
    batcher.dispose()
  })

  void it("does not drop an immediate (non-batchable) payload when over size cap", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) }, () => {}, { maxPayloadBytes: 256 })
    // stream_start is an IMMEDIATE type — must never be dropped by the size guard.
    const huge = { type: "stream_start", sessionId: "s1", messageId: "m1", blob: "x".repeat(1024) }
    batcher.post(huge)
    assert.equal(posted.length, 1, "immediate (non-batchable) messages must bypass the size guard")
    batcher.dispose()
  })

  void it("dedups identical batched payloads that repeat beyond the dedup window", () => {
    const posted: Record<string, unknown>[] = []
    const warnings: string[] = []
    const batcher = new HostMessageBatcher(
      (msg) => { posted.push(msg) },
      (msg) => warnings.push(msg),
      { dedupWindow: 3 },
    )
    const same = { type: "server_status", sessionId: "s1", status: "thinking" }
    for (let i = 0; i < 10; i++) batcher.post(same)
    batcher.flush()
    // Only 3 copies of the same payload should survive; the rest are deduped.
    const batch = posted[0]
    assert.ok(batch && batch.type === "host_message_batch")
    const msgs = (batch!.messages as Record<string, unknown>[])
    assert.equal(msgs.length, 3, `dedup window of 3 should keep at most 3 copies, got ${msgs.length}`)
    assert.ok(warnings.some((w) => /dedup|drop|repeat/i.test(w)), "must warn when dropping a duplicate")
    batcher.dispose()
  })

  void it("command_list bypasses the size guard (IMMEDIATE type)", () => {
    const posted: Record<string, unknown>[] = []
    const batcher = new HostMessageBatcher((msg) => { posted.push(msg) }, () => {}, { maxPayloadBytes: 256 })
    // command_list is an IMMEDIATE type — must never be dropped by the size guard.
    const huge = { type: "command_list", commands: Array(100).fill({ name: "test", template: "x".repeat(1024) }) }
    batcher.post(huge)
    assert.equal(posted.length, 1, "command_list (IMMEDIATE) must bypass the size guard")
    assert.equal(posted[0]!.type, "command_list")
    batcher.dispose()
  })
})
