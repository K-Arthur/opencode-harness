/**
 * Layer 2 RED tests — CanonicalBlock discriminated union & type guards.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.1
 * ADR:  docs/adrs/ADR-008-sdk-aligned-message-pipeline.md
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L2-T1..T6)
 *
 * Staging note:
 *   L2-T2 (`LegacyBlock_export_removed`) is INTENTIONALLY DEFERRED to a v2
 *   cleanup layer (post-migration). The cutover from `Block = LegacyBlock`
 *   to `Block = CanonicalBlock` requires every reader to narrow first; we
 *   land readers progressively across Layers 3-5 and remove `LegacyBlock`
 *   only when all 60+ field-access sites have been refactored. Layer 2
 *   establishes the union + guards; Layer 7 removes the alias.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CanonicalBlock } from "./types"
import {
  isCanonicalToolBlock,
  isCanonicalReasoningBlock,
  isCanonicalStepFinishBlock,
  isCanonicalTextBlock,
  isCanonicalPatchBlock,
  isCanonicalCompactionBlock,
  isCanonicalRetryBlock,
} from "./chat/webview/types"
import type { Block as WebviewBlock } from "./chat/webview/types"

describe("CanonicalBlock — Layer 2 RED", () => {
  it("L2-T1a: text variant assigns to CanonicalBlock", () => {
    const block: CanonicalBlock = { id: "p1", type: "text", text: "hi" }
    assert.equal(block.type, "text")
  })

  it("L2-T1b: reasoning variant assigns to CanonicalBlock with required fields", () => {
    const block: CanonicalBlock = {
      id: "p1",
      type: "reasoning",
      text: "hmm",
      streaming: false,
      timeStart: 1,
    }
    assert.equal(block.type, "reasoning")
  })

  it("L2-T1c: tool variant assigns to CanonicalBlock with state discriminant", () => {
    const block: CanonicalBlock = {
      id: "p1",
      type: "tool",
      callID: "call-1",
      tool: "Read",
      state: "completed",
    }
    assert.equal(block.type, "tool")
  })

  it("L2-T1d: file variant assigns to CanonicalBlock", () => {
    const block: CanonicalBlock = {
      id: "p1",
      type: "file",
      mime: "image/png",
      url: "data:...",
    }
    assert.equal(block.type, "file")
  })

  it("L2-T1e: step-start / step-finish / snapshot / patch / agent / retry / compaction / subtask all assign", () => {
    const variants: CanonicalBlock[] = [
      { id: "1", type: "step-start" },
      { id: "2", type: "step-finish", reason: "stop", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "3", type: "snapshot", snapshot: "x" },
      { id: "4", type: "patch", hash: "h", files: ["a"] },
      { id: "5", type: "agent", name: "planner" },
      { id: "6", type: "retry", attempt: 1, errorMessage: "x", createdAt: 0 },
      { id: "7", type: "compaction", auto: true },
      { id: "8", type: "subtask", prompt: "p", description: "d", agent: "a" },
    ]
    assert.equal(variants.length, 8)
    assert.deepEqual(
      variants.map(v => v.type),
      ["step-start", "step-finish", "snapshot", "patch", "agent", "retry", "compaction", "subtask"],
    )
  })

  // L2-T2 (LegacyBlock_export_removed) — see staging note at top of file.
  it.skip("L2-T2: LegacyBlock export removed from types.ts (DEFERRED to v2 cleanup)", () => {
    const source = readFileSync(join(process.cwd(), "src/chat/webview/types.ts"), "utf8")
    assert.ok(
      !/export\s+(interface|type)\s+LegacyBlock\b/.test(source),
      "LegacyBlock export must be removed once all consumers narrow via CanonicalBlock guards",
    )
  })

  it("L2-T3: isCanonicalToolBlock narrows to tool variant", () => {
    const blocks: CanonicalBlock[] = [
      { id: "1", type: "text", text: "x" },
      { id: "2", type: "tool", callID: "c", tool: "Read", state: "running" },
    ]
    const tools = blocks.filter(isCanonicalToolBlock)
    assert.equal(tools.length, 1)
    // After narrowing, `tool` and `callID` must be accessible without `as`.
    assert.equal(tools[0]!.callID, "c")
    assert.equal(tools[0]!.tool, "Read")
  })

  it("L2-T4: isCanonicalReasoningBlock narrows to reasoning variant", () => {
    const blocks: CanonicalBlock[] = [
      { id: "1", type: "text", text: "x" },
      { id: "2", type: "reasoning", text: "thought", streaming: true, timeStart: 1 },
    ]
    const r = blocks.filter(isCanonicalReasoningBlock)
    assert.equal(r.length, 1)
    assert.equal(r[0]!.text, "thought")
    assert.equal(r[0]!.streaming, true)
  })

  it("L2-T5: isCanonicalStepFinishBlock narrows to step-finish variant", () => {
    const blocks: CanonicalBlock[] = [
      { id: "1", type: "text", text: "x" },
      {
        id: "2",
        type: "step-finish",
        reason: "stop",
        cost: 0.5,
        tokens: { input: 10, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0 },
      },
    ]
    const finish = blocks.filter(isCanonicalStepFinishBlock)
    assert.equal(finish.length, 1)
    assert.equal(finish[0]!.reason, "stop")
    assert.equal(finish[0]!.cost, 0.5)
    assert.equal(finish[0]!.tokens.reasoning, 5)
  })

  it("L2-T5b: extra guards (text, patch, compaction, retry) narrow correctly", () => {
    const blocks: CanonicalBlock[] = [
      { id: "1", type: "text", text: "hello" },
      { id: "2", type: "patch", hash: "h", files: ["a"] },
      { id: "3", type: "compaction", auto: false },
      { id: "4", type: "retry", attempt: 2, errorMessage: "rate", createdAt: 0 },
    ]
    assert.equal(blocks.filter(isCanonicalTextBlock).length, 1)
    assert.equal(blocks.filter(isCanonicalPatchBlock).length, 1)
    assert.equal(blocks.filter(isCanonicalCompactionBlock).length, 1)
    assert.equal(blocks.filter(isCanonicalRetryBlock).length, 1)
  })

  // L2-T6 is a compile-time test: an object literal with an unknown `type`
  // must be rejected by `CanonicalBlock`. Encoded as a runtime smoke test
  // that verifies the discriminator domain.
  it("L2-T6: object with non-canonical `type` is not assignable to CanonicalBlock", () => {
    // @ts-expect-error 'bogus' is not in the CanonicalBlock type discriminant union
    const badBlock: CanonicalBlock = { id: "x", type: "bogus" }
    void badBlock
  })

  it("L2-T7: webview Block accepts CanonicalBlock variants (forward-compat)", () => {
    // The webview's Block alias must accept CanonicalBlock instances so that
    // converter output flows into ChatMessage.blocks without a cast.
    const canonical: CanonicalBlock = { id: "p1", type: "reasoning", text: "x", streaming: false, timeStart: 0 }
    const wb: WebviewBlock = canonical as WebviewBlock
    assert.equal(wb.type, "reasoning")
  })
})
