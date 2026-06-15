import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { MessageUpdateHandler } from "./MessageUpdateHandler"
import type { SdkEventLike, NormalizerContext } from "./types"

function createMockContext(): NormalizerContext {
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
    isAssistantMessage: () => false,
    clearMessageTracking: () => {},
    rememberPart: () => {},
  }
}

describe("MessageUpdateHandler", () => {
  const handler = new MessageUpdateHandler()

  it("canHandle only message.updated", () => {
    assert.equal(handler.canHandle("message.updated"), true)
    assert.equal(handler.canHandle("message.part.updated"), false)
  })

  it("emits server_error carrying the server message id so aborts can be correlated", () => {
    const event: SdkEventLike = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_abc123",
          role: "assistant",
          sessionID: "ses_xyz",
          error: { name: "MessageAbortedError", message: "aborted" },
        },
      },
    }
    const out = handler.handle(event, createMockContext())
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "server_error")
    assert.equal(out[0]!.sessionId, "ses_xyz")
    const data = out[0]!.data as { error?: unknown; messageId?: unknown }
    assert.equal(data.messageId, "msg_abc123")
    assert.ok(data.error, "the error payload must be preserved")
  })

  it("emits message_complete (not server_error) for a normal completed assistant message", () => {
    const event: SdkEventLike = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_done",
          role: "assistant",
          sessionID: "ses_xyz",
          time: { completed: 123 },
        },
      },
    }
    const out = handler.handle(event, createMockContext())
    assert.equal(out.length, 1)
    assert.equal(out[0]!.type, "message_complete")
  })

  it("ignores non-assistant roles", () => {
    const event: SdkEventLike = {
      type: "message.updated",
      properties: { info: { id: "msg_u", role: "user", sessionID: "ses_xyz" } },
    }
    assert.equal(handler.handle(event, createMockContext()).length, 0)
  })
})
