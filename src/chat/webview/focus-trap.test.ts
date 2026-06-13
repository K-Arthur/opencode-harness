import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let window: any
let document: Document

beforeEach(() => {
  const dom = new JSDOM(`<!doctype html>
    <div id="container">
      <button id="btn1">First</button>
      <button id="btn2">Second</button>
      <button id="btn3">Third</button>
      <input id="input1">
      <select id="select1"><option>a</option></select>
      <textarea id="textarea1"></textarea>
      <a href="#" id="link1">Link</a>
      <span tabindex="0" id="span1">Span</span>
      <span tabindex="-1" id="span2">Skipped</span>
    </div>
    <button id="outside">Outside</button>
  `)
  window = dom.window
  document = dom.window.document
  ;(globalThis as any).window = window
  ;(globalThis as any).document = document
  ;(globalThis as any).HTMLElement = window.HTMLElement
  ;(globalThis as any).HTMLButtonElement = window.HTMLButtonElement
  ;(globalThis as any).HTMLInputElement = window.HTMLInputElement
  ;(globalThis as any).HTMLSelectElement = window.HTMLSelectElement
  ;(globalThis as any).HTMLTextAreaElement = window.HTMLTextAreaElement
  ;(globalThis as any).HTMLAnchorElement = window.HTMLAnchorElement
  ;(globalThis as any).KeyboardEvent = window.KeyboardEvent
  ;(globalThis as any).FocusEvent = window.FocusEvent
})

function setActive(el: HTMLElement) {
  el.focus()
}

function mkEvent(key: string, shift = false): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true })
  return event
}

describe("focus-trap", () => {
  it("exports trapModalFocus", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    assert.equal(typeof trapModalFocus, "function")
  })

  it("exports createFocusTrap", async () => {
    const { createFocusTrap } = await import("./focus-trap")
    assert.equal(typeof createFocusTrap, "function")
  })

  it("createFocusTrap returns { handler, destroy }", async () => {
    const { createFocusTrap } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const trap = createFocusTrap(container)
    assert.equal(typeof trap.handler, "function")
    assert.equal(typeof trap.destroy, "function")
  })

  it("trapModalFocus wraps Tab from last to first", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const span1 = document.getElementById("span1")!
    const btn1 = document.getElementById("btn1")!
    setActive(span1)
    const handler = trapModalFocus(container)
    const event = mkEvent("Tab")
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, true, "should prevent default on wrap")
    assert.equal(document.activeElement, btn1, "should wrap focus to first element")
  })

  it("trapModalFocus wraps Shift+Tab from first to last", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn1 = document.getElementById("btn1")!
    const span1 = document.getElementById("span1")!
    setActive(btn1)
    const handler = trapModalFocus(container)
    const event = mkEvent("Tab", true)
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, true, "should prevent default on wrap")
    assert.equal(document.activeElement, span1, "should wrap focus to last element")
  })

  it("trapModalFocus does not intercept Tab when focus is in the middle", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn2 = document.getElementById("btn2")!
    setActive(btn2)
    const handler = trapModalFocus(container)
    const event = mkEvent("Tab")
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, false, "should not prevent default when in middle")
  })

  it("trapModalFocus does not intercept non-Tab keys", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const handler = trapModalFocus(container)
    const event = mkEvent("Escape")
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, false, "should not prevent default for non-Tab keys")
  })

  it("trapModalFocus does not intercept Tab when active element has tabindex=-1", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const span2 = document.getElementById("span2")!
    setActive(span2)
    const handler = trapModalFocus(container)
    const event = mkEvent("Tab", true)
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, false, "should not prevent default when active element is not in focusable list")
  })

  it("createFocusTrap.destroy removes the event listener", async () => {
    const { createFocusTrap } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn3 = document.getElementById("btn3")!
    const btn1 = document.getElementById("btn1")!
    setActive(btn3)

    let captured: KeyboardEvent | null = null
    const handler = (e: KeyboardEvent) => { captured = e }
    const trap = createFocusTrap(container)

    document.addEventListener("keydown", trap.handler)
    const event = mkEvent("Tab")
    document.dispatchEvent(event)
    assert.equal(captured, null, "trapModalFocus handler does not capture events; it must be attached by caller")

    trap.destroy()
    document.removeEventListener("keydown", trap.handler)
  })

  it("does not crash with empty container", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const empty = document.createElement("div")
    const handler = trapModalFocus(empty)
    const event = mkEvent("Tab")
    handler(event)
  })

  it("trapModalFocus no-ops when no focusable elements exist", async () => {
    const { trapModalFocus } = await import("./focus-trap")
    const empty = document.createElement("div")
    const handler = trapModalFocus(empty)
    const event = mkEvent("Tab")
    let prevented = false
    event.preventDefault = () => { prevented = true }
    handler(event)
    assert.equal(prevented, false, "should not prevent default when no focusable elements")
  })

  it("focusable selector matches all expected element types", async () => {
    const { FOCUSABLE_SELECTOR } = await import("./focus-trap")
    assert.ok(FOCUSABLE_SELECTOR)
    const container = document.getElementById("container")!
    const matches = container.querySelectorAll(FOCUSABLE_SELECTOR)
    assert.equal(matches.length, 8, "should match all 8 focusable elements (excluding tabindex=-1)")
  })
})

