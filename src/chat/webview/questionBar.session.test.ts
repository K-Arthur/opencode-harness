/**
 * Regression tests for the multi-session question-bar bleed bug.
 *
 * Reported: the "Question from model" bar appeared for the WRONG session when
 * two tabs were open. Root cause: addQuestion tagged the item with the *viewed*
 * session (_activeSessionId) whenever the block omitted sessionId, ignoring the
 * authoritative envelope sid the dispatcher already carries. Fix: addQuestion
 * accepts the envelope sid and prefers block.sessionId → sid → active.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { QuestionBlock } from "./types"
import { initQuestionBar, addQuestion, clearAllQuestions, setActiveSession, getActiveQuestionCount, repopulateFromMessages } from "./questionBar"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="question-bar" class="hidden">
      <span id="question-bar-count" class="hidden"></span>
      <div id="question-bar-items"></div>
      <button id="question-bar-submit" disabled>Submit</button>
      <textarea class="question-bar-freetext" style="display:none"></textarea>
    </div></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

const block = (over: Record<string, unknown> = {}): QuestionBlock =>
  ({ type: "question", id: "q", toolCallId: "q", groups: [{ question: "Pick", options: ["A", "B"], multiSelect: false }], allowFreeText: true, ...over } as QuestionBlock)

describe("question bar — session attribution (multi-tab)", () => {
  beforeEach(() => { setupDom(); initQuestionBar(() => {}); clearAllQuestions() })

  it("attributes a question to the envelope sid, not the viewed session, when the block omits sessionId", () => {
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qB", sessionId: undefined }), "mB", "B")
    assert.equal(getActiveQuestionCount(), 0, "must NOT show on viewed session A")
    setActiveSession("B")
    assert.equal(getActiveQuestionCount(), 1, "shows on its real session B")
  })

  it("still honors an explicit block.sessionId over the envelope sid", () => {
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qC", sessionId: "C" }), "mC", "B")
    setActiveSession("C")
    assert.equal(getActiveQuestionCount(), 1)
  })

  it("falls back to active when neither block.sessionId nor sid is provided (single-tab)", () => {
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qA", sessionId: undefined }), "mA")
    assert.equal(getActiveQuestionCount(), 1)
  })

  // Regression: repopulateFromMessages(sessionId, messages) is called on tab
  // switch (main.ts switchTab, BEFORE setActiveSession(tabId) runs for the new
  // tab) and on init_state resume. It forwarded persisted blocks to addQuestion
  // with no envelope sid, so a block saved with no sessionId of its own (e.g.
  // one built by the live-stream path, which never stamps sessionId) fell back
  // to _activeSessionId — at that moment still the PREVIOUS tab — attributing
  // the repopulated session's own question to the tab being switched away from.
  it("attributes a repopulated block with no sessionId to the session being repopulated, not the still-active previous tab", () => {
    setActiveSession("A")
    const messages = [{ id: "mB", blocks: [{ type: "question", toolCallId: "qNoSid", answered: true, groups: [{ question: "Pick", options: ["A", "B"], multiSelect: false }] }] }]
    repopulateFromMessages("B", messages as any)
    
    const el = document.querySelector('[data-question-id="qNoSid"]') as HTMLElement
    assert.ok(el, "should be rendered in DOM")

    setActiveSession("A")
    assert.ok(!document.querySelector('[data-question-id="qNoSid"]'), "must NOT be visible/present on session A")
  })
})
