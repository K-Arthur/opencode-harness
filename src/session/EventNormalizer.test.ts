import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createSdkEventNormalizer } from "./EventNormalizer"

describe("EventNormalizer — behavioral", () => {
  const normalizer = createSdkEventNormalizer()

  const markAssistant = (messageId: string, sessionId: string): void => {
    normalizer.normalize({
      type: "message.updated",
      properties: { info: { id: messageId, role: "assistant", sessionID: sessionId } },
    })
  }

  it("normalizes text part updates to text_chunk events", () => {
    markAssistant("m1", "s1")
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "Hello" },
        delta: "Hello",
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "text_chunk")
    assert.equal((events[0]!.data as { text?: string }).text, "Hello")
    assert.equal(events[0]!.sessionId, "s1")
  })

  it("emits only delta for subsequent text part updates", () => {
    markAssistant("m2", "s2")
    normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: { id: "p2", messageID: "m2", sessionID: "s2", type: "text", text: "Hello" },
        delta: "Hello",
      },
    })
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: { id: "p2", messageID: "m2", sessionID: "s2", type: "text", text: "Hello World" },
        delta: undefined,
      },
    })
    assert.equal(events.length, 1)
    assert.equal((events[0]!.data as { text?: string }).text, " World")
  })

  it("normalizes message.updated with completion to message_complete", () => {
    const events = normalizer.normalize({
      type: "message.updated",
      properties: { info: { id: "m3", role: "assistant", sessionID: "s3", time: { completed: Date.now() } } },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "message_complete")
    assert.equal(events[0]!.sessionId, "s3")
  })

  it("normalizes message.updated with error to server_error", () => {
    const events = normalizer.normalize({
      type: "message.updated",
      properties: { info: { id: "m5", role: "assistant", sessionID: "s5", error: "Rate limit exceeded" } },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "server_error")
    assert.equal((events[0]!.data as { error?: string }).error, "Rate limit exceeded")
  })

  it("normalizes session.status to session_status", () => {
    const events = normalizer.normalize({
      type: "session.status",
      properties: { sessionID: "s6", status: { type: "busy" } },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "session_status")
    assert.deepEqual((events[0]!.data as { status?: unknown }).status, { type: "busy" })
  })

  it("normalizes session.idle to session_status with idle type", () => {
    const events = normalizer.normalize({
      type: "session.idle",
      properties: { sessionID: "s7" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "session_status")
    assert.deepEqual((events[0]!.data as { status?: { type?: string } }).status, { type: "idle" })
  })

  it("normalizes session.error to server_error", () => {
    const events = normalizer.normalize({
      type: "session.error",
      properties: { sessionID: "s8", error: "Connection refused" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "server_error")
    assert.equal((events[0]!.data as { error?: string }).error, "Connection refused")
  })

  it("normalizes session.diff to file_edited", () => {
    const events = normalizer.normalize({
      type: "session.diff",
      properties: { sessionID: "s9", file: "src/main.ts" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "file_edited")
    assert.equal(events[0]!.sessionId, "s9")
  })

  it("normalizes session.compacted to session_compacted", () => {
    const events = normalizer.normalize({
      type: "session.compacted",
      properties: { sessionID: "s10" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "session_compacted")
  })

  it("normalizes file.edited to file_edited", () => {
    const events = normalizer.normalize({
      type: "file.edited",
      properties: { file: "test.ts" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "file_edited")
  })

  it("normalizes permission.updated to permission_request", () => {
    const events = normalizer.normalize({
      type: "permission.updated",
      properties: { sessionID: "s11", id: "perm1", type: "bash" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "permission_request")
    assert.equal(events[0]!.sessionId, "s11")
  })

  it("normalizes permission.replied to permission_replied", () => {
    const events = normalizer.normalize({
      type: "permission.replied",
      properties: { sessionID: "s12" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "permission_replied")
  })

  it("returns empty array for unknown event types", () => {
    const events = normalizer.normalize({ type: "unknown.event.type" })
    assert.equal(events.length, 0)
  })

  it("emits text_chunk even when message.part.delta arrives before message.updated (role race)", () => {
    // This is the critical race condition: the server may send part deltas
    // before the message.updated event that sets the role. If we require
    // the role to be known, chunks are silently dropped and the user sees
    // "no output of any sort".
    const events = normalizer.normalize({
      type: "message.part.delta",
      properties: { sessionID: "s-race", messageID: "m-race", partID: "p-race", delta: "Hello before role" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "text_chunk")
    assert.equal((events[0]!.data as { text?: string }).text, "Hello before role")
  })

  it("emits text_chunk for message.part.updated before role is known", () => {
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: { id: "p-race2", messageID: "m-race2", sessionID: "s-race2", type: "text", text: "Hello" },
        delta: "Hello",
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "text_chunk")
    assert.equal((events[0]!.data as { text?: string }).text, "Hello")
  })

  it("still drops chunks for messages explicitly marked as non-assistant", () => {
    // First mark the message as a user message
    normalizer.normalize({
      type: "message.updated",
      properties: { info: { id: "m-user", role: "user", sessionID: "s-user" } },
    })
    // Then send a part delta for it
    const events = normalizer.normalize({
      type: "message.part.delta",
      properties: { sessionID: "s-user", messageID: "m-user", partID: "p-user", delta: "should not appear" },
    })
    assert.equal(events.length, 0)
  })

  it("emits tool_start on tool part pending", () => {
    markAssistant("m10", "s20")
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "t1",
          messageID: "m10",
          sessionID: "s20",
          type: "tool",
          tool: "Bash",
          callID: "call1",
          state: { status: "pending", input: "ls -la" },
        },
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "tool_start")
    assert.equal((events[0]!.data as { tool?: string }).tool, "Bash")
  })

  it("deduplicates part deltas via partTextLengths tracking", () => {
    markAssistant("m30", "s30")
    const events = normalizer.normalize({
      type: "message.part.delta",
      properties: { sessionID: "s30", messageID: "m30", partID: "p30", delta: " world" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "text_chunk")
    assert.equal((events[0]!.data as { text?: string }).text, " world")
  })
})
