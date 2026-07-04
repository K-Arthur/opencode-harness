/**
 * Regression test: when handleToolUpdate upgrades a generic DETAILS tool card
 * to a file-edit card via renderFileEditCard, the "Open file" button must fire
 * postMessage({type:"open_file"}) — the original bug was that renderFileEditCard
 * was called without a postMessage option, so window.vscode was undefined and
 * the click silently did nothing.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM
let document: Document

function stubScrollAnchor() {
  return { scrollIfAnchored: () => {} } as any
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body><div id="list"></div></body></html>`)
  const w = dom.window as unknown as Window & typeof globalThis
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = w
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  globalThis.Node = dom.window.Node as unknown as typeof Node
  globalThis.MouseEvent = dom.window.MouseEvent as unknown as typeof MouseEvent
  globalThis.Event = dom.window.Event as unknown as typeof Event
  document = dom.window.document
})

describe("handleToolUpdate — file-edit card upgrade path", () => {
  it("open_file_btn_fires_postMessage_after_card_upgrade", async () => {
    const { handleToolUpdate } = await import("./streamHandlers")

    const list = document.getElementById("list") as HTMLDivElement
    const els = {
      messageList: list,
      typingIndicator: document.createElement("div"),
      typingLabel: document.createElement("span"),
      scrollAnchor: stubScrollAnchor(),
    }

    // Build a generic DETAILS tool card (the initial render for pending tools
    // where args are not yet available).
    const toolEl = document.createElement("details")
    toolEl.dataset.blockId = "tool-write-1"
    toolEl.dataset.toolName = "write"
    toolEl.dataset.toolClass = "write"
    list.appendChild(toolEl)

    const messages: Record<string, unknown>[] = []
    const postMessage = (m: Record<string, unknown>) => messages.push(m)

    // Upgrade: args arrive with a file path — must produce a file-edit card
    handleToolUpdate(els, "tool-write-1", {
      args: { path: "src/bar.ts", content: "export const bar = 2\n" },
      state: "running",
    }, postMessage)

    const card = list.querySelector(".file-edit-card")
    assert.ok(card, "tool card must be upgraded to .file-edit-card")

    const openBtn = card!.querySelector(".file-edit-card__open-btn") as HTMLButtonElement | null
    assert.ok(openBtn, ".file-edit-card__open-btn must exist on upgraded card")

    openBtn!.click()
    assert.equal(messages.length, 1, "click must fire exactly one postMessage")
    assert.deepEqual(messages[0], { type: "open_file", path: "src/bar.ts" })
  })

  it("open_file_btn_no_op_without_postMessage_does_not_throw", async () => {
    const { handleToolUpdate } = await import("./streamHandlers")

    const list = document.getElementById("list") as HTMLDivElement
    const els = {
      messageList: list,
      typingIndicator: document.createElement("div"),
      typingLabel: document.createElement("span"),
      scrollAnchor: stubScrollAnchor(),
    }

    const toolEl = document.createElement("details")
    toolEl.dataset.blockId = "tool-write-2"
    toolEl.dataset.toolName = "write"
    toolEl.dataset.toolClass = "write"
    list.appendChild(toolEl)

    // No postMessage provided — should not throw
    handleToolUpdate(els, "tool-write-2", {
      args: { path: "src/baz.ts", content: "const baz = 3\n" },
    })

    const card = list.querySelector(".file-edit-card")
    assert.ok(card, "card must still be created without postMessage")
    const btn = card!.querySelector(".file-edit-card__open-btn") as HTMLButtonElement | null
    assert.ok(btn)
    assert.doesNotThrow(() => btn!.click(), "click without postMessage must not throw")
  })
})
