import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let modal: HTMLElement
let list: HTMLElement
let search: HTMLInputElement
let title: HTMLElement
let filter: HTMLElement
let closeBtn: HTMLElement
let setupCommandsModal: any
let toCommandEntries: any

beforeEach(async () => {
  const dom = new JSDOM(`<!doctype html>
    <div id="modal" class="hidden">
      <div class="commands-modal-header"><h2 id="title">x</h2><button id="close"></button></div>
      <input id="search" type="text">
      <div id="filter"></div>
      <div id="list"></div>
    </div>
  `)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement
  ;(globalThis as any).Element = dom.window.Element

  modal = document.getElementById("modal")!
  list = document.getElementById("list")!
  search = document.getElementById("search") as HTMLInputElement
  title = document.getElementById("title")!
  filter = document.getElementById("filter")!
  closeBtn = document.getElementById("close")!

  ;({ setupCommandsModal } = await import("./commands-modal"))
  ;({ toCommandEntries } = await import("./slash-commands"))
})

function buildHandle() {
  const opts: any = {
    localCommands: toCommandEntries(),
    onRun: (entry: any) => {
      opts._lastRun = entry
    },
    onInsert: () => {},
    onUseStash: () => {},
    onDeleteStash: () => {},
  }
  const handle = setupCommandsModal(
    {
      commandsModal: modal,
      commandsList: list,
      commandsSearchInput: search,
      commandsTitle: title,
      commandsFilter: filter,
      commandsModalCloseBtn: closeBtn,
    },
    opts,
  )
  return { handle, opts }
}

function press(key: string) {
  const event = new (globalThis as any).window.KeyboardEvent("keydown", { key, bubbles: true })
  modal.dispatchEvent(event)
}

describe("commands modal — keyboard navigation", () => {
  it("ArrowDown highlights the next row, cycling at the bottom", () => {
    const { handle } = buildHandle()
    handle.open()
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")
    assert.ok(rows.length >= 3, "should render multiple rows for navigation test")
    assert.ok(rows[0]!.classList.contains("active"), "first row should be active on open")

    press("ArrowDown")
    assert.ok(rows[1]!.classList.contains("active"))

    // Cycle to the end + wrap around
    for (let i = 0; i < rows.length - 1; i++) press("ArrowDown")
    assert.ok(rows[0]!.classList.contains("active"), "wraps back to the first row")
  })

  it("ArrowUp moves backward and wraps to the last row from the first", () => {
    const { handle } = buildHandle()
    handle.open()
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")

    press("ArrowUp")
    assert.ok(rows[rows.length - 1]!.classList.contains("active"), "from first, ArrowUp goes to last")
  })

  it("Home jumps to first, End jumps to last", () => {
    const { handle } = buildHandle()
    handle.open()
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")

    press("End")
    assert.ok(rows[rows.length - 1]!.classList.contains("active"))

    press("Home")
    assert.ok(rows[0]!.classList.contains("active"))
  })

  it("Enter activates the highlighted row (not just whatever the browser focused)", () => {
    const { handle, opts } = buildHandle()
    handle.open()
    press("ArrowDown")
    press("ArrowDown")
    press("Enter")
    assert.ok(opts._lastRun, "onRun must fire")
    // The third row (after two ArrowDowns from index 0) should have been activated.
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")
    assert.equal(opts._lastRun.name, rows[2]!.dataset.command)
  })

  it("Escape closes the modal", () => {
    const { handle } = buildHandle()
    handle.open()
    assert.ok(!modal.classList.contains("hidden"))
    press("Escape")
    assert.ok(modal.classList.contains("hidden"))
  })
})

describe("commands modal — server command dedup", () => {
  it("a server command named 'clear' does not appear twice next to the built-in", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "clear", description: "server-side clear" },
      { name: "deploy", description: "deploy" },
    ])
    const labels = Array.from(list.querySelectorAll(".commands-modal-item-label")).map(
      (l) => l.textContent || "",
    )
    const clearCount = labels.filter((l) => l === "/clear").length
    assert.equal(clearCount, 1)
    assert.ok(labels.includes("/deploy"))
  })
})

