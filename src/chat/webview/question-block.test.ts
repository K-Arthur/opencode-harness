/**
 * Behavioral tests for the question block pointer in the transcript.
 *
 * When opencode emits a `question` tool, the transcript now renders a compact
 * pointer (header + text + hint) directing the user to the interactive
 * question-bar above the input area. The interactive UI (options, free-text,
 * submit) lives in the question bar, not in the transcript.
 *
 * When answered, the block renders a read-only record showing what was chosen.
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

  it("renders question text and pointer hint for pending questions", async () => {
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
    assert.ok(el!.classList.contains("question-block--pending"))
    assert.ok(el!.textContent!.includes("Which database driver should we use?"))
    assert.ok(el!.querySelector(".question-block-header"), "has header")
    assert.ok(el!.querySelector(".question-pointer-hint"), "has pointer hint")
    assert.equal(el!.querySelectorAll(".question-option").length, 0, "no interactive options in transcript")
    assert.equal(el!.querySelector(".question-freetext"), null, "no textarea in transcript")
    assert.equal(el!.querySelector(".question-submit"), null, "no submit button in transcript")
  })

  it("sets data-block-id from toolCallId", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick one",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.equal(el!.getAttribute("data-block-id"), "tool-q-1")
  })

  it("renders without options or free-text (pointer only)", async () => {
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
    assert.equal(el!.querySelectorAll(".question-option").length, 0)
    assert.equal(el!.querySelector(".question-freetext"), null)
    assert.ok(el!.textContent!.includes("Free response"))
  })

  it("escapes HTML in question text to prevent injection", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: `<img src=x onerror="alert(1)">`,
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.equal(el!.querySelectorAll("img").length, 0, "no img injection")
    assert.equal(el!.querySelectorAll("script").length, 0, "no script injection")
    assert.ok(el!.textContent!.includes("<img"), "raw text shown as text")
  })

  it("renders answered state as a read-only record", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick one",
      options: ["A"],
      answered: true,
      answer: "A",
      answerSource: "option",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.ok(el!.classList.contains("question-block--answered"))
    assert.ok(el!.textContent!.includes("Pick one"))
    assert.ok(el!.textContent!.includes("A"))
    assert.equal(el!.querySelector(".question-option"), null, "no interactive buttons when answered")
    assert.equal(el!.querySelector(".question-pointer-hint"), null, "no hint when answered")
  })

  it("answered state shows freetext answer with correct label", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "What's your name?",
      answered: true,
      answer: "Alice",
      answerSource: "freetext",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.ok(el!.textContent!.includes("Your answer:"))
    assert.ok(el!.textContent!.includes("Alice"))
  })

  it("answered state shows selected label for option source", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick one",
      answered: true,
      answer: "Postgres",
      answerSource: "option",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.ok(el!.textContent!.includes("Selected:"))
  })

  it("renders groups text from block.groups when present", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      groups: [{ question: "Single?", options: ["Yes", "No"], multiSelect: false }],
      text: "Single?",
      options: ["Yes", "No"],
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el!.textContent!.includes("Single?"))
    assert.equal(el!.querySelectorAll(".question-option").length, 0, "pointer mode, no interactive options")
  })

  it("uses first group question text for pending pointer", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      groups: [
        { question: "Which DB?", header: "Database", options: ["Postgres", "Mongo"], multiSelect: false },
        { question: "Which features?", header: "Features", options: ["Auth", "Billing"], multiSelect: true },
      ],
      text: "Which DB?",
    }
    const el = renderBlock(block, { postMessage: () => {} }) as HTMLElement
    assert.ok(el.textContent!.includes("Which DB?"))
    assert.equal(el.querySelectorAll(".question-option").length, 0, "pointer mode, no buttons")
    assert.ok(el.querySelector(".question-pointer-hint"), "has pointer hint")
  })

  it("wrapper has aria-label for accessibility", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick one",
      options: ["A", "B"],
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.equal(el!.getAttribute("role"), "form")
    assert.ok(el!.getAttribute("aria-label"), "wrapper must have aria-label")
  })

  it("pointer hint text directs user to input bar", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "question",
      sessionId: "sess-A",
      toolCallId: "tool-q-1",
      text: "Pick one",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    const hint = el!.querySelector(".question-pointer-hint")
    assert.ok(hint)
    assert.ok(hint!.textContent!.includes("input bar"), "hint mentions input bar")
  })
})
