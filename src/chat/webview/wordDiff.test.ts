import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeWordDiffs } from "./wordDiff"

interface DiffLine {
  type: "added" | "removed" | "context"
  oldLine?: number
  newLine?: number
  content: string
  wordDiffHtml?: string
}

describe("computeWordDiffs", () => {
  it("returns empty for empty array", () => {
    const lines: DiffLine[] = []
    computeWordDiffs(lines)
    assert.equal(lines.length, 0)
  })

  it("detects single-word change in adjacent removed/added pair", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "hello world", oldLine: 1 },
      { type: "added", content: "goodbye world", newLine: 1 },
    ]
    computeWordDiffs(lines)
    assert.ok(lines[0]!.wordDiffHtml!.includes("<del>"), "removed should have del tag")
    assert.ok(lines[0]!.wordDiffHtml!.includes(" world"), "unchanged portion preserved")
    assert.ok(lines[1]!.wordDiffHtml!.includes("<ins>"), "added should have ins tag")
    assert.ok(lines[1]!.wordDiffHtml!.includes(" world"), "unchanged portion preserved")
  })

  it("marks changed words as del/ins in multi-word change pair", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "const oldVar = getOld()", oldLine: 1 },
      { type: "added", content: "const newVar = getNew()", newLine: 1 },
    ]
    computeWordDiffs(lines)
    // Character diff produces =const [-old][+new]=Var = get[-Old][+New]=()
    assert.ok(lines[0]!.wordDiffHtml!.includes("<del>"), "removed line should have del tags")
    assert.ok(lines[1]!.wordDiffHtml!.includes("<ins>"), "added line should have ins tags")
    // The changed substrings should appear in the output
    assert.ok(lines[0]!.wordDiffHtml!.includes("const "), "unchanged prefix preserved on removed")
    assert.ok(lines[1]!.wordDiffHtml!.includes("const "), "unchanged prefix preserved on added")
    assert.ok(lines[0]!.wordDiffHtml!.includes("Var = get"), "middle portion preserved")
    assert.ok(lines[1]!.wordDiffHtml!.includes("Var = get"), "middle portion preserved")
    assert.ok(lines[0]!.wordDiffHtml!.includes("()"), "suffix preserved on removed")
    assert.ok(lines[1]!.wordDiffHtml!.includes("()"), "suffix preserved on added")
  })

  it("does not touch unpaired removed line (no adjacent added)", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "old line", oldLine: 1 },
      { type: "context", content: "context line", oldLine: 2, newLine: 2 },
    ]
    computeWordDiffs(lines)
    assert.equal(lines[0]!.wordDiffHtml, undefined)
    assert.equal(lines[1]!.wordDiffHtml, undefined)
  })

  it("handles consecutive pairs: --++ dash dash plus plus", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "a = ONE", oldLine: 1 },
      { type: "removed", content: "b = TWO", oldLine: 2 },
      { type: "added", content: "a = 111", newLine: 1 },
      { type: "added", content: "b = 222", newLine: 2 },
    ]
    computeWordDiffs(lines)
    // First pair: removed[0]="a = ONE" vs added[0]="a = 111"
    assert.ok(lines[0]!.wordDiffHtml!.includes("<del>"), "first removed has del")
    assert.ok(lines[2]!.wordDiffHtml!.includes("<ins>"), "first added has ins")
    assert.ok(lines[0]!.wordDiffHtml!.includes("a = "), "unchanged prefix on first removed")
    assert.ok(lines[2]!.wordDiffHtml!.includes("a = "), "unchanged prefix on first added")
    // Second pair: removed[1]="b = TWO" vs added[1]="b = 222"
    assert.ok(lines[1]!.wordDiffHtml!.includes("<del>"), "second removed has del")
    assert.ok(lines[3]!.wordDiffHtml!.includes("<ins>"), "second added has ins")
    assert.ok(lines[1]!.wordDiffHtml!.includes("b = "), "unchanged prefix on second removed")
    assert.ok(lines[3]!.wordDiffHtml!.includes("b = "), "unchanged prefix on second added")
  })

  it("handles pure addition block (no removed lines)", () => {
    const lines: DiffLine[] = [
      { type: "context", content: "before", oldLine: 1, newLine: 1 },
      { type: "added", content: "const x = 3", newLine: 2 },
      { type: "added", content: "const y = 4", newLine: 3 },
      { type: "context", content: "after", oldLine: 2, newLine: 4 },
    ]
    computeWordDiffs(lines)
    for (const line of lines) {
      assert.equal(line.wordDiffHtml, undefined)
    }
  })

  it("handles interleaved: context removed added context", () => {
    const lines: DiffLine[] = [
      { type: "context", content: "before", oldLine: 1, newLine: 1 },
      { type: "removed", content: "old code", oldLine: 2 },
      { type: "added", content: "new code", newLine: 2 },
      { type: "context", content: "after", oldLine: 3, newLine: 3 },
    ]
    computeWordDiffs(lines)
    assert.ok(lines[1]!.wordDiffHtml!.includes("<del>"), "removed should have del")
    assert.ok(lines[2]!.wordDiffHtml!.includes("<ins>"), "added should have ins")
    assert.ok(lines[1]!.wordDiffHtml!.includes(" code"), "unchanged word preserved on removed")
    assert.ok(lines[2]!.wordDiffHtml!.includes(" code"), "unchanged word preserved on added")
  })

  it("skips pair when lines are identical (no real diff)", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "same thing", oldLine: 1 },
      { type: "added", content: "same thing", newLine: 1 },
    ]
    computeWordDiffs(lines)
    assert.equal(lines[0]!.wordDiffHtml, undefined)
    assert.equal(lines[1]!.wordDiffHtml, undefined)
  })

  it("handles whitespace-only change", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "const x = 1;", oldLine: 1 },
      { type: "added", content: "const x =  1;", newLine: 1 },
    ]
    computeWordDiffs(lines)
    assert.ok(lines[0]!.wordDiffHtml?.length, "removed should have wordDiffHtml")
    assert.ok(lines[1]!.wordDiffHtml?.length, "added should have wordDiffHtml")
  })

  it("preserves all content for deleted-then-added with different text", () => {
    const lines: DiffLine[] = [
      { type: "removed", content: "Hello world!", oldLine: 1 },
      { type: "added", content: "Goodbye world!", newLine: 1 },
    ]
    computeWordDiffs(lines)
    assert.ok(lines[0]!.wordDiffHtml!.includes("<del>"), "removed has del tags")
    assert.ok(lines[0]!.wordDiffHtml!.includes(" world!"), "common suffix preserved on removed")
    assert.ok(lines[1]!.wordDiffHtml!.includes("<ins>"), "added has ins tags")
    assert.ok(lines[1]!.wordDiffHtml!.includes(" world!"), "common suffix preserved on added")
  })
})
