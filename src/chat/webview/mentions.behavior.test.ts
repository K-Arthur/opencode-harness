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
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent

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

describe("mention dropdown — source badges", () => {
  function badgeFor(commandName: string): string | null {
    const rows = Array.from(mentionDropdown.querySelectorAll<HTMLElement>(".command-item"))
    const row = rows.find((r) => r.dataset.command === commandName)
    return row?.querySelector(".command-badge")?.textContent ?? null
  }

  it("built-in commands carry a 'Built-in' badge", () => {
    typeAt("/clear")
    assert.equal(badgeFor("clear"), "Built-in")
  })

  it("server / MCP / skill / custom commands each carry their own badge", () => {
    setup.updateServerCommands([
      { name: "deploy", description: "Ship it", source: "command" },
      { name: "review-pr", description: "Review", source: "mcp", agent: "github-mcp" },
      { name: "tdd-helper", description: "TDD", source: "skill" },
      { name: "my-prompt", description: "Custom prompt", isCustom: true },
    ])
    typeAt("/")
    assert.equal(badgeFor("deploy"), "Server")
    assert.equal(badgeFor("review-pr"), "MCP")
    assert.equal(badgeFor("tdd-helper"), "Skill")
    assert.equal(badgeFor("my-prompt"), "Custom")
  })
})

describe("mention dropdown — result cap", () => {
  it("caps the rendered rows and shows a '+N more' hint when matches overflow", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      name: `srv-cmd-${String(i).padStart(2, "0")}`,
      description: "server command",
      source: "command",
    }))
    setup.updateServerCommands(many)
    typeAt("/")
    const rows = mentionDropdown.querySelectorAll(".dropdown-item")
    assert.ok(rows.length <= 50, `expected at most 50 rows, got ${rows.length}`)
    const more = mentionDropdown.querySelector(".dropdown-more")
    assert.ok(more, "a '+N more' hint must render when results are capped")
    assert.match(more!.textContent || "", /more/i)
  })

  it("does NOT render the hint when results fit under the cap", () => {
    setup.updateServerCommands([{ name: "deploy", description: "Ship it", source: "command" }])
    typeAt("/deploy")
    assert.equal(mentionDropdown.querySelector(".dropdown-more"), null)
  })

  it("the '+N more' hint is not keyboard-selectable", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      name: `srv-cmd-${String(i).padStart(2, "0")}`,
      description: "server command",
      source: "command",
    }))
    setup.updateServerCommands(many)
    typeAt("/")
    // handleKeydown navigates `.dropdown-item:not(.dropdown-empty)`; the hint
    // must not be a .dropdown-item or it would steal a selection slot.
    const more = mentionDropdown.querySelector(".dropdown-more")
    assert.ok(more && !more.classList.contains("dropdown-item"))
  })
})

// ── C3: combobox aria-activedescendant ───────────────────────────────────
// The prompt <textarea> is declared role="combobox" aria-autocomplete="list"
// aria-expanded aria-controls. ArrowUp/ArrowDown visually highlight an
// option (.selected class) but focus stays in the textarea. Without
// aria-activedescendant pointing at the highlighted option's id, screen
// readers cannot announce it. Previously the only mention of
// aria-activedescendant in the source was a removal on close — never a set
// on navigation.
describe("mention dropdown — combobox aria-activedescendant (C3)", () => {
  it("each rendered option has a stable id", () => {
    setup.updateServerCommands([
      { name: "c3-deploy", description: "a", source: "command" },
      { name: "c3-review", description: "b", source: "command" },
    ])
    typeAt("/c3-")
    const items = mentionDropdown.querySelectorAll(".dropdown-item")
    assert.equal(items.length, 2, "only the 2 matching server commands render")
    for (const item of items) {
      assert.ok(item.id, "every option must have an id for aria-activedescendant")
    }
  })

  it("ArrowDown sets aria-activedescendant to the highlighted option's id", () => {
    setup.updateServerCommands([
      { name: "c3-deploy", description: "a", source: "command" },
      { name: "c3-review", description: "b", source: "command" },
    ])
    typeAt("/c3-")
    // selectedIndex starts at 0; ArrowDown moves to 1.
    setup.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    const ad = promptInput.getAttribute("aria-activedescendant")
    assert.ok(ad, "aria-activedescendant must be set after ArrowDown")
    const selected = mentionDropdown.querySelector(".selected") as HTMLElement | null
    assert.ok(selected, "an option is highlighted")
    assert.equal(ad, selected!.id, "aria-activedescendant must point at the highlighted option's id")
  })

  it("ArrowUp wraps and still updates aria-activedescendant", () => {
    setup.updateServerCommands([
      { name: "c3-deploy", description: "a", source: "command" },
      { name: "c3-review", description: "b", source: "command" },
    ])
    typeAt("/c3-")
    // selectedIndex starts at 0; ArrowUp wraps to last (index 1).
    setup.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
    const ad = promptInput.getAttribute("aria-activedescendant")
    assert.ok(ad, "aria-activedescendant must be set after ArrowUp")
    const selected = mentionDropdown.querySelector(".selected") as HTMLElement | null
    assert.ok(selected)
    assert.equal(ad, selected!.id)
  })
})
