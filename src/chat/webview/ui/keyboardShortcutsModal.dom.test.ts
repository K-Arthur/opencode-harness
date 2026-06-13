/**
 * DOM tests for the keyboard-shortcuts modal focus behavior (WCAG 2.4.3):
 * opening moves focus into the dialog, Tab is trapped inside it, and closing
 * returns focus to the element that invoked it.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setupKeyboardShortcutsModal,
  openKeyboardShortcutsModal,
  closeKeyboardShortcutsModal,
} from "./keyboardShortcutsModal"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="invoker">Shortcuts</button>
    <div id="app"></div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  return dom
}

void describe("keyboardShortcutsModal focus management", () => {
  let dom: JSDOM

  beforeEach(() => {
    dom = setupDom()
    setupKeyboardShortcutsModal(document.getElementById("app")!)
  })

  void it("moves focus into the dialog on open", () => {
    const invoker = document.getElementById("invoker")!
    invoker.focus()
    openKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    assert.equal(modal.classList.contains("hidden"), false)
    assert.ok(modal.contains(document.activeElement), "focus should be inside the dialog")
  })

  void it("returns focus to the invoker on close", () => {
    const invoker = document.getElementById("invoker")!
    invoker.focus()
    openKeyboardShortcutsModal()
    closeKeyboardShortcutsModal()
    assert.equal(document.activeElement, invoker)
  })

  void it("traps Tab inside the dialog while open", () => {
    const invoker = document.getElementById("invoker")!
    invoker.focus()
    openKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    const closeBtn = modal.querySelector<HTMLElement>(".modal-close-btn")!
    // Close button is the only focusable control: Tab from it must wrap back
    // to it instead of escaping the dialog.
    closeBtn.focus()
    const evt = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    closeBtn.dispatchEvent(evt)
    assert.equal(evt.defaultPrevented, true, "Tab at the edge must be intercepted")
    assert.ok(modal.contains(document.activeElement))
  })

  void it("close is idempotent and safe before any open", () => {
    closeKeyboardShortcutsModal()
    const modal = document.getElementById("keyboard-shortcuts-modal")!
    assert.equal(modal.classList.contains("hidden"), true)
  })
})
