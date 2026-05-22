import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// Behavioural tests for the mention/slash dropdown — JSDOM exercises the
// real DOM mutations the user sees (text insertion, dropdown visibility,
// keyboard navigation) rather than asserting on source patterns.

let promptInput: HTMLTextAreaElement
let mentionDropdown: HTMLDivElement
let posted: Array<Record<string, unknown>>
let setup: any
let state: { query: string; selectedIndex: number; mode: "mention" | "command" }

beforeEach(async () => {
  const dom = new JSDOM(`<!doctype html>
    <textarea id="prompt-input"></textarea>
    <div id="mention-dropdown" class="hidden"></div>
  `)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement
  ;(globalThis as any).HTMLDivElement = dom.window.HTMLDivElement
  ;(globalThis as any).CustomEvent = dom.window.CustomEvent

  promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement
  mentionDropdown = document.getElementById("mention-dropdown") as HTMLDivElement
  posted = []

  const { setupMentions } = await import("./mentions")
  state = { query: "", selectedIndex: -1, mode: "command" }
  const els = { promptInput, mentionDropdown } as any
  setup = setupMentions(els, state, (msg) => {
    posted.push(msg)
  })
})

function typeAt(value: string, cursor: number = value.length) {
  promptInput.value = value
  promptInput.setSelectionRange(cursor, cursor)
  setup.handleTrigger()
}

describe("mention dropdown — slash trigger", () => {
  it("opens for a slash at the start of input", () => {
    typeAt("/")
    assert.ok(!mentionDropdown.classList.contains("hidden"))
    assert.equal(state.mode, "command")
  })

  it("opens for a slash mid-line after whitespace", () => {
    // Old regex (^\/...$) failed this case — mid-prompt /commands never
    // surfaced the dropdown.
    typeAt("hello /cl")
    assert.ok(!mentionDropdown.classList.contains("hidden"), "dropdown must open mid-line")
    assert.equal(state.mode, "command")
    assert.equal(state.query, "cl")
  })

  it("does NOT trigger when slash is part of another word (e.g. URL path)", () => {
    typeAt("https://example.com/foo")
    assert.ok(mentionDropdown.classList.contains("hidden"))
  })

  it("filters by typed prefix", () => {
    typeAt("/comp")
    const items = mentionDropdown.querySelectorAll(".dropdown-item")
    assert.ok(items.length >= 1, "compact should be visible")
    const labels = Array.from(items).map((i) => i.textContent || "")
    assert.ok(labels.some((l) => l.includes("/compact")))
  })
})

describe("mention dropdown — @ category insertion", () => {
  it("clicking a category row inserts just the prefix (e.g. '@file:'), not prefix+display", () => {
    // Reproduces the original bug: clicking the "file" category used to
    // insert "@file:file" because of prefix + display concatenation.
    promptInput.value = "@"
    promptInput.setSelectionRange(1, 1)

    setup.renderResults([
      { prefix: "@file:", display: "file", description: "Reference a file", insertText: "@file:" },
    ])
    const row = mentionDropdown.querySelector<HTMLElement>(".dropdown-item")
    assert.ok(row)
    row!.click()
    assert.equal(promptInput.value, "@file:", "must insert just '@file:' — no trailing display or space")
    assert.equal(promptInput.selectionStart, 6, "cursor must land after the ':' so the user can keep typing")
  })

  it("clicking a concrete file row inserts '@file:<path> ' with a trailing space", () => {
    promptInput.value = "@"
    promptInput.setSelectionRange(1, 1)
    setup.renderResults([
      { prefix: "@file:", display: "src/foo.ts", description: "File" },
    ])
    mentionDropdown.querySelector<HTMLElement>(".dropdown-item")!.click()
    assert.equal(promptInput.value, "@file:src/foo.ts ")
  })
})

describe("mention dropdown — server command dedup", () => {
  it("server command that collides with a local one is not shown twice", () => {
    setup.updateServerCommands([
      { name: "clear", description: "server clear" },
      { name: "deploy", description: "deploy" },
    ])
    typeAt("/")
    const labels = Array.from(mentionDropdown.querySelectorAll(".dropdown-label")).map(
      (l) => l.textContent || "",
    )
    const clearCount = labels.filter((l) => l === "/clear").length
    assert.equal(clearCount, 1, "must not show two /clear rows")
    assert.ok(labels.includes("/deploy"), "non-colliding server commands still appear")
  })
})
