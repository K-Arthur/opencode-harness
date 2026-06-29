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
import { initQuestionBar, addQuestion, clearAllQuestions, setActiveSession, getActiveQuestionCount, repopulateFromMessages, getQuestionItem } from "./questionBar"

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

  it("trusts the envelope sid when block.sessionId conflicts with it", () => {
    // A mis-routed block may carry a stale block.sessionId. The envelope sid
    // from the dispatcher is authoritative — it must win so the question is
    // attached to the session it actually arrived for.
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qC", sessionId: "C" }), "mC", "B")
    assert.equal(getActiveQuestionCount(), 0, "must NOT show on viewed session A")
    setActiveSession("B")
    assert.equal(getActiveQuestionCount(), 1, "shows on envelope session B")
    setActiveSession("C")
    assert.equal(getActiveQuestionCount(), 0, "must NOT show on stale block session C")
  })

  it("falls back to active when neither block.sessionId nor sid is provided (single-tab)", () => {
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qA", sessionId: undefined }), "mA")
    assert.equal(getActiveQuestionCount(), 1)
  })

  // Regression: an empty-sessionId item from the active session was treated as a
  // wildcard in findMergeTarget, so a question for a background tab could merge
  // into it and inherit the wrong session. Items must only merge within the same
  // authoritative session.
  it("does not merge a question for a different session into an empty-sessionId item", () => {
    // No active session yet, so the first item lands with an empty sessionId.
    addQuestion(block({ toolCallId: "qEmpty", sessionId: undefined }), "m1")
    const itemEmpty = getQuestionItem("qEmpty")
    assert.equal(itemEmpty?.sessionId, "", "sanity: legacy item has empty sessionId")

    // User switches to A, then a background-tab question for B arrives with the
    // same toolCallId. It must NOT merge into the empty-sessionId item and take
    // its sessionId.
    setActiveSession("A")
    addQuestion(block({ toolCallId: "qEmpty", sessionId: undefined }), "m2", "B")
    const itemB = getQuestionItem("qEmpty")
    assert.equal(itemB?.sessionId, "B", "background question keeps envelope session B")
    assert.equal(getActiveQuestionCount(), 0, "must NOT show on viewed session A")
    setActiveSession("B")
    assert.equal(getActiveQuestionCount(), 1, "shows on envelope session B")
  })

  // Regression: repopulateFromMessages(sessionId, messages) is called on tab
  // switch. Previously it re-added answered questions to the bar, which caused
  // the bar to pop back up every time the user switched tabs and returned.
  // Answered questions are in the transcript — the bar should stay dismissed.
  it("does NOT re-add answered questions to the bar on repopulate (fixes tab-switch resurrection)", () => {
    setActiveSession("A")
    const messages = [{ id: "mB", blocks: [{ type: "question", toolCallId: "qNoSid", answered: true, groups: [{ question: "Pick", options: ["A", "B"], multiSelect: false }] }] }]
    repopulateFromMessages("B", messages)
    
    assert.ok(!document.querySelector('[data-question-id="qNoSid"]'), "answered questions must NOT be re-added to the bar on repopulate")

    setActiveSession("A")
    assert.ok(!document.querySelector('[data-question-id="qNoSid"]'), "must NOT be visible on session A either")
  })
})
