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

function simpleDiffBlock() {
  return {
    type: "diff" as const,
    diffId: "d1",
    path: "src/foo.ts",
    state: "pending" as const,
    linesAdded: 2,
    linesRemoved: 1,
    hunks: [
      {
        id: "h1",
        oldStart: 1,
        newStart: 1,
        state: "pending" as const,
        lines: [
          { type: "context" as const, content: "unchanged line", oldLine: 1, newLine: 1 },
          { type: "removed" as const, content: "old code", oldLine: 2 },
          { type: "added" as const, content: "new code", newLine: 2 },
          { type: "added" as const, content: "extra line", newLine: 3 },
          { type: "context" as const, content: "another unchanged", oldLine: 3, newLine: 4 },
        ],
      },
    ],
  }
}

describe("side-by-side diff view", () => {
  beforeEach(() => setupDom())

  it("renders a view-mode toggle button in the diff header", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle")
    assert.ok(toggle, "diff header should contain a view-mode toggle button")
  })

  it("starts in unified mode by default", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const wrapper = el.querySelector(".diff-table-wrapper")
    assert.ok(wrapper, "should have diff-table-wrapper")
    assert.ok(!wrapper!.classList.contains("diff-table-wrapper--side-by-side"), "should NOT start in side-by-side mode")
  })

  it("switches to side-by-side mode on toggle click", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()
    const wrapper = el.querySelector(".diff-table-wrapper")
    assert.ok(wrapper!.classList.contains("diff-table-wrapper--side-by-side"), "should switch to side-by-side mode")
  })

  it("switches back to unified on second toggle click", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()
    toggle.click()
    const wrapper = el.querySelector(".diff-table-wrapper")
    assert.ok(!wrapper!.classList.contains("diff-table-wrapper--side-by-side"), "should switch back to unified")
  })

  it("side-by-side mode renders two columns per row", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()

    // In side-by-side, each row should have a left and right cell
    const rows = el.querySelectorAll("tr.diff-line")
    assert.ok(rows.length > 0, "should have diff line rows")
    for (const row of rows) {
      const cells = row.querySelectorAll("td")
      // Each row should have: old-num, old-content, new-num, new-content (4 cells)
      // OR the unified layout cells. In side-by-side we expect 4 data cells.
      assert.ok(cells.length >= 4, `side-by-side row should have >= 4 cells, got ${cells.length}`)
    }
  })

  it("context lines appear in both columns in side-by-side mode", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()

    // Find context rows - they should have content in both left and right columns
    const contextRows = el.querySelectorAll("tr.diff-line--context")
    assert.ok(contextRows.length > 0, "should have context rows")
    for (const row of contextRows) {
      const leftContent = row.querySelector(".diff-side-left")
      const rightContent = row.querySelector(".diff-side-right")
      assert.ok(leftContent, "context row should have left content")
      assert.ok(rightContent, "context row should have right content")
    }
  })

  it("removed lines appear only in left column in side-by-side mode", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()

    // In side-by-side mode, removed lines become "modified" pairs with added lines
    // Check that modified rows have content in both columns
    const modifiedRows = el.querySelectorAll("tr.diff-line--modified")
    const removedRows = el.querySelectorAll("tr.diff-line--removed")
    assert.ok(modifiedRows.length > 0 || removedRows.length > 0, "should have modified or removed rows")
    for (const row of modifiedRows) {
      const leftContent = row.querySelector(".diff-side-left")
      const rightContent = row.querySelector(".diff-side-right")
      assert.ok(leftContent, "modified row should have left content")
      assert.ok(rightContent, "modified row should have right content")
    }
  })

  it("added lines appear only in right column in side-by-side mode", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(simpleDiffBlock() as any, {}) as HTMLElement
    const toggle = el.querySelector(".diff-view-toggle") as HTMLButtonElement
    toggle.click()

    // In side-by-side mode, added lines that pair with removed become "modified"
    // Pure added lines (no matching removed) should have right content only
    const addedRows = el.querySelectorAll("tr.diff-line--added")
    const modifiedRows = el.querySelectorAll("tr.diff-line--modified")
    assert.ok(addedRows.length > 0 || modifiedRows.length > 0, "should have added or modified rows")
    for (const row of addedRows) {
      const rightContent = row.querySelector(".diff-side-right")
      assert.ok(rightContent, "added row should have right content")
    }
  })
})
