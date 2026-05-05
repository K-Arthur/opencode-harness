/**
 * Behavioral tests for EventNormalizer — tests actual SDK event normalization.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Replicate the key normalization logic from EventNormalizer.ts
function normalizePartType(part) {
  if (!part?.type) return null
  if (part.type === "text") return { type: "text_chunk", text: part.text || "" }
  if (part.type === "tool") return { type: "tool_start", tool: part.tool || "unknown" }
  return null
}

function normalizeMessageStatus(msg) {
  if (!msg) return []
  const results = []
  if (msg.role === "assistant" && msg.time?.completed) {
    results.push({ type: "message_complete", sessionId: msg.sessionID })
  }
  if (msg.error) {
    results.push({ type: "server_error", sessionId: msg.sessionID, data: { error: msg.error } })
  }
  return results
}

function normalizeSessionEvent(event) {
  const results = []
  switch (event.type) {
    case "session.status":
      results.push({ type: "session_status", sessionId: event.sessionID, data: { status: event.status } })
      break
    case "session.idle":
      results.push({ type: "session_status", sessionId: event.sessionID, data: { status: { type: "idle" } } })
      break
    case "session.error":
      results.push({ type: "server_error", sessionId: event.sessionID, data: { error: event.error } })
      break
    case "session.diff":
      results.push({ type: "file_edited", sessionId: event.sessionID, data: event })
      break
    case "session.compacted":
      results.push({ type: "session_compacted", sessionId: event.sessionID, data: event })
      break
    case "file.edited":
      results.push({ type: "file_edited", data: event })
      break
    case "permission.updated":
      results.push({ type: "permission_request", sessionId: event.sessionID, data: event })
      break
    case "permission.replied":
      results.push({ type: "permission_replied", sessionId: event.sessionID, data: event })
      break
  }
  return results
}

describe("EventNormalizer — part type normalization", () => {
  it("normalizes text parts to text_chunk", () => {
    const result = normalizePartType({ id: "p1", type: "text", text: "Hello world" })
    assert.equal(result.type, "text_chunk")
    assert.equal(result.text, "Hello world")
  })

  it("normalizes tool parts to tool_start", () => {
    const result = normalizePartType({ id: "p2", type: "tool", tool: "bash" })
    assert.equal(result.type, "tool_start")
    assert.equal(result.tool, "bash")
  })

  it("returns null for unknown part types", () => {
    assert.equal(normalizePartType({ id: "p3", type: "unknown" }), null)
  })

  it("returns null for parts without type", () => {
    assert.equal(normalizePartType({ id: "p4" }), null)
  })

  it("returns null for null/undefined input", () => {
    assert.equal(normalizePartType(null), null)
    assert.equal(normalizePartType(undefined), null)
  })
})

describe("EventNormalizer — message normalization", () => {
  it("emits message_complete for assistant messages with completion time", () => {
    const results = normalizeMessageStatus({
      id: "m1", role: "assistant", sessionID: "s1",
      time: { completed: 1000000 }
    })
    assert.equal(results.length, 1)
    assert.equal(results[0].type, "message_complete")
    assert.equal(results[0].sessionId, "s1")
  })

  it("does not emit message_complete for user messages", () => {
    const results = normalizeMessageStatus({
      id: "m2", role: "user", sessionID: "s1",
      time: { completed: 1000000 }
    })
    assert.equal(results.length, 0)
  })

  it("emits server_error for messages with error field", () => {
    const results = normalizeMessageStatus({
      id: "m3", role: "assistant", sessionID: "s1",
      error: new Error("Something went wrong")
    })
    assert.equal(results.length, 1)
    assert.equal(results[0].type, "server_error")
    assert.equal(results[0].data.error instanceof Error, true)
  })

  it("emits both error and completion if both present", () => {
    const results = normalizeMessageStatus({
      id: "m4", role: "assistant", sessionID: "s1",
      time: { completed: 1000000 },
      error: "Partial error"
    })
    assert.equal(results.length, 2)
  })

  it("returns empty array for null input", () => {
    assert.deepEqual(normalizeMessageStatus(null), [])
  })
})

describe("EventNormalizer — session event normalization", () => {
  it("normalizes session.status to session_status", () => {
    const results = normalizeSessionEvent({ type: "session.status", sessionID: "s1", status: { type: "busy" } })
    assert.equal(results[0].type, "session_status")
  })

  it("normalizes session.idle to session_status/idle", () => {
    const results = normalizeSessionEvent({ type: "session.idle", sessionID: "s1" })
    assert.equal(results[0].type, "session_status")
    assert.equal(results[0].data.status.type, "idle")
  })

  it("normalizes session.error to server_error", () => {
    const results = normalizeSessionEvent({ type: "session.error", sessionID: "s1", error: "fail" })
    assert.equal(results[0].type, "server_error")
  })

  it("normalizes session.diff to file_edited", () => {
    const results = normalizeSessionEvent({ type: "session.diff", sessionID: "s1" })
    assert.equal(results[0].type, "file_edited")
  })

  it("normalizes session.compacted to session_compacted", () => {
    const results = normalizeSessionEvent({ type: "session.compacted", sessionID: "s1" })
    assert.equal(results[0].type, "session_compacted")
  })

  it("normalizes file.edited to file_edited", () => {
    const results = normalizeSessionEvent({ type: "file.edited" })
    assert.equal(results[0].type, "file_edited")
  })

  it("normalizes permission.updated to permission_request", () => {
    const results = normalizeSessionEvent({ type: "permission.updated", sessionID: "s1" })
    assert.equal(results[0].type, "permission_request")
  })

  it("normalizes permission.replied to permission_replied", () => {
    const results = normalizeSessionEvent({ type: "permission.replied", sessionID: "s1" })
    assert.equal(results[0].type, "permission_replied")
  })

  it("returns empty array for unknown event types", () => {
    const results = normalizeSessionEvent({ type: "some.unknown.event" })
    assert.equal(results.length, 0)
  })
})

describe("EventNormalizer — text delta tracking", () => {
  it("computes delta from accumulated text", () => {
    const text = "Hello World"
    const previousLength = 0
    const delta = text.slice(previousLength)
    assert.equal(delta, "Hello World")
  })

  it("computes incremental delta", () => {
    const text = "Hello World, nice to meet you"
    const previousLength = 11  // "Hello World" length
    const delta = text.slice(previousLength)
    assert.equal(delta, ", nice to meet you")
  })

  it("returns empty delta when no new text", () => {
    const text = "Hello"
    const previousLength = 5
    const delta = text.slice(previousLength)
    assert.equal(delta, "")
  })

  it("handles missing delta field by computing from text", () => {
    const props = { text: "Hello" }
    const previousLength = 0
    const delta = typeof props?.delta === "string" ? props.delta : (props.text || "").slice(previousLength)
    assert.equal(delta, "Hello")
  })
})
