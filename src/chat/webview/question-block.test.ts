/**
 * Behavioral tests for the interactive question block.
 *
 * When opencode emits a `question` tool, the webview must render an
 * interactive UI (options + free-text), not a passive ToolCallBlock card.
 * Submitting an answer must post `question_answer` back to the host so it
 * can be relayed to opencode as the tool result.
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

describe("renderQuestionBlock", () => {
  beforeEach(() => setupDom())

  it("renders the question text, options, and a free-text input", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Which database driver should we use?",
      options: ["Postgres", "MySQL", "SQLite"],
      allowFreeText: true,
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el, "must return an element")
    assert.ok(el!.classList.contains("question-block"))
    assert.ok(el!.textContent!.includes("Which database driver should we use?"))
    const options = el!.querySelectorAll(".question-option")
    assert.equal(options.length, 3, "renders one button per option")
    const textarea = el!.querySelector(".question-freetext") as HTMLTextAreaElement | null
    assert.ok(textarea, "renders a free-text input")
    const submit = el!.querySelector(".question-submit") as HTMLButtonElement | null
    assert.ok(submit, "renders a submit button")
  })

  it("submitting an option posts question_answer with source=option", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      id: "block-q-1",
      text: "Pick one",
      options: ["A", "B", "C"],
      allowFreeText: true,
    }
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(block, { postMessage: (m) => posted.push(m) }) as HTMLElement

    const buttonB = Array.from(el.querySelectorAll(".question-option"))
      .find((b) => b.textContent?.trim() === "B") as HTMLButtonElement
    assert.ok(buttonB, "must find option B")
    buttonB.click()

    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer, "expected question_answer postMessage")
    assert.equal(answer!.sessionId, "sess-A")
    assert.equal(answer!.toolCallId, "tool-q-1")
    assert.equal(answer!.value, "B")
    assert.equal(answer!.source, "option")
  })

  it("submitting via the textarea posts source=freetext", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "What's your name?",
      options: [],
      allowFreeText: true,
    }
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(block, { postMessage: (m) => posted.push(m) }) as HTMLElement
    const textarea = el.querySelector(".question-freetext") as HTMLTextAreaElement
    textarea.value = "Custom answer"
    const submit = el.querySelector(".question-submit") as HTMLButtonElement
    submit.click()

    const answer = posted.find((m) => m.type === "question_answer")
    assert.ok(answer)
    assert.equal(answer!.value, "Custom answer")
    assert.equal(answer!.source, "freetext")
  })

  it("after answer, the block disables further input (idempotent)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick",
      options: ["X", "Y"],
      allowFreeText: true,
    }
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(block, { postMessage: (m) => posted.push(m) }) as HTMLElement
    const opt = el.querySelector(".question-option") as HTMLButtonElement
    opt.click()
    opt.click() // second click should be a no-op (idempotent)
    const answers = posted.filter((m) => m.type === "question_answer")
    assert.equal(answers.length, 1, "must not post twice for the same question")
    assert.ok(el.classList.contains("question-block--answered"))
  })

  it("renders without options (free-text only mode)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Free response",
      allowFreeText: true,
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.equal(el!.querySelectorAll(".question-option").length, 0, "no option buttons")
    assert.ok(el!.querySelector(".question-freetext"), "still has textarea")
  })

  it("renders without free-text (options-only mode)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Options only",
      options: ["A", "B"],
      allowFreeText: false,
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.equal(el!.querySelectorAll(".question-option").length, 2)
    assert.equal(el!.querySelector(".question-freetext"), null, "no textarea when allowFreeText=false")
    assert.equal(el!.querySelector(".question-submit"), null, "no submit when no free-text")
  })

  it("ignores empty free-text submissions", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Whatever",
      allowFreeText: true,
    }
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(block, { postMessage: (m) => posted.push(m) }) as HTMLElement
    const submit = el.querySelector(".question-submit") as HTMLButtonElement
    submit.click()
    const answer = posted.find((m) => m.type === "question_answer")
    assert.equal(answer, undefined, "empty submission must be a no-op")
  })

  it("escapes HTML in question text and options to prevent injection", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: `<img src=x onerror="alert(1)">`,
      options: [`<script>bad</script>`],
      allowFreeText: false,
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.equal(el!.querySelectorAll("img").length, 0, "no img injection")
    assert.equal(el!.querySelectorAll("script").length, 0, "no script injection")
    assert.ok(el!.textContent!.includes("<img"), "raw text shown as text")
  })
})