describe("commands modal — MCP source", () => {
  it("MCP-sourced commands get the 'MCP' badge and origin chip", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "review-pr", description: "Review a PR", agent: "github-mcp", source: "mcp" },
      { name: "create-issue", description: "Create issue", agent: "linear-mcp", source: "mcp" },
      { name: "lint", description: "Lint", source: "command" },
    ])

    // Locate the MCP rows
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".commands-modal-item"))
    const reviewRow = rows.find((r) => r.dataset.command === "review-pr")
    const lintRow = rows.find((r) => r.dataset.command === "lint")
    assert.ok(reviewRow, "MCP command must render")
    assert.ok(lintRow, "regular server command must render")

    const reviewBadge = reviewRow!.querySelector(".commands-modal-item-badge")
    assert.equal(reviewBadge?.textContent, "MCP", "MCP-sourced rows show the MCP badge")

    const lintBadge = lintRow!.querySelector(".commands-modal-item-badge")
    assert.equal(lintBadge?.textContent, "Server", "non-MCP rows still show Server")

    const originChip = reviewRow!.querySelector(".commands-modal-item-origin")
    assert.equal(originChip?.textContent, "github-mcp", "MCP origin chip shows the providing server name")
  })

  it("MCP filter chip restricts the list to MCP entries", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "review-pr", description: "PR", agent: "github-mcp", source: "mcp" },
      { name: "deploy", description: "deploy", source: "command" },
    ])
    const mcpChip = list.parentElement!.querySelector<HTMLButtonElement>(
      '.commands-modal-filter-btn[data-filter="mcp"]',
    )
    assert.ok(mcpChip, "MCP filter chip must exist")
    mcpChip!.click()

    const visible = Array.from(list.querySelectorAll<HTMLElement>(".commands-modal-item")).map(
      (r) => r.dataset.command,
    )
    assert.deepEqual(visible, ["review-pr"])
  })

})

describe("commands modal — fuzzy search", () => {
  function type(value: string) {
    search.value = value
    search.dispatchEvent(new (globalThis as any).window.Event("input", { bubbles: true }))
  }
  function visibleCommands(): string[] {
    return Array.from(list.querySelectorAll<HTMLElement>(".commands-modal-item")).map(
      (r) => r.dataset.command || "",
    )
  }

  it("surfaces a custom command by a NON-prefix term (the core complaint)", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([{ name: "code-review", description: "Review the code" }])
    type("review")
    assert.ok(
      visibleCommands().includes("code-review"),
      "typing 'review' must surface /code-review even though it doesn't start with 'review'",
    )
  })

  it("matches a scattered subsequence ('dpl' -> deploy)", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([{ name: "deploy", description: "Ship it" }])
    type("dpl")
    assert.ok(visibleCommands().includes("deploy"))
  })

  it("matches against the description when the name does not", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([{ name: "xyzzy", description: "Deploy to production" }])
    type("production")
    assert.ok(visibleCommands().includes("xyzzy"))
  })

  it("ranks the closest match first", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "code-review", description: "Review the code" },
      { name: "review", description: "Generic review" },
    ])
    type("review")
    // The exact-name command must outrank the one where 'review' is mid-name.
    assert.equal(visibleCommands()[0], "review")
  })

  it("shows the empty-state message when nothing matches", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([{ name: "deploy", description: "Ship it" }])
    type("zzzzzz")
    const empty = list.querySelector(".commands-modal-empty")
    assert.ok(empty, "an empty-state row must render when no command matches")
  })
})

describe("commands modal — legacy source fallback", () => {
  it("falls back to source=server when the server doesn't tag a source", () => {
    // Older opencode servers don't set Command.source. They must still
    // render — just without the MCP-specific affordances.
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "legacy", description: "no source tagged" },
    ])
    const row = list.querySelector<HTMLElement>('.commands-modal-item[data-command="legacy"]')
    assert.ok(row)
    assert.equal(row!.querySelector(".commands-modal-item-badge")?.textContent, "Server")
  })
})

