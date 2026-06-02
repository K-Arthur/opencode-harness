/**
 * DOM tests for setupActivityPanel (activity-panel.ts), using jsdom.
 *
 * Covers: API surface, filter chips, open/close, empty state, live indicator,
 * filtering, row → onJump, keyboard navigation, closed-panel no-op, and dispose.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupActivityPanel, type ActivityPanelDeps, type ActivityPanelEls } from "./activity-panel"
import type { ChatMessage, Block } from "./types"
import type { ActivityFilter } from "./activityModel"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="activity-toggle-btn"></button>
    <div id="activity-panel" class="activity-panel hidden">
      <button id="activity-close-btn"></button>
      <div id="activity-filters"></div>
      <div id="activity-list"></div>
    </div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  return dom
}

function makeEls(): ActivityPanelEls {
  return {
    activityToggleBtn: document.getElementById("activity-toggle-btn"),
    activityPanel: document.getElementById("activity-panel") as HTMLElement,
    activityFilters: document.getElementById("activity-filters") as HTMLElement,
    activityList: document.getElementById("activity-list") as HTMLElement,
    activityClose: document.getElementById("activity-close-btn") as HTMLElement,
  }
}

function msg(role: ChatMessage["role"], blocks: Block[], id: string): ChatMessage {
  return { role, blocks, id, timestamp: 1000 }
}

/** A store that lets tests drive the panel's data dependencies. */
function makeDeps(over: Partial<ActivityPanelDeps> = {}) {
  const state = {
    activeId: "s1" as string | undefined,
    messages: new Map<string, ChatMessage[]>(),
    streaming: new Map<string, boolean>(),
    filter: new Map<string, ActivityFilter>(),
    jumps: [] as string[],
  }
  const deps: ActivityPanelDeps = {
    getMessages: (sid) => state.messages.get(sid),
    isStreaming: (sid) => state.streaming.get(sid) ?? false,
    getActiveSessionId: () => state.activeId,
    getFilter: (sid) => state.filter.get(sid) ?? "all",
    setFilter: (sid, f) => state.filter.set(sid, f),
    onJump: (id) => state.jumps.push(id),
    ...over,
  }
  return { state, deps }
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".activity-item"))
}

describe("setupActivityPanel — initialization", () => {
  beforeEach(() => setupDom())

  it("returns an API with all expected methods", () => {
    const api = setupActivityPanel(makeEls(), makeDeps().deps)!
    assert.ok(api)
    for (const m of ["refresh", "open", "close", "toggle", "isOpen", "dispose"]) {
      assert.equal(typeof (api as any)[m], "function", `missing ${m}`)
    }
  })

  it("warns and returns undefined when required elements are missing", () => {
    document.body.innerHTML = `<div id="activity-panel"></div>` // missing list/filters/close
    const els = {
      activityPanel: document.getElementById("activity-panel") as HTMLElement,
      activityFilters: null as unknown as HTMLElement,
      activityList: null as unknown as HTMLElement,
      activityClose: null as unknown as HTMLElement,
    }
    assert.equal(setupActivityPanel(els, makeDeps().deps), undefined)
  })

  it("renders all seven filter chips", () => {
    setupActivityPanel(makeEls(), makeDeps().deps)
    const chips = Array.from(document.querySelectorAll(".activity-filter-chip"))
    assert.equal(chips.length, 7)
    assert.deepEqual(chips.map((c) => (c as HTMLElement).dataset.filter), ["all", "messages", "plans", "commands", "files", "errors", "approvals"])
  })
})

describe("setupActivityPanel — open / close / render", () => {
  beforeEach(() => setupDom())

  it("open() shows the panel and renders an event row per activity", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [
      msg("user", [{ type: "text", text: "do it" }], "u1"),
      msg("assistant", [{ type: "tool-call", id: "t", name: "bash", class: "exec", state: "result", args: { command: "ls" } } as Block], "a1"),
    ])
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    assert.equal(api.isOpen(), true)
    assert.ok(!document.getElementById("activity-panel")!.classList.contains("hidden"))
    // user message + command = 2 rows
    assert.equal(rows().length, 2)
    assert.equal((document.getElementById("activity-toggle-btn") as HTMLElement).getAttribute("aria-pressed"), "true")
  })

  it("shows the empty state when there is no activity", () => {
    const { deps } = makeDeps()
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    assert.equal(rows().length, 0)
    assert.ok(document.querySelector(".activity-empty"), "expected an empty-state element")
  })

  it("close() hides the panel and clears aria-pressed", () => {
    const api = setupActivityPanel(makeEls(), makeDeps().deps)!
    api.open()
    api.close()
    assert.equal(api.isOpen(), false)
    assert.ok(document.getElementById("activity-panel")!.classList.contains("hidden"))
    assert.equal((document.getElementById("activity-toggle-btn") as HTMLElement).getAttribute("aria-pressed"), "false")
  })

  it("shows a Live indicator while the session is streaming", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg("assistant", [{ type: "text", text: "working" }], "a1")])
    state.streaming.set("s1", true)
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    assert.ok(document.querySelector(".activity-live"), "expected a live indicator")
  })

  it("refresh() is a no-op while the panel is closed", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg("user", [{ type: "text", text: "hi" }], "u1")])
    const api = setupActivityPanel(makeEls(), deps)!
    api.refresh("s1") // panel still closed
    assert.equal(rows().length, 0)
  })
})

describe("setupActivityPanel — filtering", () => {
  beforeEach(() => setupDom())

  function seed() {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [
      msg("user", [{ type: "text", text: "go" }], "u1"),
      msg("assistant", [
        { type: "tool-call", id: "t", name: "bash", class: "exec", state: "result", args: { command: "npm i" } } as Block,
        { type: "error", code: "E", message: "boom", retryable: false } as Block,
      ], "a1"),
    ])
    return { state, deps }
  }

  it("clicking a filter chip narrows the rows and persists the choice", () => {
    const { state, deps } = seed()
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    assert.ok(rows().length >= 3)

    const errorsChip = document.querySelector<HTMLElement>('.activity-filter-chip[data-filter="errors"]')!
    errorsChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))

    assert.equal(state.filter.get("s1"), "errors")
    const visible = rows()
    assert.equal(visible.length, 1)
    assert.equal(visible[0]!.dataset.kind, "error")
    assert.equal(errorsChip.getAttribute("aria-pressed"), "true")
  })
})

describe("setupActivityPanel — interaction", () => {
  beforeEach(() => setupDom())

  it("clicking a row jumps to its anchor message", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg("user", [{ type: "text", text: "hello" }], "u1")])
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    rows()[0]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(state.jumps, ["u1"])
  })

  it("ArrowDown moves focus to the next event row", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [
      msg("user", [{ type: "text", text: "a" }], "u1"),
      msg("user", [{ type: "text", text: "b" }], "u2"),
    ])
    const api = setupActivityPanel(makeEls(), deps)!
    api.open()
    const items = rows()
    assert.equal(items.length, 2)
    items[0]!.focus()
    document.getElementById("activity-list")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    assert.equal(document.activeElement, items[1])
  })
})

describe("setupActivityPanel — dispose", () => {
  beforeEach(() => setupDom())

  it("dispose() detaches the Escape-to-close handler", () => {
    const api = setupActivityPanel(makeEls(), makeDeps().deps)!
    api.open()
    api.dispose()
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    assert.equal(api.isOpen(), true, "Escape must no longer close after dispose")
  })
})
