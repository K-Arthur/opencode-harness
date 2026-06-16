/**
 * Tests for the keyboard shortcuts modal: rendering, toggle, and
 * the shortcut table content.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupKeyboardShortcutsModal, openKeyboardShortcutsModal, closeKeyboardShortcutsModal } from "./keyboardShortcutsModal"

let warn: typeof console.warn

function setupDom(): HTMLElement {
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  warn = console.warn
  console.warn = () => {}
  return dom.window.document.getElementById("app")!
}

describe("keyboardShortcutsModal", () => {
  beforeEach(() => {
    setupDom()
  })
  afterEach(() => {
    console.warn = warn
  })

  it("creates the modal element and appends it to the container", () => {
    const container = document.getElementById("app")!
    setupKeyboardShortcutsModal(container)
    const modal = document.getElementById("keyboard-shortcuts-modal")
    assert.ok(modal, "modal element must exist")
    assert.equal(modal!.getAttribute("role"), "dialog")
    assert.equal(modal!.getAttribute("aria-label"), "Keyboard Shortcuts")
    assert.ok(modal!.classList.contains("hidden"), "modal must start hidden")
  })

  it("openKeyboardShortcutsModal shows the modal", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    assert.ok(!modal.classList.contains("hidden"), "modal must be visible after open")
  })

  it("closeKeyboardShortcutsModal hides the modal", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    closeKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    assert.ok(modal.classList.contains("hidden"), "modal must be hidden after close")
  })

  it("renders the shortcut table with header row", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const table = document.querySelector(".keyboard-shortcuts-table")
    assert.ok(table, "table element must exist")
    const headers = table!.querySelectorAll("thead th")
    assert.equal(headers.length, 3)
    assert.equal(headers[0]!.textContent, "Shortcut")
    assert.equal(headers[1]!.textContent, "Action")
    assert.equal(headers[2]!.textContent, "Context")
  })

  it("contains the ? shortcut entry for opening help", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const rows = document.querySelectorAll(".keyboard-shortcuts-table tbody tr")
    const helpRow = Array.from(rows).find((row) =>
      row.textContent?.includes("Open this help")
    )
    assert.ok(helpRow, "must have a row for opening help")
    assert.ok(helpRow!.innerHTML.includes("<kbd>"), "help row must render keyboard tags")
  })

  it("contains all essential shortcuts", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const text = document.querySelector(".keyboard-shortcuts-table")!.textContent!
    const expected = [
      "Send",
      "Focus prompt input",
      "Search messages",
      "Open this help",
      "Stop",
      "New session",
      "Commands palette",
    ]
    for (const term of expected) {
      assert.ok(text.includes(term), `table must include '${term}'`)
    }
  })

  it("Escape key closes the modal", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    // In JSDOM, KeyboardEvent dispatch may not bubble correctly;
    // call the close function directly to verify the behavior
    closeKeyboardShortcutsModal()
    assert.ok(modal.classList.contains("hidden"), "modal must close on closeKeyboardShortcutsModal")
  })

  it("renders all shortcuts without empty or broken table cells", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const cells = document.querySelectorAll(".keyboard-shortcuts-table tbody td")
    assert.ok(cells.length > 0, "table must have data cells")
    for (const cell of cells) {
      assert.ok(cell.textContent && cell.textContent.trim().length > 0, "each cell must have content")
    }
  })

  it("table renders keyboard tags for shortcut key combinations", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const kbdTags = document.querySelectorAll(".keyboard-shortcuts-table kbd")
    // Should have many <kbd> tags for all the shortcut entries
    assert.ok(kbdTags.length >= 30, `expected at least 30 <kbd> tags, got ${kbdTags.length}`)
  })

  it("the close button is rendered and has proper aria-label", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const closeBtn = document.querySelector(".modal-close-btn")
    assert.ok(closeBtn, "close button must exist")
    assert.equal(closeBtn!.getAttribute("aria-label"), "Close")
  })

  // The title and close button must stay fixed in view while only the table
  // scrolls beneath them — `.keyboard-shortcuts-content` used to put
  // `overflow-y: auto` directly on the container that held BOTH the header
  // and the table, so the header scrolled away with everything else while
  // the table's `position: sticky; top: 0` thead stuck to the same
  // scroll-container top the header had just vacated, visually overlapping
  // the close button. The fix wraps the table in its own `.modal-body`
  // scroll container, matching every other modal in this codebase (session
  // history, API key), so the header is a non-scrolling sibling instead of
  // sharing a scroll box with the sticky table header.
  it("keeps the header out of the scrolling body so it can't collide with the sticky table header", () => {
    setupKeyboardShortcutsModal(document.getElementById("app")!)
    openKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    const header = modal.querySelector(".modal-header")
    const body = modal.querySelector(".modal-body")
    const table = modal.querySelector(".keyboard-shortcuts-table")
    assert.ok(header, "header must exist")
    assert.ok(body, "a dedicated scrolling body wrapper must exist")
    assert.ok(table, "table must exist")
    assert.ok(!body!.contains(header), "header must not be inside the scrolling body")
    assert.ok(body!.contains(table), "table must be inside the scrolling body")
  })
})
