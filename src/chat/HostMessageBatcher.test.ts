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
})
