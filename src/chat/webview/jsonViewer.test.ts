import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderJsonViewer } from "./jsonViewer"

function withDom(fn: () => void): void {
  const dom = new JSDOM("<!doctype html><body></body>")
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  try {
    fn()
  } finally {
    ;(globalThis as unknown as { document: Document | undefined }).document = prevDoc
    ;(globalThis as unknown as { window: Window | undefined }).window = prevWin
  }
}

describe("renderJsonViewer", () => {
  it("renders a string value", () => withDom(() => {
    const el = renderJsonViewer("hello")
    const jvStr = el.querySelector(".jv-str")
    assert.ok(jvStr, "should have .jv-str span")
    assert.match(jvStr?.textContent ?? "", /hello/)
  }))

  it("renders a number value", () => withDom(() => {
    const el = renderJsonViewer(42)
    const jvNum = el.querySelector(".jv-num")
    assert.ok(jvNum)
    assert.equal(jvNum?.textContent, "42")
  }))

  it("renders null", () => withDom(() => {
    const el = renderJsonViewer(null)
    const jvNull = el.querySelector(".jv-null")
    assert.ok(jvNull)
    assert.equal(jvNull?.textContent, "null")
  }))

  it("renders boolean", () => withDom(() => {
    const el = renderJsonViewer(true)
    const jvBool = el.querySelector(".jv-bool")
    assert.ok(jvBool)
    assert.equal(jvBool?.textContent, "true")
  }))

  it("renders empty array as []", () => withDom(() => {
    const el = renderJsonViewer([])
    assert.match(el.textContent ?? "", /\[\]/)
  }))

  it("renders empty object as {}", () => withDom(() => {
    const el = renderJsonViewer({})
    assert.match(el.textContent ?? "", /\{\}/)
  }))

  it("renders object keys and values", () => withDom(() => {
    const el = renderJsonViewer({ name: "Alice", age: 30 })
    assert.match(el.textContent ?? "", /name/)
    assert.match(el.textContent ?? "", /Alice/)
    assert.match(el.textContent ?? "", /age/)
  }))

  it("renders array items with indices", () => withDom(() => {
    const el = renderJsonViewer(["a", "b", "c"])
    assert.match(el.textContent ?? "", /0:/)
    assert.match(el.textContent ?? "", /1:/)
    assert.match(el.textContent ?? "", /2:/)
  }))

  it("truncates at maxDepth with ellipsis", () => withDom(() => {
    const deep = { a: { b: { c: { d: "deep" } } } }
    const el = renderJsonViewer(deep, { maxDepth: 2 })
    assert.match(el.textContent ?? "", /…/)
    assert.doesNotMatch(el.textContent ?? "", /deep/)
  }))

  it("includes a Copy JSON button", () => withDom(() => {
    const el = renderJsonViewer({ x: 1 })
    const btn = el.querySelector(".jv-copy-btn")
    assert.ok(btn, "should have copy button")
  }))

  it("does not render deep values beyond default maxDepth of 3", () => withDom(() => {
    const deep = { a: { b: { c: { d: "tooDeep" } } } }
    const el = renderJsonViewer(deep)
    assert.doesNotMatch(el.textContent ?? "", /tooDeep/)
    assert.match(el.textContent ?? "", /…/)
  }))
})
