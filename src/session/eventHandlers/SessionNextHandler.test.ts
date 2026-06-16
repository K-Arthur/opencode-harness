import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { SessionNextHandler } from "./SessionNextHandler"
import type { NormalizerContext, SdkEventLike } from "./types"

function makeContext(): NormalizerContext {
  return {
    partTextLengths: new Map(),
    partMessageIds: new Map(),
    partSessionIds: new Map(),
    partTypes: new Map(),
    partStatusKeys: new Map(),
    messageRoles: new Map(),
    toolStatuses: new Map(),
    toolInputs: new Map(),
    toolOutputs: new Map(),
    toolStartedIds: new Set(),
    toolPartialTokens: new Map(),
    toolPartialStdoutLengths: new Map(),
    toolPartialStderrLengths: new Map(),
    seenUnknownTypes: new Set(),
    isAssistantMessage: () => true,
    clearMessageTracking: () => {},
    rememberPart: () => {},
  }
}

function event(properties: Record<string, unknown>): SdkEventLike {
  return { type: "session.next.tool.progress", properties }
}

describe("SessionNextHandler tool.progress partials", () => {
  let handler: SessionNextHandler
  let ctx: NormalizerContext

  beforeEach(() => {
    handler = new SessionNextHandler()
    ctx = makeContext()
  })

  it("emits a tool_update plus stdout tool_partial from text content chunks", () => {
    const results = handler.handle(event({
      sessionID: "s1",
      callID: "call-1",
      tool: "bash",
      token: 4,
      content: [{ type: "text", text: "installing\n" }],
    }), ctx)

    assert.equal(results.length, 2)
    assert.equal(results[0]?.type, "tool_update")
    assert.equal(results[1]?.type, "tool_partial")
    assert.deepEqual(results[1]?.data, {
      id: "call-1",
      tool: "bash",
      token: 4,
      stdoutDelta: "installing\n",
      stderrDelta: "",
      stdoutLength: 11,
      stderrLength: 0,
      stdoutLineCount: 1,
      stderrLineCount: 0,
    })
  })

  it("drops duplicate progress tokens while still forwarding tool_update", () => {
    const props = {
      sessionID: "s1",
      callID: "call-1",
      tool: "bash",
      token: 4,
      content: [{ type: "text", text: "installing\n" }],
    }
    handler.handle(event(props), ctx)

    const duplicate = handler.handle(event(props), ctx)
    assert.equal(duplicate.length, 1)
    assert.equal(duplicate[0]?.type, "tool_update")
  })

  it("uses seq/sequence tokens and accumulates absolute stdout length", () => {
    handler.handle(event({
      sessionID: "s1",
      callID: "call-1",
      tool: "bash",
      seq: 1,
      content: [{ type: "text", text: "one" }],
    }), ctx)

    const results = handler.handle(event({
      sessionID: "s1",
      callID: "call-1",
      tool: "bash",
      sequence: 2,
      content: [{ type: "text", text: "two" }],
    }), ctx)
    const partial = results.find((r) => r.type === "tool_partial")
    assert.ok(partial)
    const data = partial.data as Record<string, unknown>
    assert.equal(data.token, 2)
    assert.equal(data.stdoutDelta, "two")
    assert.equal(data.stdoutLength, 6)
  })

  it("does not emit tool_partial when progress has no text result", () => {
    const results = handler.handle(event({
      sessionID: "s1",
      callID: "call-1",
      tool: "bash",
      token: 1,
      content: [],
    }), ctx)

    assert.equal(results.length, 1)
    assert.equal(results[0]?.type, "tool_update")
  })
})
