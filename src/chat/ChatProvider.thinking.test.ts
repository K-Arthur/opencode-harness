/**
 * Layer 4 RED tests — ChatProvider's "thinking" SSE event handler delegates
 * to the canonical sdkMessageConverter so the in-flight "thinking" block
 * has the same shape as historical and reconnect-rebuilt reasoning blocks.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.2
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L4-T1..T3)
 *
 * The handler itself is an inline closure inside a Map literal at
 * src/chat/ChatProvider.ts:621; testing it black-box is impractical without
 * spinning up the whole provider. Instead we land a small pure helper
 * (`reasoningEventToBlock`) on sdkMessageConverter, point ChatProvider at
 * it, and test the helper. Source-level assertions verify the wiring.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { reasoningEventToBlock } from "../session/sdkMessageConverter"

describe("ChatProvider thinking handler — Layer 4 RED", () => {
  it("L4-T1: reasoningEventToBlock produces a canonical 'reasoning' block via the converter", () => {
    const block = reasoningEventToBlock({ text: "thinking out loud", timeStart: 100 })
    assert.ok(block)
    assert.equal(block!.type, "reasoning")
    // Use loose access to avoid coupling the test to discriminated narrowing —
    // we're asserting the canonical shape regardless of TS view.
    const f = block as unknown as Record<string, unknown>
    assert.equal(f.text, "thinking out loud")
  })

  it("L4-T2: reasoningEventToBlock sets streaming: true by default (in-flight UX)", () => {
    const block = reasoningEventToBlock({ text: "x" })
    const f = block as unknown as Record<string, unknown>
    assert.equal(f.streaming, true)
  })

  it("L4-T3: reasoningEventToBlock uses canonical 'text' field, not legacy 'content'", () => {
    const block = reasoningEventToBlock({ text: "x" })
    const f = block as unknown as Record<string, unknown>
    assert.equal(typeof f.text, "string")
    assert.equal(f.content, undefined, "legacy 'content' field must not be present on canonical reasoning block")
  })

  it("L4-T4 (structural): ChatProvider's thinking handler delegates to reasoningEventToBlock", () => {
    const src = readFileSync(join(process.cwd(), "src/chat/ChatProvider.ts"), "utf8")
    assert.match(
      src,
      /reasoningEventToBlock\s*\(/,
      "ChatProvider must call reasoningEventToBlock so the thinking event uses the canonical converter",
    )
    // Negative assertion: the hand-rolled `{ type: "thinking", content: ... }`
    // literal must be gone, so the block shape is owned by the converter.
    assert.doesNotMatch(
      src,
      /type:\s*"thinking",\s*content:/,
      "ChatProvider must not construct legacy { type: 'thinking', content: ... } blocks directly",
    )
  })

  it("L4-T5: empty text input returns null (no spurious blocks)", () => {
    assert.equal(reasoningEventToBlock({ text: "" }), null)
    assert.equal(reasoningEventToBlock({ text: "   " }), null)
    assert.equal(reasoningEventToBlock({ text: undefined }), null)
  })
})
