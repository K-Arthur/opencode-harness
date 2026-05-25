/**
 * Behavioral tests for groupConsecutiveToolCalls.
 *
 * Why this file exists: the grouper is the seam where the "wall of tool
 * rows" problem lives. The renderer suppresses step-finish chips so they
 * are invisible, but the step-finish *block* is still in `msg.blocks` —
 * if the grouper treats every non-tool block as a group-breaker, then a
 * single assistant turn that runs 6 tools (each followed by an SDK
 * step-finish event) renders as 6 separate one-element groups instead of
 * one folded group of 6. That is exactly the user-reported regression.
 *
 * These tests are behavioral (call the function, inspect the output)
 * rather than source-string assertions because the contract being locked
 * in is "what shape comes out" not "what tokens appear in the source".
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { groupConsecutiveToolCalls, renderToolGroup } from "./toolCallRenderer"
import type { Block, ToolCallBlock } from "./types"

function tool(id: string, name = "read", cls: ToolCallBlock["class"] = "read"): ToolCallBlock {
  return {
    type: "tool-call",
    id,
    name,
    class: cls,
    state: "result",
  }
}

function block(type: string, extra: Record<string, unknown> = {}): Block {
  return { type, ...extra } as unknown as Block
}

describe("groupConsecutiveToolCalls — lifecycle blocks must not break tool groups", () => {
  it("groups three consecutive tool calls separated by step-finish (normal reason) into one folded group", () => {
    const blocks: Block[] = [
      tool("t1"),
      block("step-finish", { reason: "tool-calls" }),
      tool("t2"),
      block("step-finish", { reason: "tool-calls" }),
      tool("t3"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    // Expected: a single group containing all three tools. The step-finish
    // blocks must not appear as separate groups in the visible output.
    const toolGroup = groups.find((g) => g.length >= 2 && g.every((b) => b.type === "tool-call"))
    assert.ok(toolGroup, "tool calls must be folded into one group across step-finish lifecycle blocks")
    assert.equal(toolGroup!.length, 3, "the folded group must contain all three tool calls")
  })

  it("groups two consecutive tool calls separated by step-start into one folded group", () => {
    const blocks: Block[] = [tool("t1"), block("step-start"), tool("t2")]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    const toolGroup = groups.find((g) => g.length >= 2 && g.every((b) => b.type === "tool-call"))
    assert.ok(toolGroup, "step-start (always invisible) must not break tool grouping")
    assert.equal(toolGroup!.length, 2)
  })

  it("groups tools across hyphenated finish reasons (tool-calls, end-turn) too", () => {
    const blocks: Block[] = [
      tool("t1"),
      block("step-finish", { reason: "end-turn" }),
      tool("t2"),
      block("step-finish", { reason: "stop-sequence" }),
      tool("t3"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    const toolGroup = groups.find((g) => g.length === 3)
    assert.ok(toolGroup, "hyphenated normal-finish reasons must be transparent to the grouper")
  })

  it("DOES break the group on a visible text block (text is real content, not lifecycle)", () => {
    const blocks: Block[] = [
      tool("t1"),
      block("text", { text: "Now let me check the actual interfaces." }),
      tool("t2"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    // Each tool ends up in its own group when separated by a text block.
    const toolGroups = groups.filter((g) => g.every((b) => b.type === "tool-call"))
    assert.equal(toolGroups.length, 2, "text content between tool calls must legitimately break grouping")
  })

  it("DOES break the group on an abnormal step-finish (length, content_filter, error)", () => {
    const blocks: Block[] = [
      tool("t1"),
      block("step-finish", { reason: "length" }),
      tool("t2"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    const toolGroups = groups.filter((g) => g.every((b) => b.type === "tool-call"))
    assert.equal(
      toolGroups.length,
      2,
      "abnormal step-finish reasons render as a visible chip, so they should break tool grouping",
    )
  })

  it("does not drop lifecycle blocks — they still appear in the flat output for downstream renderers", () => {
    const blocks: Block[] = [
      tool("t1"),
      block("step-finish", { reason: "tool-calls" }),
      tool("t2"),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    // The step-finish block is suppressed visually (renderStepFinishBlock
    // returns null), but the grouper must not silently lose it — keeping it
    // in the flat sequence preserves the option to surface it later (e.g.
    // for debug overlays or token accounting). Ordering between the
    // lifecycle block and the surrounding tool group is intentionally not
    // specified, since the tool group is now the visible unit.
    const flat = groups.flat()
    const types = flat.map((b) => b.type).sort()
    assert.deepEqual(
      types,
      ["step-finish", "tool-call", "tool-call"],
      "groupConsecutiveToolCalls must include every input block in its output",
    )
  })

  it("handles only-lifecycle blocks (no tools) without producing tool groups", () => {
    const blocks: Block[] = [block("step-start"), block("step-finish", { reason: "stop" })]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    const toolGroups = groups.filter((g) => g.some((b) => b.type === "tool-call"))
    assert.equal(toolGroups.length, 0)
  })

  it("handles tools-then-lifecycle-tail without breaking the leading tool group", () => {
    const blocks: Block[] = [
      tool("t1"),
      tool("t2"),
      block("step-finish", { reason: "tool-calls" }),
    ]
    const groups = groupConsecutiveToolCalls(blocks, "consecutive")
    const toolGroup = groups.find((g) => g.every((b) => b.type === "tool-call") && g.length === 2)
    assert.ok(toolGroup, "trailing lifecycle blocks must not split the preceding tool run")
  })

  it("renders mixed tool groups as tools, not as the first tool type", () => {
    const dom = new JSDOM("<!doctype html><body></body>")
    const previousDocument = globalThis.document
    const previousWindow = globalThis.window
    ;(globalThis as unknown as { document: Document }).document = dom.window.document
    ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
    try {
      const group = renderToolGroup([
        tool("t1", "read", "read"),
        tool("t2", "edit", "write"),
        tool("t3", "bash", "exec"),
      ], {})
      assert.ok(group)
      assert.ok(group!.classList.contains("tool-call--mixed"), "mixed groups must get mixed styling")
      assert.equal(group!.querySelector(".tool-name")?.textContent, "tools")
      assert.match(group!.textContent ?? "", /1 read/)
      assert.match(group!.textContent ?? "", /1 write/)
      assert.match(group!.textContent ?? "", /1 exec/)
    } finally {
      ;(globalThis as unknown as { document: Document | undefined }).document = previousDocument
      ;(globalThis as unknown as { window: Window | undefined }).window = previousWindow
    }
  })
})
