import { describe, it, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { registerShortcut, createShortcutDispatcher, resetShortcutRegistry, isTextEntryTarget, isModalOrDialogOpen } from "./keyboardShortcuts"

function installDom(): { cleanup: () => void } {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <input id="text-input" type="text" />
      <textarea id="textarea-input"></textarea>
      <div id="contenteditable" contenteditable="true"></div>
      <button id="regular-button">Click me</button>
      <div id="modal-1" aria-modal="true" class="hidden"></div>
    </body></html>`,
    { url: "http://localhost" }
  )

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    KeyboardEvent: globalThis.KeyboardEvent,
  }

  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
  })

  const cleanup = () => {
    Object.assign(globalThis, previous)
    dom.window.close()
  }

  return { cleanup }
}

afterEach(() => {
  resetShortcutRegistry()
})

void describe("isTextEntryTarget", () => {
  void it("returns true for input elements", () => {
    const { cleanup } = installDom()
    const input = document.getElementById("text-input")
    assert.equal(isTextEntryTarget(input), true)
    cleanup()
  })

  void it("returns true for textarea elements", () => {
    const { cleanup } = installDom()
    const ta = document.getElementById("textarea-input")
    assert.equal(isTextEntryTarget(ta), true)
    cleanup()
  })

  void it("returns true for contenteditable elements", { skip: "JSDOM does not support isContentEditable" }, () => {
    const { cleanup } = installDom()
    const ce = document.getElementById("contenteditable")
    assert.equal(isTextEntryTarget(ce), true)
    cleanup()
  })

  void it("returns false for regular buttons", () => {
    const { cleanup } = installDom()
    const btn = document.getElementById("regular-button")
    assert.equal(isTextEntryTarget(btn), false)
    cleanup()
  })

  void it("returns false for null", () => {
    assert.equal(isTextEntryTarget(null), false)
  })
})

void describe("isModalOrDialogOpen", () => {
  void it("returns false when no modals are visible", () => {
    const { cleanup } = installDom()
    assert.equal(isModalOrDialogOpen(), false)
    cleanup()
  })

  void it("returns true when a visible modal exists", () => {
    const { cleanup } = installDom()
    const modal = document.getElementById("modal-1")
    if (modal) modal.classList.remove("hidden")
    assert.equal(isModalOrDialogOpen(), true)
    cleanup()
  })

  void it("returns false when modal is hidden", () => {
    const { cleanup } = installDom()
    const modal = document.getElementById("modal-1")
    if (modal) modal.classList.add("hidden")
    assert.equal(isModalOrDialogOpen(), false)
    cleanup()
  })
})

void describe("Shortcut registry", () => {
  void it("dispatches a matching shortcut", () => {
    const { cleanup } = installDom()
    let fired = false
    registerShortcut({
      key: "a",
      ctrl: true,
      handler: () => { fired = true },
    })
    const dispatcher = createShortcutDispatcher()
    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })
    dispatcher(event)
    assert.equal(fired, true)
    cleanup()
  })

  void it("skips a non-matching shortcut", () => {
    const { cleanup } = installDom()
    let fired = false
    registerShortcut({
      key: "b",
      ctrl: true,
      handler: () => { fired = true },
    })
    const dispatcher = createShortcutDispatcher()
    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })
    dispatcher(event)
    assert.equal(fired, false)
    cleanup()
  })

  void it("respects skipInTextInput", () => {
    const { cleanup } = installDom()
    let fired = false
    registerShortcut({
      key: "e",
      ctrl: true,
      shift: true,
      skipInTextInput: true,
      handler: () => { fired = true },
    })
    const dispatcher = createShortcutDispatcher()
    const input = document.getElementById("text-input") as HTMLInputElement
    const event = new KeyboardEvent("keydown", { key: "e", ctrlKey: true, shiftKey: true, bubbles: true })
    input.dispatchEvent(event)
    dispatcher(event)
    assert.equal(fired, false, "should not fire in text input")
    cleanup()
  })

  void it("respects skipInModal", () => {
    const { cleanup } = installDom()
    let fired = false
    registerShortcut({
      key: "e",
      ctrl: true,
      shift: true,
      skipInModal: true,
      handler: () => { fired = true },
    })
    const dispatcher = createShortcutDispatcher()
    const modal = document.getElementById("modal-1")
    if (modal) modal.classList.remove("hidden")
    const event = new KeyboardEvent("keydown", { key: "e", ctrlKey: true, shiftKey: true, bubbles: true })
    dispatcher(event)
    assert.equal(fired, false, "should not fire in modal")
    cleanup()
  })

  void it("fires in the right context (button, not text input)", () => {
    const { cleanup } = installDom()
    let fired = false
    registerShortcut({
      key: "e",
      ctrl: true,
      shift: true,
      skipInTextInput: true,
      handler: () => { fired = true },
    })
    const dispatcher = createShortcutDispatcher()
    const btn = document.getElementById("regular-button") as HTMLButtonElement
    const event = new KeyboardEvent("keydown", { key: "e", ctrlKey: true, shiftKey: true, bubbles: true })
    btn.dispatchEvent(event)
    dispatcher(event)
    assert.equal(fired, true, "should fire when button is focused")
    cleanup()
  })

  void it("processes multiple registered shortcuts", () => {
    const { cleanup } = installDom()
    const fired: string[] = []
    registerShortcut({ key: "a", ctrl: true, handler: () => fired.push("a") })
    registerShortcut({ key: "b", ctrl: true, handler: () => fired.push("b") })
    const dispatcher = createShortcutDispatcher()
    dispatcher(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }))
    assert.deepEqual(fired, ["a"], "only the matching shortcut fires")
    cleanup()
  })
})
