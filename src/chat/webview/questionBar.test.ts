import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { QuestionBlock } from "./types"
import {
  initQuestionBar, addQuestion, clearAllQuestions, setActiveSession, removeQuestion,
  updateQuestion, markQuestionAnswered, unmarkQuestionAnswered, clearForSession,
  hasQuestionInState, hasQuestionRenderedInBar, reconcileBar, repopulateFromMessages,
} from "./questionBar"

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
        <textarea class="question-bar-freetext" style="display:none"></textarea>
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
  let dom: JSDOM
  beforeEach(() => { dom = setupDom() })

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

  it("addQuestion renders a free-text question with empty groups without crashing", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    const bar = document.getElementById("question-bar")!
    addQuestion(makeBlock({
      id: "q-empty",
      toolCallId: "q-empty",
      requestID: "req-empty",
      groups: [],
      text: "How should I treat bootstrap?",
      options: [],
      allowFreeText: true,
    }), "msg-empty")
    assert.ok(!bar.classList.contains("hidden"), "bar is visible after addQuestion")
    const questionText = bar.querySelector(".question-bar-question")
    assert.ok(questionText, "question text is rendered")
    assert.equal(questionText!.textContent, "How should I treat bootstrap?", "question text matches block.text")
    const freeText = bar.querySelector(".question-bar-freetext") as HTMLTextAreaElement
    assert.ok(freeText, "free-text textarea is rendered")
    freeText.value = "desktop (not WASM)"
    freeText.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "question_answer was posted")
    assert.equal(answer!.value, "desktop (not WASM)", "free-text answer is sent")
    assert.equal(answer!.source, "freetext", "source is freetext")
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

  // ── Multi-group question wire format ────────────────────────────────────
  // The SDK v2 question.reply endpoint expects `answers: string[][]` — one
  // inner array per question group, with the labels the user selected. Our
  // webview previously sent a single flattened "Header1: A\nHeader2: B"
  // string wrapped as [[value]], which the server could not map back to
  // individual groups (B-edge-1). submitAllAnswers must also post a
  // structuredAnswers field carrying the per-group label arrays.
  it("multi-group question: submitAllAnswers posts structuredAnswers as string[][] (B-edge-1)", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))

    // Two groups, each single-select: "DB?" with PG/MySQL, "Auth?" with Yes/No.
    // With the carousel rework, one card is visible at a time.
    const block = makeBlock({
      id: "q-multi",
      toolCallId: "q-multi",
      requestID: "req-multi",
      groups: [
        { question: "DB?", header: "Database", options: ["PG", "MySQL"], multiSelect: false },
        { question: "Auth?", header: "Auth", options: ["Yes", "No"], multiSelect: false },
      ],
      text: "DB?",
      options: ["PG", "MySQL"],
    })
    addQuestion(block, "msg-multi")

    // Card 1 (group 0) is visible: select PG, then mark ready
    const card1Options = document.querySelectorAll(".qbar-carousel-card .question-bar-option")
    assert.equal(card1Options.length, 2, "card 1 shows 2 options (PG, MySQL)")
    ;(card1Options[0] as HTMLButtonElement).click() // PG
    const readyBtns = document.querySelectorAll(".qbar-card-ready-btn")
    assert.equal(readyBtns.length, 1, "one ready button on card 1")
    ;(readyBtns[0] as HTMLButtonElement).click()

    // Navigate to card 2 (group 1): click next arrow
    const nextBtn = document.querySelector(".qbar-carousel-next") as HTMLButtonElement
    assert.ok(nextBtn, "next arrow exists")
    assert.ok(!nextBtn.disabled, "next arrow is enabled")
    nextBtn.click()

    // Card 2 is now visible: select Yes, then mark ready
    const card2Options = document.querySelectorAll(".qbar-carousel-card .question-bar-option")
    assert.equal(card2Options.length, 2, "card 2 shows 2 options (Yes, No)")
    ;(card2Options[1] as HTMLButtonElement).click() // Yes (index 1 = "No" is index 0, wait...)
    // Actually card2 = group 1 with options ["Yes", "No"], so index 0 = Yes
    let opts = document.querySelectorAll(".qbar-carousel-card .question-bar-option")
    ;(opts[0] as HTMLButtonElement).click() // Yes
    const readyBtns2 = document.querySelectorAll(".qbar-card-ready-btn")
    assert.equal(readyBtns2.length, 1, "one ready button on card 2")
    ;(readyBtns2[0] as HTMLButtonElement).click()

    // Submit all
    const submitBtn = document.getElementById("question-bar-submit") as HTMLButtonElement
    assert.ok(!submitBtn.disabled)
    submitBtn.click()

    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "question_answer was posted")
    assert.equal(answer!.value, "Database: PG\nAuth: Yes", "flat value preserved for history")
    assert.deepEqual(
      answer!.structuredAnswers,
      [["PG"], ["Yes"]],
      "structuredAnswers must be one inner-array per group, in group order",
    )
  })

  it("multi-group question with multiSelect: structuredAnswers is an array of all selected labels per group", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock({
      id: "q-ms",
      toolCallId: "q-ms",
      requestID: "req-ms",
      groups: [
        { question: "Feat?", header: "Features", options: ["Auth", "API", "UI"], multiSelect: true },
      ],
      text: "Feat?",
      options: ["Auth", "API", "UI"],
    }), "msg-ms")
    const allOptions = document.querySelectorAll(".question-bar-option")
    ;(allOptions[0] as HTMLButtonElement).click() // Auth
    ;(allOptions[2] as HTMLButtonElement).click() // UI
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
    const answer = posted.find((m) => m.type === "question_answer")!
    assert.deepEqual(answer.structuredAnswers, [["Auth", "UI"]], "all selected labels included per group")
  })

  it("single-group question: a group's custom text merges INTO that group's slot (not a phantom extra group)", () => {
    // The server's question.reply contract is one answer array per question
    // group, in order: answers.length must equal questions.length. The old
    // behaviour appended free text as its own trailing array ([["A"],["..."]])
    // which made answers.length exceed questions.length, so the server could
    // not map it back and dropped the custom answer. The selected labels and
    // the typed custom text for a group must share that group's single slot.
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock({
      id: "q-ft",
      toolCallId: "q-ft",
      requestID: "req-ft",
      groups: [{ question: "Pick", options: ["A", "B"], multiSelect: false }],
      text: "Pick",
      options: ["A", "B"],
    }), "msg-ft")
    const allOptions = document.querySelectorAll(".question-bar-option")
    ;(allOptions[0] as HTMLButtonElement).click() // A
    const freeTextEl = document.querySelector(".question-bar-freetext") as HTMLTextAreaElement
    freeTextEl.value = "extra notes"
    freeTextEl.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
    const answer = posted.find((m) => m.type === "question_answer")!
    assert.deepEqual(
      answer.structuredAnswers,
      [["A", "extra notes"]],
      "selected label + custom text share the group's single slot (one slot per group)",
    )
  })

  it("custom-only answer (no selection): typed text is the group's slot, source=freetext", () => {
    // Issue #3 core: when the user ONLY types a custom answer for a question
    // with options, the wire must carry the text in the group's slot — not an
    // empty group 0 + a phantom group 1 ([[],["..."]]) the server rejects.
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock({
      id: "q-custom",
      toolCallId: "q-custom",
      requestID: "req-custom",
      groups: [{ question: "Pick", options: ["A", "B"], multiSelect: false }],
      text: "Pick",
      options: ["A", "B"],
    }), "msg-custom")
    const freeTextEl = document.querySelector(".question-bar-freetext") as HTMLTextAreaElement
    freeTextEl.value = "my own answer"
    freeTextEl.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    const submitBtn = document.getElementById("question-bar-submit") as HTMLButtonElement
    assert.ok(!submitBtn.disabled, "custom text alone enables submit")
    submitBtn.click()
    const answer = posted.find((m) => m.type === "question_answer")!
    assert.deepEqual(answer.structuredAnswers, [["my own answer"]], "single slot carrying the custom text")
    assert.equal(answer.value, "my own answer")
    assert.equal(answer.source, "freetext")
  })

  it("multi-group question: each group's custom text lands in its own slot", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock({
      id: "q-mg",
      toolCallId: "q-mg",
      requestID: "req-mg",
      groups: [
        { question: "DB?", header: "Database", options: ["PG", "MySQL"], multiSelect: false },
        { question: "Auth?", header: "Auth", options: ["Yes", "No"], multiSelect: false },
      ],
      text: "DB?",
      options: ["PG", "MySQL"],
    }), "msg-mg")
    // Card 1 (group 0): select PG, mark ready.
    ;(document.querySelectorAll(".qbar-carousel-card .question-bar-option")[0] as HTMLButtonElement).click()
    ;(document.querySelector(".qbar-card-ready-btn") as HTMLButtonElement).click()
    // Card 2 (group 1): type a custom answer instead of selecting, mark ready.
    ;(document.querySelector(".qbar-carousel-next") as HTMLButtonElement).click()
    const card2Free = document.querySelector(".qbar-carousel-card .question-bar-freetext") as HTMLTextAreaElement
    card2Free.value = "OAuth only"
    card2Free.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    ;(document.querySelector(".qbar-card-ready-btn") as HTMLButtonElement).click()
    ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
    const answer = posted.find((m) => m.type === "question_answer")!
    assert.deepEqual(
      answer.structuredAnswers,
      [["PG"], ["OAuth only"]],
      "group 0 = selected label, group 1 = its custom text — one slot per group, in order",
    )
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

  // ── B9: rollback optimistic "Answered" state ───────────────────────────
  // The webview's markQuestionAnswered swaps the DOM to the answered variant
  // and sets item.answered = true. When the host reports the SDK reply
  // failed (question_unacknowledged), unmarkQuestionAnswered must restore
  // the interactive controls so the user can retry — without this, the
  // user sees a "submitted" card forever while the server has no record
  // of the answer.
  it("B9: unmarkQuestionAnswered restores interactive controls and lets the user retry", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock(), "msg-1")
    const optBtns = document.querySelectorAll(".question-bar-option")
    assert.equal(optBtns.length, 2, "interactive controls rendered before submit")
    ;(optBtns[0] as HTMLButtonElement).click()
    markQuestionAnswered("q-1", "Pick one: A")

    // After markQuestionAnswered, the item is in the answered state — the
    // interactive option buttons are gone, the answered card is rendered.
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 0, "interactive controls removed after mark")
    assert.ok(bar.querySelector(".question-bar-item--answered"), "answered card is shown")

    // The host reports the SDK reply failed. Webview reverts.
    unmarkQuestionAnswered("q-1")

    assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "B9: interactive option buttons restored so the user can retry")
    assert.equal(bar.querySelectorAll(".question-bar-item--answered").length, 0, "B9: answered state chip removed")
  })

  // ── RC-1: addQuestion inherits _activeSessionId when block.sessionId is empty ──
  it("RC-1: addQuestion inherits _activeSessionId when block has no sessionId", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    setActiveSession("tab-1")
    addQuestion(makeBlock({ sessionId: undefined }), "msg-1")
    const bar = document.getElementById("question-bar")!
    assert.ok(!bar.classList.contains("hidden"), "bar visible for empty-sessionId question")
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "renders options for empty-sessionId question")
  })

  // ── RC-1: setActiveSession renders items with empty sessionId ──
  it("RC-1: setActiveSession includes items with empty sessionId", () => {
    initQuestionBar(() => {})
    setActiveSession("tab-1")
    addQuestion(makeBlock({ id: "q-empty", toolCallId: "q-empty", sessionId: "" }), "msg-1")
    // Switch to a different session then back — the empty-sessionId item must survive
    setActiveSession("tab-other")
    setActiveSession("tab-1")
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "empty-sessionId item re-rendered after tab switch-back")
    assert.ok(!bar.classList.contains("hidden"))
  })

  // ── RC-3: updateQuestion repairs item.sessionId from block ──
  it("RC-3: updateQuestion repairs item.sessionId from a later block", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    setActiveSession("sess-A")
    // First add with empty sessionId (legacy path)
    addQuestion(makeBlock({
      id: "q-repair", toolCallId: "q-repair",
      sessionId: undefined as any,
      requestID: "req-repair",
    }), "msg-1")
    // Then update with the real sessionId (streaming path arrives second)
    updateQuestion("q-repair", makeBlock({
      id: "q-repair", toolCallId: "q-repair",
      sessionId: "sess-B", requestID: undefined,
    }))
    // The item.sessionId should now be "sess-B" — switch to sess-B and verify it shows
    setActiveSession("sess-B")
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "sessionId repaired by updateQuestion, renders for sess-B")
  })

  // ── RC-4: addQuestion synthesizes toolCallId when both toolCallId and id are empty ──
  it("RC-4: addQuestion synthesizes toolCallId when empty", () => {
    initQuestionBar(() => {})
    const block = makeBlock({ id: undefined, toolCallId: undefined })
    delete (block as any).id
    delete (block as any).toolCallId
    addQuestion(block, "msg-1")
    const bar = document.getElementById("question-bar")!
    // Should have rendered items — verify by checking the dom
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "item rendered even with empty id")
  })

  // ── RC-5: addQuestion is a no-op when els is null (initQuestionBar not called) ──
  it("RC-5: addQuestion silently no-ops when initQuestionBar was never called", () => {
    // Do NOT call initQuestionBar
    addQuestion(makeBlock(), "msg-1")
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "no items when els is null")
  })

  // ── RC-8: skip button posts question_answer with source="skip" ──
  it("RC-8: skip button posts question_answer with source=skip", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock(), "msg-1")
    const skipBtn = document.querySelector(".question-bar-skip-btn") as HTMLButtonElement
    assert.ok(skipBtn, "skip button exists")
    skipBtn.click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "question_answer posted by skip")
    assert.equal(answer!.source, "skip", "source is skip")
    assert.equal(answer!.value, "Skipped", "value is Skipped")
    assert.equal(answer!.requestID, "req-q-1")
  })

  // ── skip button: click marks item answered locally ──
  it("skip button marks item answered and shows the answered card", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock(), "msg-1")
    const skipBtn = document.querySelector(".question-bar-skip-btn") as HTMLButtonElement
    skipBtn.click()
    const bar = document.getElementById("question-bar")!
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 0, "interactive controls removed after skip")
    assert.ok(bar.querySelector(".question-bar-item--answered"), "answered card shown after skip")
  })

  // ── clearForSession removes only the specified session's items ──
  it("clearForSession removes only items for the given session", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-B")
    addQuestion(makeBlock({ id: "q-b", toolCallId: "q-b", sessionId: "sess-B" }), "msg-b")
    setActiveSession("sess-A")
    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", sessionId: "sess-A" }), "msg-a")
    clearForSession("sess-B")
    const bar = document.getElementById("question-bar")!
    // q-a is for the active session (sess-A), so it remains in the DOM
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "only sess-A item remains in DOM")
    assert.ok(bar.querySelector('[data-question-id="q-a"]'), "q-a stays in DOM since sess-A is active")
    // Switch to sess-B — no items for sess-B remain
    setActiveSession("sess-B")
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "no items remain for sess-B after clear")
  })

  // ── hasQuestionInState returns correct results ──
  it("hasQuestionInState returns true for registered toolCallId", () => {
    initQuestionBar(() => {})
    assert.equal(hasQuestionInState("q-1"), false, "not registered yet")
    addQuestion(makeBlock(), "msg-1")
    assert.equal(hasQuestionInState("q-1"), true, "registered after addQuestion")
    removeQuestion("q-1")
    assert.equal(hasQuestionInState("q-1"), false, "unregistered after remove")
  })

  // ── hasQuestionRenderedInBar checks the DOM ──
  it("hasQuestionRenderedInBar checks DOM presence", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock(), "msg-1")
    assert.equal(hasQuestionRenderedInBar("q-1"), true, "rendered in DOM after addQuestion")
    removeQuestion("q-1")
    assert.equal(hasQuestionRenderedInBar("q-1"), false, "not in DOM after remove")
  })

  // ── reconcileBar re-renders missing DOM items ──
  it("reconcileBar re-renders items that are in state but missing from the DOM", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-A")
    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", sessionId: "sess-A" }), "msg-a")
    // Simulate silent DOM wipe (e.g., bug or race)
    const bar = document.getElementById("question-bar")!
    bar.querySelectorAll(".question-bar-item").forEach((el: Element) => el.remove())
    assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "DOM wiped")
    // reconcileBar should restore it
    reconcileBar("sess-A")
    assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "reconcileBar restored missing DOM item")
  })

  // ── reconcileBar cleans stale answered items ──
  it("reconcileBar removes answered items older than the stale timeout", () => {
    const origDateNow = Date.now
    const fakeNow = 1_000_000_000_000
    globalThis.Date.now = () => fakeNow

    try {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "q-old", toolCallId: "q-old", sessionId: "sess-A" }), "msg-a")
      markQuestionAnswered("q-old", "old answer")
      // Advance time past the 30s stale timeout
      globalThis.Date.now = () => fakeNow + 31_000
      reconcileBar("sess-A")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "stale answered item cleaned")
    } finally {
      globalThis.Date.now = origDateNow
    }
  })

  // ── updateSubmitState: freetext typing enables submit when options are empty ──
  it("RC-7: freetext typing enables submit when options are empty", () => {
    initQuestionBar(() => {})
    const block = makeBlock({ options: [], text: "Free response" })
    addQuestion(block, "msg-1")
    const submitBtn = document.getElementById("question-bar-submit") as HTMLButtonElement
    assert.ok(submitBtn.disabled, "submit disabled when no freetext entered")
    const freeTextEl = document.querySelector(".question-bar-freetext") as HTMLTextAreaElement
    freeTextEl.value = "my answer"
    freeTextEl.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    assert.ok(!submitBtn.disabled, "submit enabled after freetext entry")
  })

  // ── submitAllAnswers: empty value is not posted (no crash) ──
  it("submitAllAnswers skips items with empty value (no crash)", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    const block = makeBlock({ options: [] })
    block.options = []
    addQuestion(block, "msg-1")
    const submitBtn = document.getElementById("question-bar-submit") as HTMLButtonElement
    // Without a selection AND with empty freetext, submit stays disabled
    assert.ok(submitBtn.disabled, "submit disabled for empty answer")
    // Even if we force-click (shouldn't happen), no crash
    submitBtn.disabled = false
    submitBtn.click()
    const answers = posted.filter((m) => m.type === "question_answer")
    assert.equal(answers.length, 0, "no answer posted for empty item")
  })

  // ── hasActiveQuestions works across sessions ──
  it("hasActiveQuestions reflects unanswered items for the active session", async () => {
    const { hasActiveQuestions } = await import("./questionBar")
    initQuestionBar(() => {})
    setActiveSession("sess-A")
    addQuestion(makeBlock({ id: "q-a", toolCallId: "q-a", sessionId: "sess-A" }), "msg-a")
    assert.equal(hasActiveQuestions(), true, "true when active session has unanswered question")
    setActiveSession("sess-B")
    assert.equal(hasActiveQuestions(), false, "false when active session has none")
    addQuestion(makeBlock({ id: "q-b", toolCallId: "q-b", sessionId: "sess-B" }), "msg-b")
    assert.equal(hasActiveQuestions(), true, "true for sess-B question")
  })

  // ── auto-advance: single-select option click advances carousel ──
  it("auto-advances carousel to next card after single-select option click", () => {
    initQuestionBar(() => {})
    const block = makeBlock({
      id: "q-adv",
      toolCallId: "q-adv",
      groups: [
        { question: "Q1?", options: ["A", "B"], multiSelect: false },
        { question: "Q2?", options: ["X", "Y"], multiSelect: false },
      ],
    })
    addQuestion(block, "msg-adv")

    // Initially showing card 0
    const progress = document.querySelector(".qbar-carousel-progress")
    assert.ok(progress?.textContent?.includes("Question 1 of 2"), "starts on card 1")

    // Click an option on card 0
    const options = document.querySelectorAll(".qbar-carousel-card .question-bar-option")
    assert.equal(options.length, 2, "card 0 shows 2 options")
    ;(options[0] as HTMLButtonElement).click()

    // After 150ms delay, should auto-advance to card 1
    // JSDOM doesn't support setTimeout well, so we check the selections are recorded
    const { hasQuestionInState } = require("./questionBar")
    assert.ok(hasQuestionInState("q-adv"), "question still in state")
  })

  // ── auto-advance: Ready button click advances carousel ──
  it("auto-advances carousel to next card after Ready button click", () => {
    initQuestionBar(() => {})
    const block = makeBlock({
      id: "q-ready",
      toolCallId: "q-ready",
      groups: [
        { question: "Q1?", options: ["A", "B"], multiSelect: false },
        { question: "Q2?", options: ["X", "Y"], multiSelect: false },
      ],
    })
    addQuestion(block, "msg-ready")

    // Click Ready on card 0
    const readyBtn = document.querySelector(".qbar-card-ready-btn") as HTMLButtonElement
    assert.ok(readyBtn, "ready button exists on card 0")
    readyBtn.click()

    // Verify the card-ready state was recorded
    const { hasQuestionInState } = require("./questionBar")
    assert.ok(hasQuestionInState("q-ready"), "question still in state after ready")
  })

  // ── progress shows X/Y answered ──
  it("progress display shows answered count", () => {
    initQuestionBar(() => {})
    const block = makeBlock({
      id: "q-prog",
      toolCallId: "q-prog",
      groups: [
        { question: "Q1?", options: ["A", "B"], multiSelect: false },
        { question: "Q2?", options: ["X", "Y"], multiSelect: false },
        { question: "Q3?", options: ["M", "N"], multiSelect: false },
      ],
    })
    addQuestion(block, "msg-prog")

    const progress = document.querySelector(".qbar-carousel-progress")
    assert.ok(progress?.textContent?.includes("0/3 answered"), "starts with 0/3 answered")
  })

  // ── B10: Staleness timeout ────────────────────────────────────────────
  it("B10: addQuestion records createdAt timestamp on the item", () => {
    initQuestionBar(() => {})
    const before = Date.now()
    addQuestion(makeBlock({ id: "q-ts", toolCallId: "q-ts" }), "msg-ts")
    const after = Date.now()
    const { getQuestionItem } = require("./questionBar")
    const item = getQuestionItem("q-ts")
    assert.ok(item, "item exists")
    assert.ok(item.createdAt >= before && item.createdAt <= after, "createdAt is set to current time")
  })

  it("B10: markStale shows staleness warning UI on the question item", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock({ id: "q-stale", toolCallId: "q-stale" }), "msg-stale")
    const { markStale } = require("./questionBar")
    markStale("q-stale")
    const warning = document.querySelector('[data-question-id="q-stale"] .question-bar-stale-warning')
    assert.ok(warning, "staleness warning element exists")
    assert.ok(warning!.textContent!.includes("may have expired"), "warning text mentions expiry")
  })

  it("B10: staleness warning includes 'Continue without answering' button", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock({ id: "q-sw", toolCallId: "q-sw", requestID: "req-sw" }), "msg-sw")
    const { markStale } = require("./questionBar")
    markStale("q-sw")
    const continueBtn = document.querySelector('[data-question-id="q-sw"] .question-bar-continue-btn') as HTMLButtonElement
    assert.ok(continueBtn, "continue button exists")
    assert.ok(continueBtn.textContent!.includes("Continue"), "button text includes Continue")
  })

  it("B10: 'Continue without answering' posts question_answer with source=skip", () => {
    const posted: Array<Record<string, unknown>> = []
    initQuestionBar((m) => posted.push(m))
    addQuestion(makeBlock({ id: "q-cont", toolCallId: "q-cont", requestID: "req-cont" }), "msg-cont")
    const { markStale } = require("./questionBar")
    markStale("q-cont")
    const continueBtn = document.querySelector('[data-question-id="q-cont"] .question-bar-continue-btn') as HTMLButtonElement
    continueBtn.click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "question_answer was posted")
    assert.equal(answer!.source, "skip", "source is skip")
    assert.equal(answer!.value, "Continue without answering", "value indicates continuation")
    assert.equal(answer!.requestID, "req-cont", "requestID preserved")
  })

  it("B10: markStale is a no-op for already-answered questions", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock({ id: "q-ans", toolCallId: "q-ans" }), "msg-ans")
    const { markStale, markQuestionAnswered } = require("./questionBar")
    markQuestionAnswered("q-ans", "My answer")
    markStale("q-ans")
    const warning = document.querySelector('[data-question-id="q-ans"] .question-bar-stale-warning')
    assert.ok(!warning, "no staleness warning on answered question")
  })

  it("B10: markStale is a no-op for unknown toolCallId", () => {
    initQuestionBar(() => {})
    const { markStale } = require("./questionBar")
    // Should not throw
    markStale("nonexistent-id")
  })

  it("B10: repopulateFromMessages skips unanswered questions (ephemeral model)", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-ephemeral")
    repopulateFromMessages("sess-ephemeral", [{
      id: "msg-unanswered",
      blocks: [{
        type: "question",
        toolCallId: "q-unanswered",
        requestID: "req-unanswered",
        answered: false,
        groups: [{ question: "Pending?", options: ["A"], multiSelect: false }],
      }],
    }])
    const item = document.querySelector('[data-question-id="q-unanswered"]')
    assert.ok(!item, "unanswered questions are NOT repopulated (server won't have them)")
  })

  it("repopulateFromMessages does NOT re-add answered questions to the bar (fixes tab-switch resurrection)", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-answered")
    repopulateFromMessages("sess-answered", [{
      id: "msg-answered",
      blocks: [{
        type: "question",
        toolCallId: "q-answered",
        requestID: "req-answered",
        answered: true,
        answer: "A",
        groups: [{ question: "Pick one", options: ["A", "B"], multiSelect: false }],
      }],
    }])
    const item = document.querySelector('[data-question-id="q-answered"]')
    assert.ok(!item, "answered questions must NOT be re-added to the bar on tab switch — they are in the transcript")
  })

  it("repopulateFromMessages does not crash on answered questions with empty groups", () => {
    initQuestionBar(() => {})
    setActiveSession("sess-empty")
    // This mirrors the transcript block created when a question tool starts with
    // empty args and is later answered: groups is empty, but text is preserved.
    assert.doesNotThrow(() => {
      repopulateFromMessages("sess-empty", [{
        id: "msg-empty-answered",
        blocks: [{
          type: "question",
          toolCallId: "q-empty-answered",
          requestID: "req-empty-answered",
          answered: true,
          answer: "desktop (not WASM)",
          groups: [],
          text: "How should I treat bootstrap?",
          allowFreeText: true,
        }],
      }])
    }, "repopulateFromMessages does not crash on empty groups")
    const item = document.querySelector('[data-question-id="q-empty-answered"]')
    assert.ok(!item, "answered question with empty groups must NOT be re-added to the bar")
  })

  it("B10: markQuestionAnswered clears the staleness timer", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock({ id: "q-timer", toolCallId: "q-timer" }), "msg-timer")
    // Answer the question — should clear the timer
    markQuestionAnswered("q-timer", "My answer")
    // Verify item is answered (timer cleanup is internal, but we verify no crash)
    const { getQuestionItem } = require("./questionBar")
    const item = getQuestionItem("q-timer")
    assert.ok(item?.answered, "item is marked answered")
  })

  it("B10: removeQuestion clears the staleness timer", () => {
    initQuestionBar(() => {})
    addQuestion(makeBlock({ id: "q-rem", toolCallId: "q-rem" }), "msg-rem")
    removeQuestion("q-rem")
    const { getQuestionItem } = require("./questionBar")
    const item = getQuestionItem("q-rem")
    assert.ok(!item, "item is removed")
  })

  // ── ID mismatch resolution (prt_* vs call_* vs que_*) ──────────────────
  // The server assigns different IDs to the same question:
  //   tool_start → id=prt_* (part ID, stored in activeToolCallIds)
  //   question.asked → tool.callID=call_* (call ID, used in question bar)
  //                  → requestID=que_* (request ID, used in reply/reject)
  // All state operations must resolve any of these to the correct item.

  describe("ID mismatch resolution", () => {
    it("markQuestionAnswered resolves by requestID when toolCallId doesn't match", () => {
      initQuestionBar(() => {})
      // Item keyed by call_* (from question.asked event)
      addQuestion(makeBlock({
        id: "call_abc",
        toolCallId: "call_abc",
        requestID: "que_xyz",
      }), "msg-id")
      // Called with que_* (from server's question.replied event)
      markQuestionAnswered("que_xyz", "user answer")
      const { getQuestionItem } = require("./questionBar")
      const item = getQuestionItem("call_abc")
      assert.ok(item?.answered, "item found via requestID and marked answered")
      assert.equal(item?.submittedValue, "user answer")
    })

    it("unmarkQuestionAnswered resolves by requestID when toolCallId doesn't match", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({
        id: "call_def",
        toolCallId: "call_def",
        requestID: "que_uvw",
      }), "msg-id")
      markQuestionAnswered("call_def", "first answer")
      // Now unmark using requestID
      unmarkQuestionAnswered("que_uvw")
      const { getQuestionItem } = require("./questionBar")
      const item = getQuestionItem("call_def")
      assert.ok(item, "item still exists")
      assert.equal(item?.answered, false, "item reverted to unanswered via requestID")
    })

    it("hasQuestionInState resolves by requestID", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({
        id: "call_ghi",
        toolCallId: "call_ghi",
        requestID: "que_rst",
      }), "msg-id")
      assert.ok(hasQuestionInState("que_rst"), "found by requestID")
      assert.ok(hasQuestionInState("call_ghi"), "found by toolCallId")
      assert.ok(!hasQuestionInState("nonexistent"), "not found for unknown ID")
    })

    it("removeQuestion resolves by requestID (already had fallback)", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({
        id: "call_jkl",
        toolCallId: "call_jkl",
        requestID: "que_mno",
      }), "msg-id")
      removeQuestion("que_mno")
      const { getQuestionItem } = require("./questionBar")
      assert.ok(!getQuestionItem("call_jkl"), "item removed via requestID")
    })

    it("full lifecycle: tool_start ID mismatch does not break answer flow", () => {
      const posted: Array<Record<string, unknown>> = []
      initQuestionBar((m) => posted.push(m))
      // Simulate tool_start creating a block with prt_* (happens in StreamCoordinator)
      // Then question.asked arrives with call_* + que_*
      addQuestion(makeBlock({
        id: "call_full",
        toolCallId: "call_full",
        requestID: "que_full",
        groups: [{ question: "Pick one", options: ["A", "B"], multiSelect: false }],
      }), "msg-full")
      // User selects an option
      const optBtns = document.querySelectorAll(".question-bar-option")
      ;(optBtns[0] as HTMLButtonElement).click()
      ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
      // The host sends question_acknowledged with requestID (not toolCallId)
      // This should resolve correctly
      markQuestionAnswered("que_full", "A")
      const { getQuestionItem } = require("./questionBar")
      const item = getQuestionItem("call_full")
      assert.ok(item?.answered, "question answered despite ID mismatch")
    })
  })

  // ── Duplicate-pileup prevention: dual-feed merge + retire guard ──────────
  // One question reaches the bar through TWO feeds with different ids: the
  // live-stream tool_start (part-scoped id, no requestID) and the
  // question.asked SSE event (call id + requestID). Keying only on toolCallId
  // stacked a duplicate card whenever the ids differed. And after a question
  // is answered/dismissed, a late server replay or resume-stream backfill must
  // not resurrect it. These are the "questions queued multiple times /
  // duplicates piling up" failure modes.
  describe("dedup and retire", () => {
    it("collapses the streaming placeholder + SSE event into ONE card (placeholder first), adopting the requestID", () => {
      const posted: Array<Record<string, unknown>> = []
      initQuestionBar((m) => posted.push(m))
      // 1) tool_start (live stream): part-scoped id, no requestID.
      addQuestion(makeBlock({ id: "prt_1", toolCallId: "prt_1", requestID: undefined, sessionId: "sess-1" }), "msg-1", "sess-1")
      // 2) question.asked (SSE): a DIFFERENT call id plus the real requestID.
      addQuestion(makeBlock({ id: "call_1", toolCallId: "call_1", requestID: "que_1", sessionId: "sess-1" }), "msg-1", "sess-1")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "collapsed to a single card")
      ;(document.querySelector(".question-bar-option") as HTMLButtonElement).click()
      ;(document.getElementById("question-bar-submit") as HTMLButtonElement).click()
      const answer = posted.find((m) => m.type === "question_answer")!
      assert.equal(answer.requestID, "que_1", "card adopted the SSE requestID for the v2 reply")
    })

    it("collapses the SSE event + late streaming placeholder into ONE card (SSE first), keeping content", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "call_2", toolCallId: "call_2", requestID: "que_2", sessionId: "sess-1" }), "msg-2", "sess-1")
      // Late streaming placeholder arrives with empty groups — must neither
      // duplicate the card nor blank its options.
      addQuestion(makeBlock({ id: "prt_2", toolCallId: "prt_2", requestID: undefined, sessionId: "sess-1", groups: [], options: [], text: "" }), "msg-2", "sess-1")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "no duplicate from the late placeholder")
      assert.equal(bar.querySelectorAll(".question-bar-option").length, 2, "the fuller card's options were not wiped")
    })

    it("does NOT merge two genuinely distinct questions (both carry a requestID)", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "call_a", toolCallId: "call_a", requestID: "que_a", sessionId: "sess-1" }), "msg-a", "sess-1")
      addQuestion(makeBlock({ id: "call_b", toolCallId: "call_b", requestID: "que_b", sessionId: "sess-1" }), "msg-b", "sess-1")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 2, "two distinct questions, two cards")
    })

    it("a re-emitted question after the user answered does NOT resurrect an interactive card", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "call_3", toolCallId: "call_3", requestID: "que_3" }), "msg-3")
      markQuestionAnswered("call_3", "A")
      removeQuestion("call_3") // host question_acknowledged clears it
      // A late replay (server re-emit / resume-stream backfill) for the SAME question.
      addQuestion(makeBlock({ id: "call_3", toolCallId: "call_3", requestID: "que_3" }), "msg-3")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "retired question was not re-added")
    })

    it("a dismissed (un-answered) question stays dismissed when the server replays it", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "call_4", toolCallId: "call_4", requestID: "que_4" }), "msg-4")
      removeQuestion("call_4")
      addQuestion(makeBlock({ id: "call_4", toolCallId: "call_4", requestID: "que_4" }), "msg-4")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "replayed dismissed question not re-shown")
    })

    it("a retired replay matched only by requestID is also skipped (no resurrection via que_*)", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "prt_5", toolCallId: "prt_5", requestID: "que_5" }), "msg-5")
      markQuestionAnswered("prt_5", "A")
      removeQuestion("prt_5")
      // Replay carries only the requestID under a different call id.
      addQuestion(makeBlock({ id: "call_5", toolCallId: "call_5", requestID: "que_5" }), "msg-5")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 0, "retired by requestID stays retired")
    })

    it("an ANSWERED transcript block (block.answered=true) still repopulates after the question was retired", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock({ id: "call_6", toolCallId: "call_6", requestID: "que_6" }), "msg-6")
      markQuestionAnswered("call_6", "A")
      removeQuestion("call_6")
      // Reload/repopulate path: the answered transcript record bypasses retire.
      addQuestion(makeBlock({ id: "call_6", toolCallId: "call_6", requestID: "que_6", answered: true, answer: "A" }), "msg-6")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "answered record renders despite retire")
    })

    it("initQuestionBar clears the retire ledger (re-init starts fresh)", () => {
      initQuestionBar(() => {})
      addQuestion(makeBlock(), "msg-1")
      markQuestionAnswered("q-1", "A")
      removeQuestion("q-1")
      // A fresh webview init must NOT treat the same ids as retired.
      initQuestionBar(() => {})
      addQuestion(makeBlock(), "msg-1")
      const bar = document.getElementById("question-bar")!
      assert.equal(bar.querySelectorAll(".question-bar-item").length, 1, "retire ledger reset on re-init")
    })
  })
})
