import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { MarkdownFileLinkDeps } from "./markdownFileLinks"
import { setupMarkdownFileLinksImpl } from "./markdownFileLinks"

function withDom(fn: (win: typeof globalThis) => void): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  const origDoc = globalThis.document
  globalThis.document = dom.window.document as unknown as Document
  try {
    fn(dom.window as unknown as typeof globalThis)
  } finally {
    globalThis.document = origDoc
  }
}

function createMockDeps(): { deps: MarkdownFileLinkDeps; messages: Record<string, unknown>[] } {
  const messages: Record<string, unknown>[] = []
  const deps: MarkdownFileLinkDeps = {
    vscode: { postMessage: (msg) => { messages.push(msg) } },
  }
  return { deps, messages }
}

describe("markdownFileLinks click handler", () => {
  it("posts open_file when clicking a file-link anchor", () => withDom(() => {
    const { deps, messages } = createMockDeps()
    document.body.innerHTML = `<div id="test"><a class="file-link" data-file-path="src/foo.ts:42">foo.ts</a></div>`
    setupMarkdownFileLinksImpl(deps)
    const anchor = document.querySelector("a.file-link") as HTMLAnchorElement
    anchor.click()
    assert.equal(messages.length, 1)
    assert.deepEqual(messages[0], { type: "open_file", path: "src/foo.ts:42" })
  }))

  it("does NOT intercept external (non-file-link) anchors", () => withDom(() => {
    const { deps, messages } = createMockDeps()
    document.body.innerHTML = `<div id="test"><a href="https://opencode.ai" target="_blank" rel="noopener noreferrer">link</a></div>`
    setupMarkdownFileLinksImpl(deps)
    const anchor = document.querySelector("a") as HTMLAnchorElement
    anchor.click()
    assert.equal(messages.length, 0, "must not post open_file for external links")
  }))

  it("posts open_file on Enter keydown for file-link anchors", () => withDom((win) => {
    const { deps, messages } = createMockDeps()
    document.body.innerHTML = `<div id="test"><a class="file-link" data-file-path="src/bar.ts" tabindex="0" role="button">bar.ts</a></div>`
    setupMarkdownFileLinksImpl(deps)
    const anchor = document.querySelector("a.file-link") as HTMLAnchorElement
    const KeyboardEventCtor = win.KeyboardEvent as unknown as typeof KeyboardEvent
    anchor.dispatchEvent(new KeyboardEventCtor("keydown", { key: "Enter", bubbles: true }))
    assert.equal(messages.length, 1)
    assert.deepEqual(messages[0], { type: "open_file", path: "src/bar.ts" })
  }))
})
