import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { Block, ChatMessage, ToolCallBlock } from "./types"

let cleanupDom: (() => void) | null = null

function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLDetailsElement: globalThis.HTMLDetailsElement,
    Node: globalThis.Node,
  }
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement
  ;(globalThis as unknown as { HTMLDetailsElement: typeof HTMLDetailsElement }).HTMLDetailsElement = dom.window.HTMLDetailsElement
  ;(globalThis as unknown as { Node: typeof Node }).Node = dom.window.Node
  cleanupDom = () => {
    ;(globalThis as unknown as typeof previous).document = previous.document
    ;(globalThis as unknown as typeof previous).window = previous.window
    ;(globalThis as unknown as typeof previous).HTMLElement = previous.HTMLElement
    ;(globalThis as unknown as typeof previous).HTMLDetailsElement = previous.HTMLDetailsElement
    ;(globalThis as unknown as typeof previous).Node = previous.Node
    dom.window.close()
    cleanupDom = null
  }
}

function tool(id: string, name: string, cls: ToolCallBlock["class"]): ToolCallBlock {
  return {
    type: "tool-call",
    id,
    name,
    class: cls,
    state: "result",
    args: {},
    result: "ok",
  }
}

function childKind(el: Element): string {
  if (el.matches("details.tool-group")) return "group"
  if (el.matches("details.tool-call")) return "tool"
  // exec/shell tools render as standalone live command cards (feature 440a68c),
  // not as the generic details.tool-call element.
  if (el.matches(".live-command-card")) return "command"
  if (el.classList.contains("msg-text")) return "text"
  return el.tagName.toLowerCase()
}

afterEach(() => {
  cleanupDom?.()
})

describe("messageRenderer tool grouping", () => {
  it("keeps text-separated tool calls as separate visible rows in order", async () => {
    installDom()
    const { renderMessage } = await import("./messageRenderer")
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      sessionId: "s1",
      timestamp: Date.now(),
      blocks: [
        tool("t1", "bash", "exec") as Block,
        { type: "text", text: "Now I will edit the file." } as Block,
        tool("t2", "edit", "write") as Block,
      ],
    }

    const el = renderMessage(msg)
    const bubble = el.querySelector(".message-bubble")
    assert.ok(bubble, "assistant message must render a bubble")

    const visibleKinds = Array.from(bubble!.children).map(childKind)
    // exec tool (t1) → live command card; write tool (t2) → tool-call details.
    // Both stay as separate visible rows around the text, in order.
    assert.deepEqual(visibleKinds, ["command", "text", "tool"])
    assert.equal(bubble!.querySelectorAll(":scope > details.tool-group").length, 0)
  })
})
