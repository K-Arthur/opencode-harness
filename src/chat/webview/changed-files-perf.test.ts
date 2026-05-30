/**
 * Performance / freeze-prevention tests for the Changed Files dropdown.
 *
 * Regression guards for the "VS Code freezes during streaming" report:
 *  - rapid changed_files_update messages must COALESCE into a single render
 *    (one requestAnimationFrame), not one synchronous full-tree rebuild each.
 *  - expanding a single file must mutate only that row, not rebuild the whole
 *    tree (which discarded/recreated every row + listener on every click).
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

import {
  setupChangedFilesDropdown,
  updateChangedFiles,
  setCurrentSession,
  resetChangedFilesDropdown,
} from "./changed-files-dropdown"

let dom: JSDOM
let rafQueue: Array<() => void> = []

function setupDom(): void {
  dom = new JSDOM(`<!DOCTYPE html>
    <body>
      <button id="cf-btn"><span id="cf-badge"></span></button>
      <div id="cf-panel" class="hidden">
        <button id="cf-dropdown-close"></button>
        <div id="cf-tree"></div>
      </div>
      <div id="changed-files-strip"></div>
    </body>`)
  const g = globalThis as unknown as {
    document: Document
    window: Window
    HTMLElement: unknown
    requestAnimationFrame: (cb: () => void) => number
    cancelAnimationFrame: (h: number) => void
  }
  g.document = dom.window.document
  g.window = dom.window as unknown as Window
  g.HTMLElement = dom.window.HTMLElement
  // Controllable rAF so we can assert coalescing deterministically.
  rafQueue = []
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb)
    return rafQueue.length
  }
  g.cancelAnimationFrame = () => {}
}

function flushRaf(): void {
  const q = rafQueue
  rafQueue = []
  q.forEach((cb) => cb())
}

function mountDropdown(post: (m: Record<string, unknown>) => void = () => {}): void {
  setupChangedFilesDropdown({
    btn: document.getElementById("cf-btn") as HTMLButtonElement,
    panel: document.getElementById("cf-panel") as HTMLElement,
    treeContainer: document.getElementById("cf-tree") as HTMLElement,
    badge: document.getElementById("cf-badge") as HTMLElement,
    postMessage: post,
    onOpenFile: () => {},
  })
}

function files(n: number) {
  return Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, added: i + 1, removed: 0 }))
}

beforeEach(() => {
  setupDom()
  resetChangedFilesDropdown()
  mountDropdown()
})

describe("Changed Files dropdown — render coalescing", () => {
  it("coalesces many rapid updates for the current session into one scheduled render", () => {
    setCurrentSession("s1")
    flushRaf() // drain anything scheduled by the session switch
    rafQueue = []
    for (let i = 0; i < 20; i++) updateChangedFiles("s1", files(3 + i))
    assert.equal(rafQueue.length, 1, "20 rapid updates must schedule exactly one render")
    flushRaf()
    // After the single render the strip reflects the latest payload.
    const strip = document.getElementById("changed-files-strip")!
    assert.ok(strip.innerHTML.includes("f0.ts"), "latest files rendered after coalesced flush")
  })
})

describe("Changed Files dropdown — incremental expand", () => {
  it("expands a single row without rebuilding the whole tree", () => {
    setCurrentSession("s1")
    updateChangedFiles("s1", files(3))
    flushRaf()

    // Open the dropdown (renders the tree synchronously).
    ;(document.getElementById("cf-btn") as HTMLButtonElement).click()
    flushRaf()

    const tree = document.getElementById("cf-tree")!
    const rowsBefore = Array.from(tree.querySelectorAll<HTMLElement>(".cf-file-row"))
    assert.equal(rowsBefore.length, 3, "three rows rendered")
    rowsBefore.forEach((r, i) => ((r as unknown as { __mark: number }).__mark = i))

    // Expand the first row.
    const firstExpand = rowsBefore[0]!.querySelector<HTMLElement>(".cf-expand-btn")!
    firstExpand.click()

    const rowsAfter = Array.from(tree.querySelectorAll<HTMLElement>(".cf-file-row"))
    assert.equal(rowsAfter.length, 3, "still three rows")
    // The OTHER rows must be the same element instances (no full rebuild).
    assert.equal(
      (rowsAfter[1] as unknown as { __mark?: number }).__mark,
      1,
      "non-expanded rows survive expand (incremental, not full rebuild)"
    )
    assert.equal((rowsAfter[2] as unknown as { __mark?: number }).__mark, 2)
    assert.ok(rowsAfter[0]!.classList.contains("cf-file-row--expanded"), "expanded row marked open")
  })
})
