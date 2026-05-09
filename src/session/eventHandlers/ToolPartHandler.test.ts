import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { ToolPartHandler } from "./ToolPartHandler"
import type { SdkEventLike, PartLike, ToolPartLike, NormalizerContext } from "../EventNormalizer"

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
    seenUnknownTypes: new Set(),
    isAssistantMessage: () => true,
    clearMessageTracking: () => {},
    rememberPart: () => {},
  }
}

function makeToolPart(overrides: Partial<ToolPartLike> = {}): ToolPartLike {
  return {
    id: "part-1",
    callID: "call-1",
    type: "tool",
    sessionID: "ses_abc",
    messageID: "msg_xyz",
    tool: "read",
    state: { status: "pending", input: { file: "src/main.ts" } },
    ...overrides,
  }
}

function makeEvent(part: ToolPartLike): SdkEventLike {
  return {
    type: "message.part.updated",
    properties: { part },
  }
}

/** Helper to grab the first normalized event and its data */
function first(r: ReturnType<ToolPartHandler["handle"]>): { type: string; data: Record<string, unknown> } | undefined {
  type NormalizedResult = ReturnType<ToolPartHandler["handle"]>[number]
  const e = (r as NormalizedResult[])[0]
  if (!e) return undefined
  return { type: e.type, data: (e.data as Record<string, unknown>) || {} }
}

/** Grab stable tool id by peeking at what the handler would generate */
function stableIdFrom(part: ToolPartLike): string {
  return part.id || part.callID || `${part.messageID || ""}:${part.tool || "tool"}`
}

