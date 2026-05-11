import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { StepFinishHandler } from "./StepFinishHandler"
import type { SdkEventLike } from "./types"
import type { NormalizerContext } from "./types"

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
    seenUnknownTypes: new Set(),
    isAssistantMessage: () => false,
    clearMessageTracking: () => {},
    rememberPart: () => {},
  }
}

describe("StepFinishHandler", () => {
  const handler = new StepFinishHandler()
  const ctx = createMockContext()

  it("canHandle returns true for message.part.updated", () => {
    assert.equal(handler.canHandle("message.part.updated"), true)
  })

  it("canHandle returns false for other event types", () => {
    assert.equal(handler.canHandle("message.updated"), false)
    assert.equal(handler.canHandle("session.status"), false)
    assert.equal(handler.canHandle("unknown"), false)
  })

  it("returns step_finish event with token data", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
      properties: {
        type: "step-finish",
        sessionID: "s-test",
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
      },
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.type, "step_finish")
    assert.equal(result[0]!.sessionId, "s-test")
    const data = result[0]!.data as { tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }; cost?: number }
    assert.equal(data.tokens.input, 100)
    assert.equal(data.tokens.output, 50)
    assert.equal(data.tokens.reasoning, 10)
    assert.equal(data.tokens.cacheRead, 20)
    assert.equal(data.tokens.cacheWrite, 5)
  })

  it("includes cost data when present", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
      properties: {
        type: "step-finish",
        sessionID: "s-cost",
        tokens: { input: 10, output: 20 },
        cost: 0.0015,
      },
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 1)
    const data = result[0]!.data as { cost?: number }
    assert.equal(data.cost, 0.0015)
  })

  it("returns empty when no tokens data", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
      properties: {
        type: "step-finish",
        sessionID: "s-no-tokens",
      },
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 0)
  })

  it("returns empty when part type is not step-finish", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
      properties: {
        type: "text",
        sessionID: "s-text",
      },
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 0)
  })

  it("handles missing cache field gracefully", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
      properties: {
        type: "step-finish",
        sessionID: "s-no-cache",
        tokens: { input: 5, output: 3, reasoning: 0 },
      },
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 1)
    const data = result[0]!.data as { tokens: { cacheRead: number; cacheWrite: number } }
    assert.equal(data.tokens.cacheRead, 0)
    assert.equal(data.tokens.cacheWrite, 0)
  })

  it("handles missing properties gracefully", () => {
    const event: SdkEventLike = {
      type: "message.part.updated",
    }
    const result = handler.handle(event, ctx)
    assert.equal(result.length, 0)
  })
})
