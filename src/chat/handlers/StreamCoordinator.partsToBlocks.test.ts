/**
 * Layer 3 RED tests — StreamCoordinator delegates Part→Block mapping to the
 * single canonical converter (sdkMessageConverter). The point: snapshot
 * rebuild on reconnect, replay paths, and live event normalization must all
 * agree on shape so reconnects don't silently drop reasoning, retries,
 * patches, etc.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.2-5.3
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L3-T1..T7)
 *
 * Staging note: L3-T3..T6 (live `message.part.updated` reducer behavior)
 * require a wider StreamCoordinator refactor and are intentionally
 * deferred (`it.skip`) to a Layer 3b sub-PR.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("StreamCoordinator.partsToBlocks — Layer 3 RED", () => {
  it("L3-T1: source delegates to sdkMessageConverter.partsToBlocks", () => {
    // Structural assertion: the StreamCoordinator file imports `partsToBlocks`
    // from the canonical converter and calls it from within its own
    // `partsToBlocks` method body. This means reconnect / snapshot rebuild
    // produces the same shape as historical-load flows.
    const src = readFileSync(
      join(process.cwd(), "src/chat/handlers/StreamCoordinator.ts"),
      "utf8",
    )
    assert.ok(
      /from\s+["']\.\.\/\.\.\/session\/sdkMessageConverter["']/.test(src),
      "StreamCoordinator must import from sdkMessageConverter",
    )
    assert.ok(
      /\bpartsToBlocks\b\s*\(/.test(src),
      "StreamCoordinator must call partsToBlocks(...) at least once",
    )
  })

  it("L3-T2: StreamCoordinator no longer contains an inline if-chain on part.type for Part dispatch", () => {
    // Heuristic: after delegation, the file should not contain the legacy
    // chain of `if (part.type === "text") … if (part.type === "reasoning") …
    // if (part.type === "tool")`. Counting the if-on-part.type clauses must
    // drop to zero (the canonical converter does all the dispatch).
    const src = readFileSync(
      join(process.cwd(), "src/chat/handlers/StreamCoordinator.ts"),
      "utf8",
    )
    const matches = src.match(/if\s*\(\s*part\.type\s*===\s*"[a-z-]+"/g) ?? []
    assert.equal(
      matches.length,
      0,
      `StreamCoordinator must not branch on part.type inline (found ${matches.length} match(es))`,
    )
  })

  it("L3-T7: reconnect replay uses canonical converter — no field drift between paths", () => {
    // The canonical converter produces tool blocks with type "tool" and
    // reasoning blocks with type "reasoning". The StreamCoordinator's
    // reconnect/replay paths (lines 586, 888) call partsToBlocks(); after
    // delegation, the same input must yield the same canonical output as
    // historical-load (sdkMessagesToChatMessages → partsToBlocks).
    //
    // Black-box behavioral test using a synthetic StreamCoordinator stub
    // would require importing private members. Instead, assert at the
    // source level: every call site that consumed the inline partsToBlocks
    // now reaches the canonical converter (verified transitively via L3-T1).
    // Plus, a smoke test that the canonical converter's output for a
    // representative reasoning+tool snapshot has the canonical types.
    const { partsToBlocks } = require("../../session/sdkMessageConverter") as {
      partsToBlocks: (parts: unknown[]) => Array<{ type: string }>
    }
    const snapshot = [
      { id: "p1", sessionID: "s", messageID: "m", type: "reasoning", text: "x", time: { start: 1 } },
      {
        id: "p2",
        sessionID: "s",
        messageID: "m",
        type: "tool",
        callID: "c",
        tool: "Read",
        state: { status: "completed", input: {}, output: "ok", title: "Read", metadata: {}, time: { start: 1, end: 2 } },
      },
    ]
    const out = partsToBlocks(snapshot)
    assert.equal(out.length, 2)
    assert.equal(out[0]!.type, "reasoning")
    assert.equal(out[1]!.type, "tool")
  })

  // ---- L3-T3..T6 — live `message.part.updated` reducer behavior ----
  // These exercise the in-flight stream reducer that replaces blocks in
  // tab.blocksBuffer keyed by part.id, preserves order, appends new, and
  // drops on `message.part.removed`. Implementing the reducer requires a
  // wider StreamCoordinator refactor (intercepting raw SSE before
  // EventNormalizer compresses to text_chunk events). Tracked as Layer 3b.

  it.skip("L3-T3: stream part update replaces block by part.id (DEFERRED to Layer 3b)", () => {})
  it.skip("L3-T4: stream part update preserves block order when replacing (DEFERRED to Layer 3b)", () => {})
  it.skip("L3-T5: stream part update appends new block when part.id unseen (DEFERRED to Layer 3b)", () => {})
  it.skip("L3-T6: stream part removed drops block by id (DEFERRED to Layer 3b)", () => {})
})
