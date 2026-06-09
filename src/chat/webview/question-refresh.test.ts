/**
 * The question tool's input frequently finishes streaming AFTER its block was
 * first rendered (an empty `stream_tool_start`). refreshQuestionBlock must
 * re-parse the fuller args, update the persisted block, and re-render the
 * `.question-block` DOM in place so the text + pointer hint appear without
 * waiting for stream_end.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

describe("refreshQuestionBlock", () => {
  beforeEach(() => setupDom())

  it("fills text when args arrive after an empty start, re-renders pointer", async () => {
    const { renderBlock } = await import("./renderer")
    const { refreshQuestionBlock } = await import("./streamHandlers")

    const block: any = {
      type: "question",
      id: "tool-q-1",
      toolCallId: "tool-q-1",
      sessionId: "sess-A",
      groups: [],
      text: "",
      options: [],
      allowFreeText: true,
    }
    const messages: any[] = [{ id: "msg-1", role: "assistant", blocks: [block] }]

    const messageList = dom.window.document.createElement("div")
    const initial = renderBlock(block, { postMessage: () => {}, messageId: "msg-1" })!
    messageList.appendChild(initial)
    assert.ok(!messageList.textContent!.includes("Pick a DB"), "starts empty")

    const posted: Array<Record<string, unknown>> = []
    const els: any = { messageList }
    const handled = refreshQuestionBlock(
      els,
      messages,
      "tool-q-1",
      { question: "Pick a DB", options: ["Postgres", "MySQL"] },
      (m) => posted.push(m),
      "msg-1",
    )

    assert.equal(handled, true, "must report it handled the question")
    assert.equal(block.text, "Pick a DB", "persisted block text updated")
    assert.deepEqual(block.options, ["Postgres", "MySQL"])

    const rerendered = messageList.querySelector(".question-block") as HTMLElement
    assert.ok(rerendered.textContent!.includes("Pick a DB"))
    assert.equal(
      rerendered.querySelectorAll(".question-option").length,
      0,
      "pointer mode — no interactive options in transcript",
    )
    assert.ok(
      rerendered.querySelector(".question-pointer-hint"),
      "pointer hint present after refresh",
    )
  })

  it("returns true but keeps existing content when the update is still empty", async () => {
    const { renderBlock } = await import("./renderer")
    const { refreshQuestionBlock } = await import("./streamHandlers")

    const block: any = {
      type: "question",
      id: "tool-q-2",
      toolCallId: "tool-q-2",
      sessionId: "sess-A",
      groups: [{ question: "Keep me", options: ["A"], multiSelect: false }],
      text: "Keep me",
      options: ["A"],
      allowFreeText: false,
    }
    const messages: any[] = [{ id: "msg-1", role: "assistant", blocks: [block] }]
    const messageList = dom.window.document.createElement("div")
    messageList.appendChild(renderBlock(block, { postMessage: () => {} })!)

    const handled = refreshQuestionBlock({ messageList } as any, messages, "tool-q-2", {}, () => {})
    assert.equal(handled, true, "handled (don't fall through to tool-card path)")
    assert.equal(block.text, "Keep me", "empty update must not wipe existing content")
  })

  it("returns false when no question block matches the id", async () => {
    const { refreshQuestionBlock } = await import("./streamHandlers")
    const messages: any[] = [{ id: "msg-1", role: "assistant", blocks: [{ type: "tool-call", id: "t1" }] }]
    const messageList = dom.window.document.createElement("div")
    const handled = refreshQuestionBlock({ messageList } as any, messages, "t1", { question: "q" }, () => {})
    assert.equal(handled, false)
  })
})
