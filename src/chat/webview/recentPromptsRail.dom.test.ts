/**
 * DOM tests for the recent/pinned prompts rail (brief Phase 5 "Pinned Prompts").
 * Wires the pure buildPromptRail core (src/prompts/recentPrompts.ts) into a
 * webview surface: derives prompts from a session's user messages, renders
 * pinned-first chips, and exposes pin-toggle + click-to-reuse callbacks.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderRecentPromptsRail } from "./recentPromptsRail"
import type { ChatMessage } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="rail"></div></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  return dom.window.document.getElementById("rail")!
}

const userMsg = (id: string, text: string, ts: number): ChatMessage =>
  ({ id, role: "user", timestamp: ts, blocks: [{ type: "text", text }] } as unknown as ChatMessage)

describe("renderRecentPromptsRail", () => {
  let container: HTMLElement
  beforeEach(() => { container = setupDom() })

  it("hides the rail when there are no user prompts", () => {
    renderRecentPromptsRail(container, { messages: [], pinnedIds: [], onPin: () => {}, onPick: () => {} })
    assert.equal(container.classList.contains("hidden"), true)
    assert.equal(container.querySelectorAll(".rp-chip").length, 0)
  })

  it("renders newest prompts first and shows pinned ones on top", () => {
    const messages = [userMsg("m1", "first task", 1), userMsg("m2", "second task", 2), userMsg("m3", "third task", 3)]
    renderRecentPromptsRail(container, { messages, pinnedIds: ["m1"], onPin: () => {}, onPick: () => {}, maxRecent: 5 })
    assert.equal(container.classList.contains("hidden"), false)
    
    // First (m1, pinned) is a featured card
    const card = container.querySelector(".rp-featured-card")!
    assert.ok(card, "must render the featured card")
    assert.equal(card.getAttribute("data-prompt-id"), "m1")
    assert.equal(card.classList.contains("rp-featured-card--pinned"), true)

    // The rest (m3, m2) are chips in the remaining container
    const chips = [...container.querySelectorAll(".rp-chip")]
    assert.deepEqual(chips.map((c) => c.getAttribute("data-prompt-id")), ["m3", "m2"])
  })

  it("invokes onPick with the prompt text when a card or chip is clicked", () => {
    let picked = ""
    renderRecentPromptsRail(container, { messages: [userMsg("m1", "reuse me", 1)], pinnedIds: [], onPin: () => {}, onPick: (t) => { picked = t } })
    container.querySelector<HTMLElement>(".rp-card-body")!.click()
    assert.equal(picked, "reuse me")
  })

  it("invokes onPin with the message id when the pin button is clicked", () => {
    let pinned = ""
    renderRecentPromptsRail(container, { messages: [userMsg("m1", "x", 1)], pinnedIds: [], onPin: (id) => { pinned = id }, onPick: () => {} })
    container.querySelector<HTMLElement>(".rp-card-pin-btn")!.click()
    assert.equal(pinned, "m1")
  })
})
