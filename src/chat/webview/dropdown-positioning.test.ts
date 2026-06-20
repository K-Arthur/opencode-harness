import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  resetContextUsageDropdown,
  setupContextUsageDropdown,
  openContextUsageDropdown,
} from "./context-usage-dropdown"
import {
  resetChangedFilesDropdown,
  setupChangedFilesDropdown,
  updateChangedFiles,
  setCurrentSession,
} from "./changed-files-dropdown"

let previousDocument: Document | undefined
let previousWindow: Window | undefined
let previousRaf: typeof requestAnimationFrame | undefined

function setRect(el: Element, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? 0,
    bottom: rect.bottom ?? 0,
    width: rect.width ?? ((rect.right ?? 0) - (rect.left ?? 0)),
    height: rect.height ?? ((rect.bottom ?? 0) - (rect.top ?? 0)),
    toJSON: () => ({}),
  } as DOMRect)
}

describe("floating webview dropdown positioning", () => {
  beforeEach(() => {
    const dom = new JSDOM(`<!doctype html><body>
      <button id="ctx-btn"></button>
      <div id="context-usage"></div>
      <div id="context-usage-dropdown" class="hidden"><button id="ctx-dropdown-close"></button><div id="ctx-content"></div></div>
      <span id="ctx-badge"></span>
      <div id="changed-files-strip" class="hidden"></div>
      <div id="changed-files-dropdown" class="hidden"><button id="cf-dropdown-close"></button><div id="cf-tree"></div></div>
      <span id="cf-badge"></span>
      <div id="input-area" style="position:fixed;bottom:10px;left:10px;right:10px;height:60px"></div>
    </body>`)
    previousDocument = globalThis.document
    previousWindow = globalThis.window
    previousRaf = globalThis.requestAnimationFrame
    ;(globalThis as unknown as { document: Document }).document = dom.window.document
    ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
    ;(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (cb) => {
      cb(0)
      return 0
    }
    Object.defineProperty(dom.window, "innerWidth", { value: 360, configurable: true })
    Object.defineProperty(dom.window, "innerHeight", { value: 260, configurable: true })
    resetContextUsageDropdown()
    resetChangedFilesDropdown()
  })

  afterEach(() => {
    resetContextUsageDropdown()
    resetChangedFilesDropdown()
    ;(globalThis as unknown as { document: Document | undefined }).document = previousDocument
    ;(globalThis as unknown as { window: Window | undefined }).window = previousWindow
    ;(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame | undefined }).requestAnimationFrame = previousRaf
  })

  it("keeps the context usage dropdown inside a narrow viewport", () => {
    const trigger = document.getElementById("context-usage")!
    const panel = document.getElementById("context-usage-dropdown")!
    setRect(trigger, { left: 250, right: 350, top: 40, bottom: 60, width: 100, height: 20 })
    setRect(panel, { left: 0, right: 0, top: 0, bottom: 420, width: 380, height: 420 })

    setupContextUsageDropdown({
      btn: null,
      panel,
      content: document.getElementById("ctx-content")!,
      postMessage: () => {},
    })
    openContextUsageDropdown()

    const left = Number.parseFloat(panel.style.left)
    const width = Number.parseFloat(panel.style.width)
    const top = Number.parseFloat(panel.style.top)
    assert.ok(left >= 8, "left edge must stay within viewport margin")
    assert.ok(left + width <= 352, "right edge must stay within viewport margin")
    assert.ok(top >= 8, "top edge must stay visible")
    assert.ok(Number.parseFloat(panel.style.maxHeight) >= 180, "dropdown must keep a usable scrollable height")
  })

  // The changed-files surface was refactored from a JS-positioned floating
  // modal to an inline panel anchored above the input bar via CSS (commit
  // c36edc7). It no longer sets inline style.left/top/width — staying within the
  // viewport is now the stylesheet's job. These tests therefore assert the
  // inline-panel contract: clicking the strip opens the panel and renders the
  // file tree, regardless of anchor geometry or viewport width.
  it("opens the changed-files inline panel and renders the file tree", () => {
    const strip = document.getElementById("changed-files-strip")!
    const panel = document.getElementById("changed-files-dropdown")!
    const tree = document.getElementById("cf-tree")!
    setRect(strip, { left: 12, right: 348, top: 218, bottom: 238, width: 336, height: 20 })

    setupChangedFilesDropdown({
      btn: null,
      panel,
      treeContainer: tree,
      badge: document.getElementById("cf-badge")!,
      postMessage: () => {},
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {},
    })
    setCurrentSession("session-a")
    updateChangedFiles("session-a", [{ path: "/tmp/example.ts", added: 1, removed: 0 }])
    strip.click()

    assert.ok(!panel.classList.contains("hidden"), "clicking the strip must open the panel")
    assert.ok(tree.childElementCount > 0, "panel must render the changed-files tree")
    assert.ok(tree.textContent?.includes("example.ts"), "tree must list the changed file")
  })

  it("opens the inline panel even when the strip anchor has zero dimensions", () => {
    // Edge case: strip is present but has zero height (hidden/invisible). The
    // inline panel does not depend on anchor geometry, so it still opens.
    const strip = document.getElementById("changed-files-strip")!
    const panel = document.getElementById("changed-files-dropdown")!
    const tree = document.getElementById("cf-tree")!
    setRect(strip, { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })

    setupChangedFilesDropdown({
      btn: null,
      panel,
      treeContainer: tree,
      badge: document.getElementById("cf-badge")!,
      postMessage: () => {},
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {},
    })
    setCurrentSession("session-a")
    updateChangedFiles("session-a", [{ path: "/tmp/example.ts", added: 1, removed: 0 }])
    strip.click()

    assert.ok(!panel.classList.contains("hidden"), "clicking the strip must open the panel even with a zero-size anchor")
    assert.ok(tree.childElementCount > 0, "panel must still render the changed-files tree")
  })

  it("opens the inline panel on a narrow viewport without JS positioning", () => {
    Object.defineProperty(window, "innerWidth", { value: 250, configurable: true })
    const strip = document.getElementById("changed-files-strip")!
    const panel = document.getElementById("changed-files-dropdown")!
    const tree = document.getElementById("cf-tree")!
    setRect(strip, { left: 10, right: 240, top: 200, bottom: 220, width: 230, height: 20 })

    setupChangedFilesDropdown({
      btn: null,
      panel,
      treeContainer: tree,
      badge: document.getElementById("cf-badge")!,
      postMessage: () => {},
      onOpenChangedFileDiff: () => {},
      onOpenFile: () => {},
    })
    setCurrentSession("session-a")
    updateChangedFiles("session-a", [{ path: "/tmp/example.ts", added: 1, removed: 0 }])
    strip.click()

    assert.ok(!panel.classList.contains("hidden"), "clicking the strip must open the panel")
    // The panel is CSS-positioned inline; it must NOT set brittle inline
    // left/width coordinates that could push it off a narrow webview.
    assert.equal(panel.style.left, "", "inline panel must not hard-code a left coordinate")
    assert.equal(panel.style.width, "", "inline panel must not hard-code a width")
  })
})
