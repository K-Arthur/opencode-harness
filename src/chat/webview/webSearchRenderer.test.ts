import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { isWebSearchTool, renderWebSearchResult } from "./webSearchRenderer"
import type { ToolCallBlock } from "./types"

function withDom(fn: () => void): void {
  const dom = new JSDOM("<!doctype html><body></body>")
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  try { fn() } finally {
    ;(globalThis as unknown as { document: Document | undefined }).document = prevDoc
    ;(globalThis as unknown as { window: Window | undefined }).window = prevWin
  }
}

function makeBlock(name: string, result?: string): ToolCallBlock {
  return { type: "tool-call", id: "t1", name, class: "read", state: "result", result } as ToolCallBlock
}

describe("isWebSearchTool", () => {
  it("detects websearch", () => { assert.ok(isWebSearchTool(makeBlock("websearch"))) })
  it("detects web_search", () => { assert.ok(isWebSearchTool(makeBlock("web_search"))) })
  it("detects webfetch", () => { assert.ok(isWebSearchTool(makeBlock("webfetch"))) })
  it("detects fetch", () => { assert.ok(isWebSearchTool(makeBlock("fetch"))) })
  it("detects brave_search", () => { assert.ok(isWebSearchTool(makeBlock("brave_search"))) })
  it("does not flag read tool", () => { assert.ok(!isWebSearchTool(makeBlock("read_file"))) })
  it("does not flag bash tool", () => { assert.ok(!isWebSearchTool(makeBlock("bash"))) })
})

describe("renderWebSearchResult", () => {
  it("returns null for non-web tools", () => withDom(() => {
    const result = renderWebSearchResult(makeBlock("read_file", "some text"))
    assert.equal(result, null)
  }))

  it("returns null when no result", () => withDom(() => {
    const result = renderWebSearchResult(makeBlock("websearch"))
    assert.equal(result, null)
  }))

  it("renders structured JSON array results as cards", () => withDom(() => {
    const results = JSON.stringify([
      { title: "Page One", url: "https://example.com", snippet: "A useful snippet" },
      { title: "Page Two", url: "https://other.com", snippet: "Another snippet" },
    ])
    const el = renderWebSearchResult(makeBlock("websearch", results))
    assert.ok(el)
    const cards = el!.querySelectorAll(".ws-result-card")
    assert.equal(cards.length, 2)
    assert.match(el!.textContent ?? "", /Page One/)
    assert.match(el!.textContent ?? "", /example.com/)
    assert.match(el!.textContent ?? "", /A useful snippet/)
  }))

  it("shows result count header", () => withDom(() => {
    const results = JSON.stringify([
      { title: "T", url: "https://a.com", snippet: "S" },
    ])
    const el = renderWebSearchResult(makeBlock("websearch", results))
    assert.ok(el)
    const header = el!.querySelector(".ws-result-header")
    assert.ok(header)
    assert.match(header!.textContent ?? "", /1 result/)
  }))

  it("handles { results: [...] } wrapper shape", () => withDom(() => {
    const data = JSON.stringify({ results: [{ title: "Wrapped", url: "https://w.com", snippet: "s" }] })
    const el = renderWebSearchResult(makeBlock("websearch", data))
    assert.ok(el)
    assert.match(el!.textContent ?? "", /Wrapped/)
  }))

  it("falls back to plain text for non-JSON result", () => withDom(() => {
    const el = renderWebSearchResult(makeBlock("webfetch", "Here is some plain text content from the page."))
    assert.ok(el)
    const pre = el!.querySelector(".ws-plain-text")
    assert.ok(pre)
    assert.match(pre!.textContent ?? "", /plain text/)
  }))

  it("truncates snippets longer than 200 chars", () => withDom(() => {
    const longSnippet = "x".repeat(250)
    const results = JSON.stringify([{ title: "T", url: "https://a.com", snippet: longSnippet }])
    const el = renderWebSearchResult(makeBlock("websearch", results))
    assert.ok(el)
    const snippet = el!.querySelector(".ws-result-snippet")
    assert.ok((snippet?.textContent?.length ?? 999) <= 205)
  }))
})