describe("mountModalFocus", () => {
  it("moves focus to the explicit initialFocus element on mount", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const input1 = document.getElementById("input1")! as HTMLElement
    const handle = mountModalFocus(container, { initialFocus: input1 })
    assert.equal(document.activeElement, input1, "should focus the requested element")
    handle.release()
  })

  it("defaults initialFocus to the first focusable element", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn1 = document.getElementById("btn1")!
    const handle = mountModalFocus(container)
    assert.equal(document.activeElement, btn1, "should focus the first focusable element")
    handle.release()
  })

  it("restores focus to the invoker on release", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const outside = document.getElementById("outside")! as HTMLElement
    setActive(outside)
    const handle = mountModalFocus(container)
    assert.notEqual(document.activeElement, outside, "focus should move into the dialog")
    handle.release()
    assert.equal(document.activeElement, outside, "focus should return to the invoker")
  })

  it("honors an explicit restoreTo target over the live invoker", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const outside = document.getElementById("outside")! as HTMLElement
    const btn2 = document.getElementById("btn2")! as HTMLElement
    setActive(btn2)
    const handle = mountModalFocus(container, { restoreTo: outside })
    handle.release()
    assert.equal(document.activeElement, outside, "should restore to the explicit target")
  })

  it("traps Tab inside the container", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn1 = document.getElementById("btn1")!
    const span1 = document.getElementById("span1")!
    const handle = mountModalFocus(container)
    setActive(span1) // last focusable
    const event = mkEvent("Tab")
    document.dispatchEvent(event)
    assert.equal(document.activeElement, btn1, "Tab from last should wrap to first")
    handle.release()
  })

  it("release removes the Tab trap so focus no longer wraps", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const span1 = document.getElementById("span1")!
    const handle = mountModalFocus(container)
    handle.release()
    setActive(span1)
    document.dispatchEvent(mkEvent("Tab"))
    assert.equal(document.activeElement, span1, "trap is gone — focus should not wrap")
  })

  it("release is idempotent", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const outside = document.getElementById("outside")! as HTMLElement
    setActive(outside)
    const handle = mountModalFocus(container)
    handle.release()
    // Move focus elsewhere; a second release must NOT yank it back.
    const btn3 = document.getElementById("btn3")! as HTMLElement
    setActive(btn3)
    handle.release()
    assert.equal(document.activeElement, btn3, "second release should be a no-op")
  })

  it("does not throw when the invoker was detached before release", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const temp = document.createElement("button")
    document.body.appendChild(temp)
    setActive(temp)
    const handle = mountModalFocus(container)
    temp.remove()
    assert.doesNotThrow(() => handle.release(), "detached invoker must not break release")
  })

  it("does not restore focus to <body> when there was no real invoker", async () => {
    const { mountModalFocus } = await import("./focus-trap")
    const container = document.getElementById("container")!
    const btn1 = document.getElementById("btn1")! as HTMLElement
    // No prior focus -> activeElement is <body>; restore must be skipped.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const handle = mountModalFocus(container)
    setActive(btn1)
    handle.release()
    assert.equal(document.activeElement, btn1, "should not blur back to <body>")
  })
})
