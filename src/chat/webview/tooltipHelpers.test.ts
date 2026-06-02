import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { applyTooltip, applyDisabledReasonTooltip } from "./tooltipHelpers"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

void describe("applyTooltip", () => {
  beforeEach(() => setupDom())

  void it("sets the title attribute on the element", () => {
    const el = document.createElement("button")
    applyTooltip(el, { title: "Send message (Ctrl+Enter)" })
    assert.equal(el.getAttribute("title"), "Send message (Ctrl+Enter)")
  })

  void it("sets the aria-label when provided", () => {
    const el = document.createElement("button")
    applyTooltip(el, { title: "Send", ariaLabel: "Send message" })
    assert.equal(el.getAttribute("title"), "Send")
    assert.equal(el.getAttribute("aria-label"), "Send message")
  })

  void it("does not touch aria-label when omitted", () => {
    const el = document.createElement("button")
    el.setAttribute("aria-label", "original")
    applyTooltip(el, { title: "Send" })
    assert.equal(el.getAttribute("aria-label"), "original")
  })

  void it("overrides a previous aria-label when applied twice", () => {
    const el = document.createElement("button")
    applyTooltip(el, { title: "first", ariaLabel: "First" })
    applyTooltip(el, { title: "second", ariaLabel: "Second" })
    assert.equal(el.getAttribute("title"), "second")
    assert.equal(el.getAttribute("aria-label"), "Second")
  })
})

void describe("applyDisabledReasonTooltip", () => {
  beforeEach(() => setupDom())

  void it("sets aria-disabled, title, and aria-label with Unavailable prefix", () => {
    const el = document.createElement("button")
    applyDisabledReasonTooltip(el, "No active session")
    assert.equal(el.getAttribute("aria-disabled"), "true")
    assert.equal(el.getAttribute("title"), "Unavailable: No active session")
    assert.equal(el.getAttribute("aria-label"), "Unavailable: No active session")
  })

  void it("uses an explicit ariaLabel override when provided", () => {
    const el = document.createElement("button")
    applyDisabledReasonTooltip(el, "Streaming", { ariaLabel: "Stop the current model response" })
    assert.equal(el.getAttribute("title"), "Unavailable: Streaming")
    assert.equal(el.getAttribute("aria-label"), "Stop the current model response")
  })

  void it("preserves the original aria-label when keepOriginalAria is true", () => {
    const el = document.createElement("button")
    el.setAttribute("aria-label", "Original")
    applyDisabledReasonTooltip(el, "Streaming", { keepOriginalAria: true })
    assert.equal(el.getAttribute("title"), "Unavailable: Streaming")
    assert.equal(el.getAttribute("aria-label"), "Original")
  })
})
