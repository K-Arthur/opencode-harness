/**
 * RED phase tests for the two finalize-path regressions found in the
 * 2026-07-02 log analysis:
 *
 * Bug 1 (deadlock): the G5 quiet-period defer timer re-entered the PUBLIC
 *   maybeFinalizeStream, which found its own still-pending promise in
 *   finalizePromises and chained onto it — circular wait, the stream never
 *   finalized ("deferring status finalize …" then silence forever).
 *   The timer callback must call the internal runMaybeFinalizeStream directly.
 *
 * Bug 2 (wrong message): session.messages with `limit` returns NEWEST-first
 *   (server: orderBy desc, limit branch returns .items unreversed), while the
 *   no-limit path returns oldest-first. fetchFinalBlocks assumed oldest-first
 *   and did [...messages].reverse().find(assistant) — picking the OLDEST
 *   assistant in the window, i.e. the previous turn's response. The selection
 *   must be order-independent: pick the assistant with the greatest
 *   time.created (id as tiebreak).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pickLatestAssistant } from "./finalMessagePicker"

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const source = readFileSync(path.join(__dirname, "StreamCoordinator.ts"), "utf8")

/** Fixed-size slice from a marker — brace-matching breaks on `{` inside
 *  return-type annotations (e.g. `Promise<{ blocks: ... }>`), so structural
 *  tests in this repo scan bounded windows instead. */
function sliceFrom(src: string, marker: string, length: number): string {
  const start = src.indexOf(marker)
  return start >= 0 ? src.slice(start, start + length) : ""
}

function extractMethod(src: string, name: string): string {
  return sliceFrom(src, name, 4000)
}

describe("finalize deadlock guard (Bug 1)", () => {
  it("defer timer callback re-enters via runMaybeFinalizeStream, NOT the public wrapper", () => {
    // Locate the setTimeout defer block via its log line.
    const deferBlock = sliceFrom(source, "deferring status finalize", 2200)
    assert.ok(deferBlock.length > 0, "quiet-period defer must exist")
    assert.ok(
      deferBlock.includes("this.runMaybeFinalizeStream("),
      "timer callback must call runMaybeFinalizeStream directly — calling the public " +
      "maybeFinalizeStream chains onto its own pending promise in finalizePromises " +
      "(circular wait: stream never finalizes)"
    )
    assert.ok(
      !deferBlock.includes("this.maybeFinalizeStream("),
      "timer callback must NOT re-enter the public maybeFinalizeStream (deadlock)"
    )
  })
})

describe("cancelled defer settles its promise (Bug 1b)", () => {
  it("registers a resolver so cancelPendingStatusFinalize can settle the deferred promise", () => {
    assert.ok(
      source.includes("pendingStatusFinalizeResolvers"),
      "must track resolvers for deferred status-finalize promises"
    )
    const cancelBody = extractMethod(source, "private cancelPendingStatusFinalize(")
    assert.ok(
      cancelBody.includes("pendingStatusFinalizeResolvers") || cancelBody.includes("settle"),
      "cancelPendingStatusFinalize must settle the deferred promise — an unsettled " +
      "promise stays in finalizePromises forever and blocks all future finalizes"
    )
  })

  it("dispose settles outstanding deferred finalize promises", () => {
    const disposeBody = extractMethod(source, "dispose(): void")
    assert.ok(
      disposeBody.includes("pendingStatusFinalizeResolvers"),
      "dispose must settle deferred finalize promises so awaiting callers don't hang"
    )
  })
})

describe("pickLatestAssistant (Bug 2)", () => {
  const msg = (role: string, created: number, id: string) => ({
    info: { role, id, time: { created } },
    parts: [],
  })

  it("picks the newest assistant from a NEWEST-first array (server limit path)", () => {
    const messages = [
      msg("assistant", 500, "msg_e"), // current turn — newest first
      msg("user", 400, "msg_d"),
      msg("assistant", 300, "msg_c"), // previous turn
      msg("user", 200, "msg_b"),
      msg("assistant", 100, "msg_a"),
    ]
    const picked = pickLatestAssistant(messages)
    assert.equal((picked?.info as { id?: string }).id, "msg_e")
  })

  it("picks the newest assistant from an OLDEST-first array (no-limit path)", () => {
    const messages = [
      msg("assistant", 100, "msg_a"),
      msg("user", 200, "msg_b"),
      msg("assistant", 300, "msg_c"),
      msg("user", 400, "msg_d"),
      msg("assistant", 500, "msg_e"),
    ]
    const picked = pickLatestAssistant(messages)
    assert.equal((picked?.info as { id?: string }).id, "msg_e")
  })

  it("falls back to id ordering when time.created is missing", () => {
    // opencode message ids are lexicographically time-ordered (msg_<timestamped>)
    const messages = [
      msg("assistant", 0, "msg_f21f52f61001zzz"),
      msg("assistant", 0, "msg_f21f66089001aaa"),
    ]
    const noTime = messages.map(m => ({ ...m, info: { role: "assistant", id: (m.info as { id: string }).id } }))
    const picked = pickLatestAssistant(noTime)
    assert.equal((picked?.info as { id?: string }).id, "msg_f21f66089001aaa")
  })

  it("returns undefined when there is no assistant message", () => {
    const messages = [msg("user", 100, "msg_a"), msg("user", 200, "msg_b")]
    assert.equal(pickLatestAssistant(messages), undefined)
  })

  it("returns undefined for an empty array", () => {
    assert.equal(pickLatestAssistant([]), undefined)
  })

  it("StreamCoordinator.fetchFinalBlocks uses pickLatestAssistant, not reverse().find()", () => {
    const body = extractMethod(source, "private async fetchFinalBlocks(")
    assert.ok(body.length > 0, "fetchFinalBlocks must exist")
    assert.ok(
      body.includes("pickLatestAssistant"),
      "fetchFinalBlocks must use order-independent pickLatestAssistant"
    )
    assert.ok(
      !body.includes(".reverse()"),
      "fetchFinalBlocks must not rely on array order via reverse() — the server's " +
      "limit path returns newest-first while the no-limit path returns oldest-first"
    )
  })
})