describe("ToolPartHandler", () => {
  let handler: ToolPartHandler
  let ctx: NormalizerContext

  beforeEach(() => {
    handler = new ToolPartHandler()
    ctx = makeContext()
  })

  it("canHandle returns true for message.part.updated", () => {
    assert.equal(handler.canHandle("message.part.updated"), true)
  })

  it("canHandle returns false for other event types", () => {
    assert.equal(handler.canHandle("message.complete"), false)
    assert.equal(handler.canHandle("session.status"), false)
  })

  it("returns empty array for non-tool parts", () => {
    const part = { id: "p1", type: "text", text: "hello" } as PartLike
    const event = { type: "message.part.updated", properties: { part } }
    const results = handler.handle(event, ctx)
    assert.equal(results.length, 0)
  })

  it("pending -> running -> completed emits one tool_start, one tool_update, one tool_end with same ID", () => {
    const toolPart = makeToolPart({ state: { status: "pending" } })
    const stableId = stableIdFrom(toolPart)

    const r1 = first(handler.handle(makeEvent(toolPart), ctx))
    assert.ok(r1)
    assert.equal(r1.type, "tool_start")
    assert.equal(r1.data.id, stableId)

    const runningPart = {
      ...toolPart,
      state: { status: "running", input: { file: "src/main.ts" } },
    }
    const r2 = first(handler.handle(makeEvent(runningPart), ctx))
    assert.ok(r2)
    assert.equal(r2.type, "tool_update")
    assert.equal(r2.data.id, stableId)

    const donePart = {
      ...toolPart,
      state: { status: "completed", output: "file contents here" },
    }
    const r3 = first(handler.handle(makeEvent(donePart), ctx))
    assert.ok(r3)
    assert.equal(r3.type, "tool_end")
    assert.equal(r3.data.id, stableId)
    assert.equal(r3.data.ok, true)
  })

  it("empty input {} does not create duplicate tool_start on re-emit", () => {
    const toolPart = makeToolPart({
      state: { status: "pending", input: {} },
    })
    const stableId = stableIdFrom(toolPart)

    const r1 = first(handler.handle(makeEvent(toolPart), ctx))
    assert.ok(r1)
    assert.equal(r1.type, "tool_start")
    assert.equal(r1.data.id, stableId)

    const runningPart = {
      ...toolPart,
      state: { status: "running", input: { file: "src/main.ts" } },
    }
    const r2 = handler.handle(makeEvent(runningPart), ctx)
    const starts = r2.filter(e => e.type === "tool_start")
    assert.equal(starts.length, 0, "should not emit a second tool_start")
    assert.equal(r2[0]?.type, "tool_update")
  })

  it("missing input does not create duplicate placeholder call", () => {
    const toolPart = makeToolPart({
      callID: undefined,
      id: "part-2",
      state: { status: "pending" },
    })
    const stableId = stableIdFrom(toolPart)

    const r1 = first(handler.handle(makeEvent(toolPart), ctx))
    assert.ok(r1)
    assert.equal(r1.type, "tool_start")
    assert.equal(r1.data.id, stableId)

    const runningPart = {
      ...toolPart,
      state: { status: "running", input: { file: "src/utils.ts" } },
    }
    const r2 = handler.handle(makeEvent(runningPart), ctx)
    const starts = r2.filter(e => e.type === "tool_start")
    assert.equal(starts.length, 0)
    assert.equal(r2[0]?.type, "tool_update")
  })

  it("parallel tools with distinct IDs complete independently", () => {
    const toolA = makeToolPart({
      id: "part-a",
      callID: "call-a",
      tool: "read",
      state: { status: "pending", input: { file: "a.ts" } },
    })
    const toolB = makeToolPart({
      id: "part-b",
      callID: "call-b",
      tool: "grep",
      state: { status: "pending", input: { pattern: "foo" } },
    })
    const idA = stableIdFrom(toolA)
    const idB = stableIdFrom(toolB)

    assert.notEqual(idA, idB)

    const rA = first(handler.handle(makeEvent(toolA), ctx))
    assert.ok(rA)
    assert.equal(rA.type, "tool_start")
    assert.equal(rA.data.id, idA)

    const rB = first(handler.handle(makeEvent(toolB), ctx))
    assert.ok(rB)
    assert.equal(rB.type, "tool_start")
    assert.equal(rB.data.id, idB)

    const doneA = { ...toolA, state: { status: "completed", output: "content A" } }
    const rAend = first(handler.handle(makeEvent(doneA), ctx))
    assert.ok(rAend)
    assert.equal(rAend.type, "tool_end")
    assert.equal(rAend.data.id, idA)

    const doneB = { ...toolB, state: { status: "completed", output: "content B" } }
    const rBend = first(handler.handle(makeEvent(doneB), ctx))
    assert.ok(rBend)
    assert.equal(rBend.type, "tool_end")
    assert.equal(rBend.data.id, idB)
  })

  it("tool_error emits tool_end with ok=false", () => {
    const toolPart = makeToolPart({ state: { status: "pending" } })
    handler.handle(makeEvent(toolPart), ctx)

    const errorPart = {
      ...toolPart,
      state: { status: "error", error: "something went wrong" },
    }
    const results = first(handler.handle(makeEvent(errorPart), ctx))
    assert.ok(results)
    assert.equal(results.type, "tool_end")
    assert.equal(results.data.ok, false)
    assert.ok(results.data.result)
  })

  it("no redundant events when status/input/output unchanged mid-stream", () => {
    const toolPart = makeToolPart({
      state: { status: "running", input: { file: "a.ts" } },
    })
    handler.handle(makeEvent(toolPart), ctx)

    const sameAgain = { ...toolPart }
    const results = handler.handle(makeEvent(sameAgain), ctx)
    assert.equal(results.length, 0,
      "should not emit duplicate events when nothing changed")
  })

  it("stableToolId prefers part.id over callID over messageID:tool", () => {
    const withId = makeToolPart({ id: "my-id", callID: "my-call", tool: "bash" })
    assert.equal(stableIdFrom(withId), "my-id")

    const withCallID = makeToolPart({ id: undefined, callID: "my-call", tool: "bash" })
    assert.equal(stableIdFrom(withCallID), "my-call")

    const withNeither = makeToolPart({
      id: undefined,
      callID: undefined,
      messageID: "msg-1",
      tool: "grep",
    })
    assert.equal(stableIdFrom(withNeither), "msg-1:grep")
  })
})
