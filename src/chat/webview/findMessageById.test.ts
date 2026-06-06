/**
 * Guards the reverse-scan lookup used on the streaming hot path.
 *
 * During streaming, the message being mutated is almost always the LAST element
 * of the transcript array, yet the code previously used `Array.find`, which
 * scans from the front — an O(N) walk on every render flush / tool / diff event
 * that grew with the conversation. `findMessageById` scans from the end so the
 * common case is O(1). This test pins both correctness and the O(1)-for-last
 * behaviour (a future front-scan reimplementation would fail the access count).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { findMessageById } from "./streamHandlers"
import type { ChatMessage } from "./types"

function transcript(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: "assistant" as const,
    id: `m${i}`,
    blocks: [{ type: "text", text: "x" }],
    timestamp: i,
  }))
}

void describe("findMessageById", () => {
  void it("returns the message with the matching id", () => {
    const msgs = transcript(5)
    assert.equal(findMessageById(msgs, "m3")?.id, "m3")
  })

  void it("returns undefined when no message matches", () => {
    assert.equal(findMessageById(transcript(5), "nope"), undefined)
  })

  void it("returns undefined for an empty transcript", () => {
    assert.equal(findMessageById([], "m0"), undefined)
  })

  void it("finds the most-recent (last) message without scanning the whole array", () => {
    const n = 500
    let idReads = 0
    const msgs = Array.from({ length: n }, (_, i) => ({
      role: "assistant" as const,
      get id() { idReads++; return `m${i}` },
      blocks: [],
      timestamp: i,
    })) as unknown as ChatMessage[]

    const found = findMessageById(msgs, "m499")
    assert.equal(found?.id, "m499")
    // Reverse scan hits the last element first → a couple of property reads, not ~N.
    assert.ok(idReads <= 3, `expected O(1) reads for last element, got ${idReads} for N=${n}`)
  })
})
