/**
 * Behavioral + property tests for client-side hunk staging (audit §14.3).
 *
 * The opencode server provides `FileDiff { before, after }` (no per-hunk structure)
 * via the `session.diff` event. To offer Roo-Code-style per-hunk accept/reject we
 * must (a) reconstruct hunks from before/after with no external dependency, and
 * (b) apply an arbitrary SUBSET of those hunks. The two anchoring invariants are
 * exhaustively checked here:
 *   accept ALL hunks  → after
 *   accept NO hunks   → before
 * plus subset independence and trailing-newline handling.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeHunks, applyHunkSelection, countHunkChanges } from "./hunkStaging"

describe("computeHunks — reconstruction from before/after", () => {
  it("returns no hunks when content is identical", () => {
    assert.deepEqual(computeHunks("a\nb\nc", "a\nb\nc"), [])
  })

  it("produces a single hunk for one contiguous modification", () => {
    const hunks = computeHunks("a\nb\nc", "a\nB\nc")
    assert.equal(hunks.length, 1)
    const h = hunks[0]!
    assert.ok(h.id.length > 0)
    assert.ok(h.lines.some((l) => l === "-b"))
    assert.ok(h.lines.some((l) => l === "+B"))
  })

  it("produces separate hunks for changes far apart", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
    const after = before.split("\n").map((l, i) => (i === 1 ? "CHANGED1" : i === 18 ? "CHANGED18" : l)).join("\n")
    const hunks = computeHunks(before, after)
    assert.equal(hunks.length, 2, "two distant edits → two hunks")
  })

  it("assigns unique, stable ids", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
    const after = before.split("\n").map((l, i) => (i === 1 ? "X" : i === 18 ? "Y" : l)).join("\n")
    const a = computeHunks(before, after)
    const b = computeHunks(before, after)
    const ids = a.map((h) => h.id)
    assert.equal(new Set(ids).size, ids.length, "ids unique")
    assert.deepEqual(a.map((h) => h.id), b.map((h) => h.id), "ids stable across calls")
  })
})

describe("applyHunkSelection — anchoring invariants", () => {
  const cases: Array<[string, string, string]> = [
    ["single modify", "a\nb\nc", "a\nB\nc"],
    ["addition only", "a\nb", "a\nX\nb"],
    ["deletion only", "a\nb\nc", "a\nc"],
    ["prepend", "a\nb", "Z\na\nb"],
    ["append", "a\nb", "a\nb\nZ"],
    ["multi-hunk", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10", "1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10"],
    ["full rewrite", "old1\nold2", "new1\nnew2\nnew3"],
    ["empty before (creation)", "", "hello\nworld"],
    ["empty after (deletion)", "hello\nworld", ""],
    ["trailing newline added", "a\nb", "a\nb\n"],
    ["trailing newline removed", "a\nb\n", "a\nb"],
  ]

  for (const [name, before, after] of cases) {
    it(`accept ALL → after :: ${name}`, () => {
      const hunks = computeHunks(before, after)
      const allIds = hunks.map((h) => h.id)
      assert.equal(applyHunkSelection(before, hunks, allIds), after)
    })
    it(`accept NONE → before :: ${name}`, () => {
      const hunks = computeHunks(before, after)
      assert.equal(applyHunkSelection(before, hunks, []), before)
    })
  }
})

describe("applyHunkSelection — subset selection", () => {
  it("accepting only the first of two distant hunks applies just that change", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
    const after = before.split("\n").map((l, i) => (i === 1 ? "FIRST" : i === 18 ? "SECOND" : l)).join("\n")
    const hunks = computeHunks(before, after)
    assert.equal(hunks.length, 2)
    const onlyFirst = applyHunkSelection(before, hunks, [hunks[0]!.id])
    assert.ok(onlyFirst.includes("FIRST"), "first change applied")
    assert.ok(!onlyFirst.includes("SECOND"), "second change NOT applied")
    assert.ok(onlyFirst.includes("line18"), "second region still original")
  })

  it("is order-independent in the accepted-id set", () => {
    const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"
    const after = "1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10"
    const hunks = computeHunks(before, after)
    const ids = hunks.map((h) => h.id)
    const a = applyHunkSelection(before, hunks, ids)
    const b = applyHunkSelection(before, hunks, [...ids].reverse())
    assert.equal(a, b)
  })
})

describe("applyHunkSelection — randomized round-trip property", () => {
  // Hand-rolled property check (repo convention: no fast-check dependency).
  function mulberry32(seed: number): () => number {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it("accept-all === after and accept-none === before across 300 random pairs", () => {
    const rand = mulberry32(1234)
    for (let iter = 0; iter < 300; iter++) {
      const n = Math.floor(rand() * 12)
      const beforeLines: string[] = []
      for (let i = 0; i < n; i++) beforeLines.push(`L${Math.floor(rand() * 6)}`)
      // Derive after by random edits (keep/replace/delete/insert).
      const afterLines: string[] = []
      for (const l of beforeLines) {
        const r = rand()
        if (r < 0.6) afterLines.push(l)
        else if (r < 0.8) afterLines.push(`M${Math.floor(rand() * 6)}`)
        else if (r < 0.9) {
          /* delete: push nothing */
        } else {
          afterLines.push(`I${Math.floor(rand() * 6)}`)
          afterLines.push(l)
        }
      }
      const before = beforeLines.join("\n")
      const after = afterLines.join("\n")
      const hunks = computeHunks(before, after)
      const ids = hunks.map((h) => h.id)
      assert.equal(applyHunkSelection(before, hunks, ids), after, `accept-all failed @${iter}`)
      assert.equal(applyHunkSelection(before, hunks, []), before, `accept-none failed @${iter}`)
    }
  })
})

describe("countHunkChanges", () => {
  it("counts additions and deletions in a hunk", () => {
    const hunks = computeHunks("a\nb\nc", "a\nB\nC\nc")
    const total = hunks.reduce(
      (acc, h) => {
        const c = countHunkChanges(h)
        return { additions: acc.additions + c.additions, deletions: acc.deletions + c.deletions }
      },
      { additions: 0, deletions: 0 },
    )
    assert.equal(total.additions, 2, "B and C added")
    assert.equal(total.deletions, 1, "b removed")
  })
})
