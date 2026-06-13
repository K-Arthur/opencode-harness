import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { demoteStreamingText, finalizeStreamingText } from "./streamHandlers"

let document: Document

beforeEach(() => {
  const dom = new JSDOM(`<!doctype html><div id="message-list"></div>`)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  document = dom.window.document
})

function list(): HTMLElement {
  return document.getElementById("message-list")!
}

describe("demoteStreamingText", () => {
  it("removes the streaming-text class so the blinking caret stops", () => {
    const el = document.createElement("div")
    el.className = "msg-text streaming-text"
    el.textContent = "hello"
    list().appendChild(el)

    demoteStreamingText(el)

    assert.equal(el.classList.contains("streaming-text"), false)
    assert.equal(el.classList.contains("msg-text"), true, "real content is preserved as plain text")
    assert.equal(el.isConnected, true, "an element with content stays in the DOM")
  })

  it("removes an empty streaming element entirely (no blank line with a cursor)", () => {
    const el = document.createElement("div")
    el.className = "msg-text streaming-text"
    list().appendChild(el)

    demoteStreamingText(el)

    assert.equal(el.isConnected, false, "an empty leftover is dropped")
  })

  it("keeps an element that has child nodes even if textContent is blank", () => {
    const el = document.createElement("div")
    el.className = "msg-text streaming-text"
    el.appendChild(document.createElement("img"))
    list().appendChild(el)

    demoteStreamingText(el)

    assert.equal(el.isConnected, true)
    assert.equal(el.classList.contains("streaming-text"), false)
  })
})

describe("finalizeStreamingText (end-of-turn sweep)", () => {
  it("demotes every lingering streaming-text element in the list", () => {
    const withText = document.createElement("div")
    withText.className = "msg-text streaming-text"
    withText.textContent = "done"
    const empty = document.createElement("div")
    empty.className = "msg-text streaming-text"
    const plain = document.createElement("div")
    plain.className = "msg-text"
    plain.textContent = "already final"
    list().append(withText, empty, plain)

    finalizeStreamingText(list())

    assert.equal(list().querySelectorAll(".streaming-text").length, 0, "no streaming caret survives")
    assert.equal(withText.isConnected, true, "the one with content is kept (cursorless)")
    assert.equal(empty.isConnected, false, "the empty one is removed")
    assert.equal(plain.textContent, "already final", "non-streaming nodes are untouched")
  })

  it("is a no-op when nothing is streaming (idempotent)", () => {
    const plain = document.createElement("div")
    plain.className = "msg-text"
    plain.textContent = "x"
    list().appendChild(plain)

    finalizeStreamingText(list())
    finalizeStreamingText(list())

    assert.equal(list().querySelectorAll(".streaming-text").length, 0)
    assert.equal(plain.isConnected, true)
  })
})
