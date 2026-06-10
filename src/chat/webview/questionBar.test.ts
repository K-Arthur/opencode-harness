import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { QuestionBlock } from "./types"
import { initQuestionBar, addQuestion, clearAllQuestions, setActiveSession, removeQuestion, updateQuestion, markQuestionAnswered } from "./questionBar"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="question-bar" class="hidden" role="region" aria-label="Question from model">
      <div class="question-bar-header">
        <span class="question-bar-title">Question from model</span>
        <span id="question-bar-count" class="question-bar-count hidden"></span>
      </div>
      <div id="question-bar-items" class="question-bar-items"></div>
      <div class="question-bar-actions">
        <button id="question-bar-submit" class="question-bar-submit-btn" type="button" disabled>Submit Answer</button>
      </div>
    </div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  return dom
}

function makeBlock(overrides: Record<string, unknown> = {}): QuestionBlock {
  return {
    type: "question",
    id: "q-1",
    toolCallId: "q-1",
    requestID: "req-q-1",
    sessionId: "sess-1",
    groups: [{ question: "Pick one", options: ["A", "B"], multiSelect: false }],
    text: "Pick one",
    options: ["A", "B"],
    allowFreeText: true,
    ...overrides,
  } as QuestionBlock
}

describe("questionBar", () => {
  beforeEach(() => setupDom())

  it("addQuestion shows the bar with option buttons", () => {
    initQuestionBar(() => {})
    const bar = document.getElementById("question-bar")!
    assert.ok(bar.classList.contains("hidden"), "bar starts hidden")
    addQuestion(makeBlock(), "msg-1")
    assert.ok(!bar.classList.contains("hidden"), "bar is visible after addQuestion")
    const btns = bar.querySelectorAll(".question-bar-option")
    assert.equal(btns.length, 2, "renders 2 option buttons")
    assert.equal(btns[0]!.textContent, "A")
    assert.equal(btns[1]!.textContent, "B")
  })

  it("submitAllAnswers posts question_answer", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock(), "msg-1")
    const optBtns = document.querySelectorAll(".question-bar-option")
    ;(optBtns[0] as HTMLButtonElement).click()
    const submitBtn = document.getElementById("question-bar-submit") as HTMLButtonElement
    assert.ok(!submitBtn.disabled, "submit enabled after selection")
    submitBtn.click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "question_answer was posted")
    assert.equal(answer!.value, "Pick one: A", "correct value")
    assert.equal(answer!.requestID, "req-q-1")
  })

  it("clearAllQuestions hides the bar", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock(), "msg-1")
    const bar = document.getElementById("question-bar")!
    assert.ok(!bar.classList.contains("hidden"))
    clearAllQuestions()
    assert.ok(bar.classList.contains("hidden"), "bar hidden after clear")
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "no items remain")
  })

  it("submit only answers the active session's questions, not another session's selections", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))

    setActiveSession("sess-B")
    addQuestion(makeBlock({ id: "q-b", toolCallId: "q-b", requestID: "req-b", sessionId: "sess-B" }), "msg-b")
    ;(document.querySelector(".question-bar-option") as HTMLButtonElement).click()

    setActiveSession("sess-A")
    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", requestID: "req-a", sessionId: "sess-A" }), "msg-a")
    ;(document.querySelector(".question-bar-option") as HTMLButtonElement).click()
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()

    const answers = posted.filter((m) => m.type === "question_answer")
    assert.equal(answers.length, 1, "only the active session's answer is posted")
    assert.equal(answers[0]!.sessionId, "sess-A")
    assert.equal(answers[0]!.toolCallId, "q-a")
  })

  it("bar stays hidden and count badge ignores other sessions' pending questions", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-B")
    addQuestion(makeBlock({ id: "q-b1", toolCallId: "q-b1", sessionId: "sess-B" }), "msg-b1")
    addQuestion(makeBlock({ id: "q-b2", toolCallId: "q-b2", sessionId: "sess-B" }), "msg-b2")

    setActiveSession("sess-A")
    const bar = document.getElementById("question-bar")!
    assert.ok(bar.classList.contains("hidden"), "bar hidden when active session has no questions")

    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", sessionId: "sess-A" }), "msg-a")
    assert.ok(!bar.classList.contains("hidden"), "bar visible for the active session's question")
    const count = document.getElementById("question-bar-count")!
    assert.ok(count.classList.contains("hidden"), "count badge hidden with a single active-session question")
  })

  it("removeQuestion also resolves items by requestID (requestID-only question_acknowledged)", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock(), "msg-1")
    removeQuestion("req-q-1")
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "item removed via requestID")
    assert.ok(bar.classList.contains("hidden"))
  })

  it("updateQuestion preserves an existing requestID when the refreshed block lacks one", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock(), "msg-1")
    updateQuestion("q-1", makeBlock({ requestID: undefined }))
    ;(document.querySelector(".question-bar-option") as HTMLButtonElement).click()
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.equal(answer?.requestID, "req-q-1", "requestID survives a block refresh without one")
  })

  it("auto-dismiss clears the answered session without wiping another session's pending question", async () => {
    initQuestionBar(() => {})
    setActiveSession("sess-B")
    addQuestion(makeBlock({ id: "q-b", toolCallId: "q-b", sessionId: "sess-B" }), "msg-b")

    setActiveSession("sess-A")
    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", sessionId: "sess-A" }), "msg-a")
    markQuestionAnswered("q-a", "Pick one: A")

    await new Promise((r) => setTimeout(r, 700))

    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "answered active-session card dismissed")

    setActiveSession("sess-B")
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "other session's pending question survives")
    assert.ok(!bar.classList.contains("hidden"))
  })
})
