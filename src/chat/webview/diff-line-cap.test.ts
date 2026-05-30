/**
 * A large diff must not render one DOM row per line synchronously — that blocks
 * the webview's only thread and freezes typing / the prompt queue. The renderer
 * caps eager rows at MAX_DIFF_LINES_RENDERED and defers the rest behind a
 * one-click "Show all changes" expander.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

function bigDiffBlock(lineCount: number) {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    type: i % 2 === 0 ? "added" : "removed",
    content: `line ${i}`,
    oldLine: i,
    newLine: i,
  }))
  return {
    type: "diff",
    diffId: "d1",
    path: "big.ts",
    state: "pending",
    linesAdded: lineCount,
    linesRemoved: 0,
    hunks: [{ id: "h1", oldStart: 1, newStart: 1, state: "pending", lines }],
  }
}

describe("diff render line cap", () => {
  beforeEach(() => setupDom())

  it("caps eagerly-rendered diff line rows for large diffs", async () => {
    const { renderBlock, MAX_DIFF_LINES_RENDERED } = await import("./renderer")
    const el = renderBlock(bigDiffBlock(5000) as any, {}) as HTMLElement
    const rows = el.querySelectorAll("tr.diff-line")
    assert.ok(
      rows.length <= MAX_DIFF_LINES_RENDERED,
      `expected <= ${MAX_DIFF_LINES_RENDERED} rows, got ${rows.length}`,
    )
    const showAll = el.querySelector(".diff-show-all") as HTMLButtonElement | null
    assert.ok(showAll, "must offer a Show all expander when truncated")
  })

  it("renders every line after the expander is clicked", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(bigDiffBlock(2000) as any, {}) as HTMLElement
    const showAll = el.querySelector(".diff-show-all") as HTMLButtonElement
    showAll.click()
    assert.equal(el.querySelectorAll("tr.diff-line").length, 2000, "all lines rendered on demand")
    assert.equal(el.querySelector(".diff-show-all"), null, "expander removed after expanding")
  })

  it("does not truncate or show an expander for small diffs", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(bigDiffBlock(10) as any, {}) as HTMLElement
    assert.equal(el.querySelectorAll("tr.diff-line").length, 10)
    assert.equal(el.querySelector(".diff-show-all"), null)
  })
})
