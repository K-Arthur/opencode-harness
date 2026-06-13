import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let document: Document

beforeEach(() => {
  const dom = new JSDOM(`<!doctype html><div id="list"></div>`)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).Node = dom.window.Node
  document = dom.window.document
})

describe("finalizeStreamingText", () => {
  it("demotes a streaming-text with content to a cursorless msg-text (content preserved)", async () => {
    const { finalizeStreamingText } = await import("./streamHandlers")
    const list = document.getElementById("list")!
    list.innerHTML = `<div class="msg-text streaming-text">hello</div>`
    finalizeStreamingText(list)
    const el = list.querySelector(".msg-text")!
    assert.equal(el.classList.contains("streaming-text"), false, "streaming class (cursor) removed")
    assert.equal(el.textContent, "hello", "content preserved")
  })

  it("removes an empty streaming-text element entirely (kills the orphan cursor)", async () => {
    const { finalizeStreamingText } = await import("./streamHandlers")
    const list = document.getElementById("list")!
    list.innerHTML = `<div class="msg-text streaming-text"></div>`
    finalizeStreamingText(list)
    assert.equal(list.querySelector(".streaming-text"), null, "no lingering streaming cursor")
    assert.equal(list.querySelector(".msg-text"), null, "empty orphan removed entirely")
  })

  it("keeps a streaming-text that has child elements (frozen/tail spans)", async () => {
    const { finalizeStreamingText } = await import("./streamHandlers")
    const list = document.getElementById("list")!
    list.innerHTML = `<div class="msg-text streaming-text"><span class="stream-frozen">done</span></div>`
    finalizeStreamingText(list)
    const el = list.querySelector(".msg-text")!
    assert.ok(el, "element kept (has rendered content)")
    assert.equal(el.classList.contains("streaming-text"), false, "cursor class removed")
    assert.equal(el.querySelector(".stream-frozen")?.textContent, "done")
  })

  it("sweeps multiple lingering elements", async () => {
    const { finalizeStreamingText } = await import("./streamHandlers")
    const list = document.getElementById("list")!
    list.innerHTML = `<div class="msg-text streaming-text">a</div><div class="msg-text streaming-text">b</div>`
    finalizeStreamingText(list)
    assert.equal(list.querySelectorAll(".streaming-text").length, 0)
    assert.equal(list.querySelectorAll(".msg-text").length, 2)
  })

  it("is a no-op on a clean list", async () => {
    const { finalizeStreamingText } = await import("./streamHandlers")
    const list = document.getElementById("list")!
    list.innerHTML = `<div class="msg-text">plain</div>`
    finalizeStreamingText(list)
    assert.equal(list.querySelector(".msg-text")?.textContent, "plain")
  })

  it("demoteStreamingText drops an empty node but keeps one with content", async () => {
    const { demoteStreamingText } = await import("./streamHandlers")
    const withText = document.createElement("div")
    withText.className = "msg-text streaming-text"
    withText.textContent = "kept"
    demoteStreamingText(withText)
    assert.equal(withText.classList.contains("streaming-text"), false)
    assert.equal(withText.textContent, "kept")

    const empty = document.createElement("div")
    empty.className = "msg-text streaming-text"
    document.getElementById("list")!.appendChild(empty)
    demoteStreamingText(empty)
    assert.equal(empty.isConnected, false, "empty node removed from the DOM")
  })
})
