/**
 * DOM tests for the per-hunk revert view (audit §14.3 wiring).
 * Renders host-issued hunks (from get_file_hunks) each with a Revert button that
 * posts revert_hunk{path, hunkId}. Host-authoritative ids keep webview/host in sync.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderHunksWithRevert } from "./hunkRevertView"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="h"></div></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  return dom.window.document.getElementById("h")!
}

const hunk = (id: string, lines: string[], add = 1, del = 1) => ({ id, additions: add, deletions: del, lines })

describe("renderHunksWithRevert", () => {
  let el: HTMLElement
  beforeEach(() => { el = setupDom() })

  it("renders a block + Revert button per hunk with added/removed lines", () => {
    renderHunksWithRevert(el, {
      path: "a.ts",
      hunks: [hunk("h0", [" ctx", "-old", "+new"])],
      onRevert: () => {},
    })
    assert.equal(el.querySelectorAll(".cf-hunk-block").length, 1)
    assert.equal(el.querySelectorAll(".cf-hunk-revert").length, 1)
    assert.ok(el.querySelector(".cf-hunk-line--removed"))
    assert.ok(el.querySelector(".cf-hunk-line--added"))
  })

  it("invokes onRevert(path, hunkId) when a Revert button is clicked", () => {
    let got: [string, string] | null = null
    renderHunksWithRevert(el, {
      path: "src/x.ts",
      hunks: [hunk("h0", ["+a"]), hunk("h1", ["-b"])],
      onRevert: (p, id) => { got = [p, id] },
    })
    el.querySelectorAll<HTMLElement>(".cf-hunk-revert")[1]!.click()
    assert.deepEqual(got, ["src/x.ts", "h1"])
  })

  it("shows an empty state when there are no hunks", () => {
    renderHunksWithRevert(el, { path: "a.ts", hunks: [], onRevert: () => {} })
    assert.equal(el.querySelectorAll(".cf-hunk-block").length, 0)
    assert.ok(el.textContent && el.textContent.length > 0)
  })
})