describe("commands modal — expandable detail panel", () => {
  it("shows a chevron toggle on commands with a detail field", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "triage", description: "Triage issues", template: "You are a triage expert. Analyze the issue and...", source: "skill" },
    ])
    const chevron = list.querySelector<HTMLElement>('.commands-modal-item-chevron')
    assert.ok(chevron, "skill command with template must show a chevron")
  })

  it("does NOT show a chevron when there is no detail", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "plain", description: "No template here", source: "command" },
    ])
    const plainRow = list.querySelector<HTMLElement>('.commands-modal-item[data-command="plain"]')
    assert.ok(plainRow)
    const chevron = plainRow!.querySelector('.commands-modal-item-chevron')
    assert.equal(chevron, null, "command without template must not show a chevron")
  })

  it("detail panel is hidden by default and expands on chevron click", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "triage", description: "Triage", template: "Full skill prompt content here", source: "skill" },
    ])
    const triageWrapper = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')
    assert.ok(triageWrapper)
    const detail = triageWrapper!.querySelector<HTMLElement>('.commands-modal-item-detail')
    assert.ok(detail, "detail panel must exist in the DOM")
    assert.ok(detail!.classList.contains("hidden"), "detail must be hidden initially")

    const chevron = triageWrapper!.querySelector<HTMLElement>('.commands-modal-item-chevron')!
    chevron.click()
    const detailAfter = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')!.querySelector<HTMLElement>('.commands-modal-item-detail')
    assert.ok(!detailAfter!.classList.contains("hidden"), "detail must be visible after chevron click")
  })

  it("detail panel shows the full template content", () => {
    const { handle } = buildHandle()
    handle.open()
    const templateContent = "You are a triage expert. Analyze the issue and classify it."
    handle.updateServerCommands([
      { name: "triage", description: "Triage", template: templateContent, source: "skill" },
    ])
    const chevron = list.querySelector<HTMLElement>('.commands-modal-item-chevron')!
    chevron.click()
    // Scope to the triage row's wrapper to avoid matching local command detail panels.
    const triageWrapper = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')
    assert.ok(triageWrapper)
    const detailContent = triageWrapper!.querySelector<HTMLElement>('.commands-modal-item-detail-content')
    assert.ok(detailContent)
    assert.equal(detailContent!.textContent, templateContent)
  })

  it("collapses on second chevron click", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "triage", description: "Triage", template: "content", source: "skill" },
    ])
    const triageWrapper = () => list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')!
    const chevron = () => triageWrapper().querySelector<HTMLElement>('.commands-modal-item-chevron')!
    chevron().click()
    assert.ok(!triageWrapper().querySelector('.commands-modal-item-detail')!.classList.contains("hidden"))
    chevron().click()
    assert.ok(triageWrapper().querySelector('.commands-modal-item-detail')!.classList.contains("hidden"))
  })

  it("Right Arrow expands the selected row's detail", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "triage", description: "Triage", template: "content", source: "skill" },
    ])
    // The first row is selected by default; navigate to the skill row.
    // Local commands come first, so ArrowDown until we reach 'triage'.
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")
    const triageIdx = Array.from(rows).findIndex((r) => r.dataset.command === "triage")
    assert.ok(triageIdx >= 0, "triage row must exist")
    for (let i = 0; i < triageIdx; i++) press("ArrowDown")

    press("ArrowRight")
    const triageWrapper = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')
    assert.ok(
      !triageWrapper!.querySelector('.commands-modal-item-detail')!.classList.contains("hidden"),
      "Right Arrow must expand the selected row's detail",
    )
  })

  it("Left Arrow collapses the selected row's detail", () => {
    const { handle } = buildHandle()
    handle.open()
    handle.updateServerCommands([
      { name: "triage", description: "Triage", template: "content", source: "skill" },
    ])
    const rows = list.querySelectorAll<HTMLElement>(".commands-modal-item")
    const triageIdx = Array.from(rows).findIndex((r) => r.dataset.command === "triage")
    for (let i = 0; i < triageIdx; i++) press("ArrowDown")

    press("ArrowRight")
    const triageWrapper = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')
    assert.ok(!triageWrapper!.querySelector('.commands-modal-item-detail')!.classList.contains("hidden"))
    // After Right Arrow, render() resets selectedIdx to 0. Re-navigate to triage.
    for (let i = 0; i < triageIdx; i++) press("ArrowDown")
    press("ArrowLeft")
    const triageWrapper2 = list.querySelector<HTMLElement>('.commands-modal-item-wrapper[data-command="triage"]')
    assert.ok(triageWrapper2!.querySelector('.commands-modal-item-detail')!.classList.contains("hidden"))
  })

  it("local commands show usage and aliases in the detail panel", () => {
    const { handle } = buildHandle()
    handle.open()
    // /model has a usage hint; /export has an alias.
    const modelChevron = Array.from(list.querySelectorAll<HTMLElement>(".commands-modal-item-chevron"))
      .find((c) => (c.closest(".commands-modal-item") as HTMLElement | null)?.dataset.command === "model")
    assert.ok(modelChevron, "/model must have a chevron (it has usage info)")
    modelChevron!.click()
    const detailContent = Array.from(list.querySelectorAll<HTMLElement>(".commands-modal-item-detail-content"))
      .find((c) => c.textContent?.includes("Usage"))
    assert.ok(detailContent, "detail must contain usage info for /model")
    assert.ok(detailContent!.textContent!.includes("/model <id>"))
  })
})
