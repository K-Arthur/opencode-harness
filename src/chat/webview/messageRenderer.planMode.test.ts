import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let cleanupDom: (() => void) | null = null

function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
  }

  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
  })

  cleanupDom = () => {
    Object.assign(globalThis, previous)
    dom.window.close()
    cleanupDom = null
  }
}

afterEach(() => {
  cleanupDom?.()
})

void describe("messageRenderer plan-mode prose", () => {
  const planShapedUserText = [
    "Please review the frontend changes.",
    "",
    "Steps:",
    "1. Inspect the affected files.",
    "2. Propose safe fixes.",
  ].join("\n")

  void it("does not render user text as a Proposed Plan in plan mode", async () => {
    installDom()
    const { renderMessage } = await import("./messageRenderer")

    const el = renderMessage({
      id: "u1",
      role: "user",
      sessionId: "s1",
      blocks: [{ type: "text", text: planShapedUserText }],
      timestamp: 1,
    }, { mode: "plan" })

    assert.equal(el.querySelector(".plan-prose"), null)
    assert.equal(el.textContent?.includes("Proposed Plan"), false)
  })

  void it("still renders assistant plan prose as a Proposed Plan in plan mode", async () => {
    installDom()
    const { renderMessage } = await import("./messageRenderer")

    const el = renderMessage({
      id: "a1",
      role: "assistant",
      sessionId: "s1",
      blocks: [{ type: "text", text: planShapedUserText }],
      timestamp: 1,
    }, { mode: "plan" })

    assert.ok(el.querySelector(".plan-prose"))
    assert.equal(el.textContent?.includes("Proposed Plan"), true)
  })
})
