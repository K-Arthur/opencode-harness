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
    assert.equal((events[0]!.data as { messageId?: string }).messageId, "m1")
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
    assert.equal(events[0]!.sessionId, "s5")
    assert.equal((events[0]!.data as { error?: string }).error, "Rate limit exceeded")
  })

  it("normalizes message.updated completion with either session id casing", () => {
    const events = normalizer.normalize({
      type: "message.updated",
      properties: {
        info: {
          id: "m-lower-session",
          role: "assistant",
          sessionId: "s-lower-session",
          time: { completed: Date.now() },
        },
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "message_complete")
    assert.equal(events[0]!.sessionId, "s-lower-session")
  })

  it("does not console-log per text delta", () => {
    const isolated = createSdkEventNormalizer()
    const originalInfo = console.info
    const originalWarn = console.warn
    const infos: unknown[] = []
    const warns: unknown[] = []
    console.info = (...args: unknown[]) => { infos.push(args) }
    console.warn = (...args: unknown[]) => { warns.push(args) }

    try {
      isolated.normalize({
        type: "message.part.delta",
        properties: { sessionID: "s-quiet", messageID: "m-quiet", partID: "p-quiet", delta: "quiet text" },
      })
    } finally {
      console.info = originalInfo
      console.warn = originalWarn
    }

    assert.equal(infos.length, 0)
    assert.equal(warns.length, 0)
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
      properties: {
        sessionID: "s9",
        diff: [
          { file: "src/main.ts", additions: 3, deletions: 1 },
          { file: "src/utils.ts", additions: 0, deletions: 2 },
        ],
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "file_edited")
    assert.equal(events[0]!.sessionId, "s9")
    assert.deepEqual((events[0]!.data as { files?: string[] }).files, ["src/main.ts", "src/utils.ts"])
    assert.deepEqual((events[0]!.data as { changes?: unknown[] }).changes, [
      { path: "src/main.ts", added: 3, removed: 1 },
      { path: "src/utils.ts", added: 0, removed: 2 },
    ])
  })

  it("normalizes session.compacted to session_compacted", () => {
    const events = normalizer.normalize({
      type: "session.compacted",
      properties: { sessionID: "s10" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "session_compacted")
  })

  it("normalizes session.updated to session_updated with server title", () => {
    const events = normalizer.normalize({
      type: "session.updated",
      properties: { info: { id: "s10", title: "Server title" } },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "session_updated")
    assert.equal(events[0]!.sessionId, "s10")
    assert.equal((events[0]!.data as { title?: string }).title, "Server title")
  })

  it("normalizes file.edited to file_edited", () => {
    const events = normalizer.normalize({
      type: "file.edited",
      properties: { sessionID: "s12", file: "test.ts" },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "file_edited")
    assert.equal(events[0]!.sessionId, "s12")
    assert.equal((events[0]!.data as { file?: string }).file, "test.ts")
    assert.deepEqual((events[0]!.data as { files?: string[] }).files, ["test.ts"])
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

  it("normalizes step-finish part to step_finish", () => {
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        type: "step-finish",
        sessionID: "s-step",
        tokens: { input: 200, output: 150, reasoning: 30, cache: { read: 40, write: 10 } },
        cost: 0.002,
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, "step_finish")
    assert.equal(events[0]!.sessionId, "s-step")
    const data = events[0]!.data as { tokens: { input: number; output: number; cacheRead: number }; cost: number }
    assert.equal(data.tokens.input, 200)
    assert.equal(data.tokens.output, 150)
    assert.equal(data.tokens.cacheRead, 40)
    assert.equal(data.cost, 0.002)
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
    assert.equal((events[0]!.data as { id?: string }).id, "t1")
  })

  it("keeps one stable tool id through pending, running, and completed states", () => {
    const n = createSdkEventNormalizer()
    n.normalize({
      type: "message.updated",
      properties: { info: { id: "m-tool-life", role: "assistant", sessionID: "s-tool-life" } },
    })

    const pending = n.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          callID: "call-1",
          messageID: "m-tool-life",
          sessionID: "s-tool-life",
          type: "tool",
          tool: "read",
          state: { status: "pending" },
        },
      },
    })
    const running = n.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          callID: "call-1",
          messageID: "m-tool-life",
          sessionID: "s-tool-life",
          type: "tool",
          tool: "read",
          state: { status: "running", input: {} },
        },
      },
    })
    const completed = n.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          callID: "call-1",
          messageID: "m-tool-life",
          sessionID: "s-tool-life",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: {}, output: "done" },
        },
      },
    })

    assert.deepEqual(pending.map(e => e.type), ["tool_start"])
    assert.deepEqual(running.map(e => e.type), ["tool_update"])
    assert.deepEqual(completed.map(e => e.type), ["tool_end"])
    assert.equal((pending[0]!.data as { id?: string }).id, "tool-part-1")
    assert.equal((running[0]!.data as { id?: string }).id, "tool-part-1")
    assert.equal((completed[0]!.data as { id?: string }).id, "tool-part-1")
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
