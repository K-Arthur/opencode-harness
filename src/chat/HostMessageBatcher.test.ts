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
})
