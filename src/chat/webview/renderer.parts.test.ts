/**
 * Layer 7 RED tests — render the SDK part types that were previously
 * silently dropped: step-start, step-finish, snapshot, patch, agent,
 * retry, compaction, subtask.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5 (A5)
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L7-T1..T8)
 *
 * Structural pattern: existing renderer.test.ts asserts on source text
 * (the file imports DOM globals so behavioral tests would need jsdom).
 * We follow that convention here: each canonical type must (a) have a
 * dedicated renderer function and (b) be registered in RENDERER_MAP.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(__dirname, "renderer.ts"), "utf8")

function assertRenderer(blockType: string, renderFnName: string, label: string): void {
  assert.match(
    source,
    new RegExp(`function\\s+${renderFnName}\\b`),
    `${label}: missing render function ${renderFnName}`,
  )
  assert.match(
    source,
    new RegExp(`'${blockType}'\\s*:\\s*${renderFnName}`),
    `${label}: '${blockType}' must dispatch to ${renderFnName} in RENDERER_MAP`,
  )
}

describe("renderer — Layer 7 RED (canonical part renderers)", () => {
  it("L7-T1: step-start is dispatched but produces no visible chip", () => {
    // step-start is a noisy SDK lifecycle event that adds nothing visible
    // for end users (the token bar + model badge already convey progress).
    // The renderer must still be wired so the dispatch table stays complete,
    // but it must return null so no chip ends up in the bubble.
    assertRenderer("step-start", "renderStepStartBlock", "L7-T1")
    const body = source.slice(
      source.indexOf("function renderStepStartBlock"),
      source.indexOf("function renderStepFinishBlock"),
    )
    assert.match(body, /return null/, "renderStepStartBlock must return null")
    assert.ok(
      !/Step started/.test(body),
      "renderStepStartBlock must not emit the 'Step started' string (was leaking into the chat as a raw line)",
    )
  })

  it("L7-T2: step-finish renders only for abnormal endings", () => {
    assertRenderer("step-finish", "renderStepFinishBlock", "L7-T2")
    const body = source.slice(source.indexOf("function renderStepFinishBlock"))
    // Renderer must consult reason + tokens — the SDK fields haven't gone away,
    // we just changed what we do with them.
    assert.match(body, /block\.reason|reason/, "step-finish renderer must consult block.reason")
    assert.match(body, /tokens/, "step-finish renderer must consult block.tokens")
    // Normal 'stop' completion must NOT render a chip — that was the
    // "Step finished (stop) — in:X out:Y reasoning:Z" line cluttering chats.
    assert.match(
      body,
      /reason\s*===\s*["']stop["']|stop["']\s*===|NORMAL_FINISH/,
      "step-finish must short-circuit when reason === 'stop' (normal completion)",
    )
    assert.match(body, /return null/, "step-finish must return null for the normal 'stop' case")
  })

  it("L7-T3: patch renders as file list summary", () => {
    assertRenderer("patch", "renderPatchBlock", "L7-T3")
    const body = source.slice(source.indexOf("function renderPatchBlock"))
    assert.match(body, /block\.files|files/, "patch renderer must consult block.files")
  })

  it("L7-T4: compaction renders as fold marker", () => {
    assertRenderer("compaction", "renderCompactionBlock", "L7-T4")
    const body = source.slice(source.indexOf("function renderCompactionBlock"))
    assert.match(body, /block\.auto|auto/, "compaction renderer must consult block.auto")
  })

  it("L7-T5: retry renders as warning chip", () => {
    assertRenderer("retry", "renderRetryBlock", "L7-T5")
    const body = source.slice(source.indexOf("function renderRetryBlock"))
    assert.match(body, /attempt/, "retry renderer must show attempt number")
    assert.match(body, /errorMessage|error/, "retry renderer must show error message")
  })

  it("L7-T6: agent renders as agent indicator", () => {
    assertRenderer("agent", "renderAgentBlock", "L7-T6")
    const body = source.slice(source.indexOf("function renderAgentBlock"))
    assert.match(body, /block\.name|name/, "agent renderer must consult block.name")
  })

  it("L7-T7: subtask renders as nested block", () => {
    assertRenderer("subtask", "renderSubtaskBlock", "L7-T7")
    const body = source.slice(source.indexOf("function renderSubtaskBlock"))
    assert.match(body, /agent/, "subtask renderer must show the target agent")
    assert.match(body, /description/, "subtask renderer must show description")
  })

  it("L7-T8: snapshot renders as timeline marker", () => {
    assertRenderer("snapshot", "renderSnapshotBlock", "L7-T8")
  })

  it("L7 structural completeness: every canonical Part type has a renderer entry", () => {
    // Sanity check that no SDK part type is silently dropped post-Layer 7.
    // Reasoning is handled by renderThinkingBlock; everything else has its
    // own renderer. Tool is handled by renderToolCallBlock.
    const expected = [
      ["text", "renderTextBlock"],
      ["reasoning", "renderThinkingBlock"],
      ["tool", "renderToolCallBlock"],
      ["step-start", "renderStepStartBlock"],
      ["step-finish", "renderStepFinishBlock"],
      ["snapshot", "renderSnapshotBlock"],
      ["patch", "renderPatchBlock"],
      ["agent", "renderAgentBlock"],
      ["retry", "renderRetryBlock"],
      ["compaction", "renderCompactionBlock"],
      ["subtask", "renderSubtaskBlock"],
    ] as const
    for (const [t, fn] of expected) {
      assert.match(
        source,
        new RegExp(`'${t}'\\s*:\\s*${fn}`),
        `RENDERER_MAP missing entry: '${t}' → ${fn}`,
      )
    }
  })
})
