/**
 * Behavioral tests for the recent/pinned prompt rail (brief Phase 5).
 *
 * Contract:
 *   1. Pinned prompts first, newest-pinned-first, never dropped by the cap.
 *   2. Then newest unpinned prompts, capped at maxRecent.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildPromptRail, togglePinnedPrompt, type PromptEntry } from "./recentPrompts"

const P = (id: string, time: number, text = id): PromptEntry => ({ id, time, text })

describe("buildPromptRail", () => {
  it("returns [] for no prompts", () => {
    assert.deepEqual(buildPromptRail([], []), [])
  })

  it("shows unpinned prompts newest-first, capped at maxRecent", () => {
    const prompts = [P("a", 1), P("b", 2), P("c", 3), P("d", 4)]
    const rail = buildPromptRail(prompts, [], { maxRecent: 2 })
    assert.deepEqual(rail.map((r) => r.id), ["d", "c"])
    assert.equal(rail.every((r) => r.pinned === false), true)
  })

  it("floats pinned prompts to the top, newest-pinned-first", () => {
    const prompts = [P("a", 1), P("b", 2), P("c", 3), P("d", 4)]
    const rail = buildPromptRail(prompts, ["a", "c"], { maxRecent: 5 })
    assert.deepEqual(rail.map((r) => r.id), ["c", "a", "d", "b"])
    assert.equal(rail.find((r) => r.id === "c")!.pinned, true)
    assert.equal(rail.find((r) => r.id === "d")!.pinned, false)
  })

  it("never drops a pinned prompt even when it is older than the recent cap", () => {
    const prompts = [P("old", 1), P("n1", 10), P("n2", 11), P("n3", 12)]
    const rail = buildPromptRail(prompts, ["old"], { maxRecent: 2 })
    // pinned 'old' shown despite being oldest; recent capped to the 2 newest unpinned
    assert.deepEqual(rail.map((r) => r.id), ["old", "n3", "n2"])
  })

  it("defaults maxRecent to 5 when unspecified", () => {
    const prompts = Array.from({ length: 8 }, (_, i) => P(`p${i}`, i))
    const rail = buildPromptRail(prompts, [])
    assert.equal(rail.length, 5)
    assert.deepEqual(rail.map((r) => r.id), ["p7", "p6", "p5", "p4", "p3"])
  })

  it("does not mutate the input array", () => {
    const prompts = [P("a", 1), P("b", 2)]
    const copy = prompts.map((p) => ({ ...p }))
    buildPromptRail(prompts, ["a"], { maxRecent: 1 })
    assert.deepEqual(prompts, copy)
  })
})

describe("togglePinnedPrompt", () => {
  it("adds an unpinned id and removes a pinned id, returning a new set", () => {
    const a = togglePinnedPrompt([], "x")
    assert.equal(a.has("x"), true)
    const b = togglePinnedPrompt(a, "x")
    assert.equal(b.has("x"), false)
    assert.notEqual(a, b)
  })
})
