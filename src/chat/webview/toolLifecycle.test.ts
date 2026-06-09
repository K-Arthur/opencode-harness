/**
 * Integration tests for tool call lifecycle: start → update → end,
 * unresolved finalization, and error path handling.
 *
 * Tests the contract between:
 *   - finishUnresolvedToolCalls (model-level finalization)
 *   - toolBadgeText (UI badge rendering)
 *   - groupConsecutiveToolCalls (visual grouping)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { JSDOM } from "jsdom"
import { groupConsecutiveToolCalls } from "./toolCallRenderer"
import type { Block, ToolCallBlock, ToolCallState } from "./types"

const handlersSource = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")

function tool(id: string, name = "read", state: ToolCallState = "result", cls: ToolCallBlock["class"] = "read"): ToolCallBlock {
  return { type: "tool-call", id, name, class: cls, state }
}

function textBlock(text: string): Block {
  return { type: "text", text } as Block
}

function stepFinish(reason = ""): Block {
  return { type: "step-finish", reason } as Block
}

function stepStart(): Block {
  return { type: "step-start" } as Block
}

// ---------------------------------------------------------------------------
// C2 / Follow-up #3: finishUnresolvedToolCalls uses 'unresolved' state
// ---------------------------------------------------------------------------

describe("finishUnresolvedToolCalls — unresolved state", () => {
  it("marks pending tools as 'unresolved' with an error message", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function finishUnresolvedToolCalls(")
    const fnBody = source.slice(fnStart, source.indexOf("\n}", fnStart) + 2)

    assert.ok(fnBody.includes('state: "unresolved"'), "finishUnresolvedToolCalls must set state to 'unresolved'")
    assert.ok(fnBody.includes("error:"), "finishUnresolvedToolCalls must include an error field")
  })

  it("'unresolved' is a valid ToolCallState value", () => {
    const typesSource = readFileSync(path.join(__dirname, "types.ts"), "utf8")
    const stateLine = typesSource.match(/type ToolCallState\s*=\s*[^\n]+/)
    assert.ok(stateLine, "ToolCallState type must exist")
    assert.ok(stateLine[0].includes("'unresolved'"), "ToolCallState must include 'unresolved'")
  })

  it("new ToolCallState variants are valid: cancelled, timed_out, retried", () => {
    const typesSource = readFileSync(path.join(__dirname, "types.ts"), "utf8")
    const stateLine = typesSource.match(/type ToolCallState\s*=\s*[^\n]+/)
    assert.ok(stateLine, "ToolCallState type must exist")
    assert.ok(stateLine[0].includes("'cancelled'"), "ToolCallState must include 'cancelled'")
    assert.ok(stateLine[0].includes("'timed_out'"), "ToolCallState must include 'timed_out'")
    assert.ok(stateLine[0].includes("'retried'"), "ToolCallState must include 'retried'")
  })
})

// ---------------------------------------------------------------------------
// C3: handleStreamError finalizes unresolved tool calls
// ---------------------------------------------------------------------------

describe("handleStreamError — tool finalization", () => {
  it("calls finishUnresolvedToolCalls for messages with content before resetStreamState", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function handleStreamError(")
    const fnEnd = source.indexOf("}\n\nexport function handleRequestError(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    const finishCallIdx = fnBody.indexOf("finishUnresolvedToolCalls(msgObj.blocks)")
    const resetCallIdx = fnBody.indexOf("resetStreamState(state)")

    assert.ok(finishCallIdx > 0, "handleStreamError must call finishUnresolvedToolCalls")
    assert.ok(resetCallIdx > finishCallIdx, "finishUnresolvedToolCalls must be called before resetStreamState")
  })
})

// ---------------------------------------------------------------------------
// C4: handleStreamError carries actionButtons from ErrorContext
// ---------------------------------------------------------------------------

describe("handleStreamError — actionButtons passthrough", () => {
  it("passes suggestedActions from errorContext to createErrorBlock as actionButtons", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function handleStreamError(")
    const fnEnd = source.indexOf("}\n\nexport function handleRequestError(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(fnBody.includes("errorContext.suggestedActions"), "must read suggestedActions from errorContext")
    assert.ok(fnBody.includes(".map(a => ("), "must map ErrorAction to ErrorActionButton shape")
    assert.ok(fnBody.includes("actionButtons:"), "must pass actionButtons to createErrorBlock")
  })

  it("includes technicalDetails from errorContext in createErrorBlock detail field", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function handleStreamError(")
    const fnEnd = source.indexOf("}\n\nexport function handleRequestError(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(fnBody.includes("errorContext.technicalDetails"), "must read technicalDetails from errorContext")
    assert.ok(fnBody.includes("createErrorBlock("), "technicalDetails must be passed to createErrorBlock")
  })

  it("passes errorContext.retryable to createErrorBlock", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function handleStreamError(")
    const fnEnd = source.indexOf("}\n\nexport function handleRequestError(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(fnBody.includes("errorContext.retryable"), "must pass retryable through from errorContext")
  })
})

// ---------------------------------------------------------------------------
// M5: handleToolEnd prevents duplicate duration spans
// ---------------------------------------------------------------------------

describe("handleToolEnd — duplicate duration prevention", () => {
  it("reuses existing .tool-duration element instead of creating a new one", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("export function handleToolEnd(")
    const fnEnd = source.indexOf("}\n\nexport function handleDiff(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(
      fnBody.includes('querySelector(".tool-duration")'),
      "handleToolEnd must check for existing .tool-duration before creating a new one"
    )
  })
})

// ---------------------------------------------------------------------------
// Follow-up #1: Multi-tool concurrent lifecycle (grouping)
// ---------------------------------------------------------------------------

describe("multi-tool concurrent lifecycle", () => {
  it("groups 3 consecutive tools into a single group", () => {
    const blocks: Block[] = [
      textBlock("Let me check"),
      tool("t1", "Read"),
      tool("t2", "Grep"),
      tool("t3", "Read"),
    ]
    const groups = groupConsecutiveToolCalls(blocks)
    assert.equal(groups.length, 2, "text + 1 tool group")
    assert.ok(groups[0])
    assert.equal(groups[0]!.length, 1, "text block is its own group")
    assert.ok(groups[1])
    assert.equal(groups[1]!.length, 3, "three tools in one group")
  })

  it("does not break grouping when step-finish blocks are interspersed", () => {
    const blocks: Block[] = [
      tool("t1", "Read"),
      stepFinish("tool_use"),
      tool("t2", "Read"),
      stepFinish("tool_use"),
      tool("t3", "Write", "result", "write"),
    ]
    const groups = groupConsecutiveToolCalls(blocks)
    const toolGroups = groups.filter(g => g.some(b => b.type === "tool-call"))
    assert.equal(toolGroups.length, 1, "all tools in a single tool group")
    const allTools = toolGroups[0]!.filter(b => b.type === "tool-call")
    assert.equal(allTools.length, 3, "all 3 tool blocks present in the group")

    const lifecycleGroups = groups.filter(g => g.every(b => b.type === "step-finish"))
    assert.equal(lifecycleGroups.length, 2, "deferred lifecycle blocks emitted as separate groups after")
  })

  it("breaks group when a text block appears between tools", () => {
    const blocks: Block[] = [
      tool("t1", "Read"),
      textBlock("intermediate text"),
      tool("t2", "Read"),
    ]
    const groups = groupConsecutiveToolCalls(blocks)
    assert.equal(groups.length, 3, "3 separate groups: tool, text, tool")
  })

  it("groups tools by name when groupBy='name'", () => {
    const blocks: Block[] = [
      tool("t1", "Read"),
      tool("t2", "Read"),
      tool("t3", "Write", "result", "write"),
      tool("t4", "Write", "result", "write"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "name")
    assert.equal(groups.length, 2, "2 groups: Read pair + Write pair")
    assert.ok(groups[0] && groups[1])
    assert.equal(groups[0]!.length, 2, "Read group has 2")
    assert.equal(groups[1]!.length, 2, "Write group has 2")
  })

  it("groups tools by class when groupBy='type'", () => {
    const blocks: Block[] = [
      tool("t1", "ReadFile", "result", "read"),
      tool("t2", "Grep", "result", "read"),
      tool("t3", "Edit", "result", "write"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "type")
    assert.equal(groups.length, 2, "2 groups: read pair + write")
    assert.ok(groups[0] && groups[1])
    assert.equal(groups[0]!.length, 2, "read group has 2")
    assert.equal(groups[1]!.length, 1, "write group has 1")
  })

  it("step-start blocks inside a tool run are deferred, not lost", () => {
    const blocks: Block[] = [
      tool("t1", "Read"),
      stepStart(),
      tool("t2", "Read"),
    ]
    const groups = groupConsecutiveToolCalls(blocks)
    const toolGroups = groups.filter(g => g.some(b => b.type === "tool-call"))
    assert.equal(toolGroups.length, 1, "single tool group containing both tools")
    assert.ok(toolGroups[0])
    const toolBlocks = toolGroups[0]!.filter(b => b.type === "tool-call")
    assert.equal(toolBlocks.length, 2, "2 tool blocks in the group")

    const stepStartGroup = groups.find(g => g.some(b => b.type === "step-start"))
    assert.ok(stepStartGroup, "deferred step-start is emitted as its own group")
    assert.equal(stepStartGroup!.length, 1)
  })

  it("empty block list returns empty groups", () => {
    const groups = groupConsecutiveToolCalls([])
    assert.deepEqual(groups, [])
  })

  it("single tool returns single one-element group", () => {
    const groups = groupConsecutiveToolCalls([tool("t1")])
    assert.equal(groups.length, 1)
    assert.ok(groups[0])
    assert.equal(groups[0]!.length, 1)
  })
})

// ---------------------------------------------------------------------------
// C1: postToolEnd uses most-recently-active heuristic (structural check)
// ---------------------------------------------------------------------------

describe("postToolEnd fallback heuristic", () => {
  it("uses activity-based fallback instead of arbitrary Set.values().next()", () => {
    const source = readFileSync(path.join(__dirname, "../handlers/StreamCoordinator.ts"), "utf8")
    const fnStart = source.indexOf("private postToolEnd(")
    const fnEnd = source.indexOf("return true", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(
      !fnBody.includes("pending?.values().next().value") && !fnBody.includes("pending?.values().next()"),
      "postToolEnd must NOT use bare Set.values().next() fallback"
    )
    assert.ok(
      fnBody.includes("pending.size === 1") || fnBody.includes("pending.size > 1"),
      "postToolEnd must distinguish between single and multi-pending scenarios"
    )
    assert.ok(
      fnBody.includes("toolActivityAt") || fnBody.includes("activity"),
      "postToolEnd multi-pending fallback must use activity timestamps"
    )
  })
})

// ---------------------------------------------------------------------------
// M2: reconciliation loop uses break instead of return
// ---------------------------------------------------------------------------

describe("reconcilePendingToolCallsFromServer — loop exit", () => {
  it("uses break (not return) to exit the reconciliation loop early", () => {
    const source = readFileSync(path.join(__dirname, "../handlers/StreamCoordinator.ts"), "utf8")
    const fnStart = source.indexOf("private async reconcilePendingToolCallsFromServer(")
    const fnEnd = source.indexOf("private stableToolPartId(", fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    const earlyExitLine = fnBody.indexOf("currentPending.size === 0)")
    assert.ok(earlyExitLine > 0, "must find the early exit check in reconciliation loop")
    const afterCheck = fnBody.slice(earlyExitLine, earlyExitLine + 50)
    assert.ok(
      afterCheck.includes("break") && !afterCheck.includes("return"),
      `reconciliation loop early exit must use 'break', got: ${afterCheck.trim()}`
    )
  })
})

// ---------------------------------------------------------------------------
// Follow-up #6: index signatures removed from discriminated types
// ---------------------------------------------------------------------------

describe("type hygiene — discriminated types maintain typed fields", () => {
  it("ToolCallBlock has all explicitly typed fields", () => {
    const source = readFileSync(path.join(__dirname, "types.ts"), "utf8")
    const blockStart = source.indexOf("export interface ToolCallBlock {")
    const blockEnd = source.indexOf("}\n", blockStart) + 2
    const blockBody = source.slice(blockStart, blockEnd)

    const requiredFields = ["type: 'tool-call'", "id: string", "name: string", "class: ToolCallClass", "state: ToolCallState"]
    for (const field of requiredFields) {
      assert.ok(blockBody.includes(field), `ToolCallBlock must have typed field: ${field}`)
    }
  })

  it("ThinkingBlock has all explicitly typed fields", () => {
    const source = readFileSync(path.join(__dirname, "types.ts"), "utf8")
    const blockStart = source.indexOf("export interface ThinkingBlock {")
    const blockEnd = source.indexOf("}\n", blockStart) + 2
    const blockBody = source.slice(blockStart, blockEnd)

    const requiredFields = ["type: 'thinking'", "content: string", "streaming: boolean"]
    for (const field of requiredFields) {
      assert.ok(blockBody.includes(field), `ThinkingBlock must have typed field: ${field}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Follow-up #5: toolBadgeText handles 'unresolved' state
// ---------------------------------------------------------------------------

describe("toolBadgeText — unresolved state badge", () => {
  it("renders a warning badge for 'unresolved' state", () => {
    const source = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")
    const fnStart = source.indexOf("function toolBadgeText(")
    const fnEnd = source.indexOf("}\n", fnStart) + 2
    const fnBody = source.slice(fnStart, fnEnd)

    assert.ok(fnBody.includes('"unresolved"'), "toolBadgeText must handle 'unresolved' state")
    assert.ok(
      fnBody.includes("Incomplete") || fnBody.includes("incomplete") || fnBody.includes("Unresolved"),
      "unresolved badge must indicate incomplete status"
    )
  })
})
