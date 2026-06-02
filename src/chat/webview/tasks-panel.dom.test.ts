/**
 * DOM tests for setupTasksPanel (tasks-panel.ts), using jsdom.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupTasksPanel, type TasksPanelEls, type TasksPanelDeps } from "./tasks-panel"
import type { ChatMessage, Block } from "./types"
import type { CommandFilter } from "./commandModel"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="tasks-toggle-btn"></button>
    <div id="tasks-panel" class="tasks-panel hidden">
      <button id="tasks-close-btn"></button>
      <div id="tasks-filters"></div>
      <div id="tasks-list"></div>
    </div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  return dom
}

function els(): TasksPanelEls {
  return {
    tasksToggleBtn: document.getElementById("tasks-toggle-btn"),
    tasksPanel: document.getElementById("tasks-panel") as HTMLElement,
    tasksFilters: document.getElementById("tasks-filters") as HTMLElement,
    tasksList: document.getElementById("tasks-list") as HTMLElement,
    tasksClose: document.getElementById("tasks-close-btn") as HTMLElement,
  }
}

function exec(over: Partial<Block> = {}): Block {
  return { type: "tool-call", id: `t${Math.random()}`, name: "bash", class: "exec", state: "result", args: { command: "npm test" }, ...over } as Block
}
function msg(blocks: Block[], id = "a1"): ChatMessage {
  return { role: "assistant", blocks, id, timestamp: 1000 }
}

function makeDeps(over: Partial<TasksPanelDeps> = {}) {
  const state = {
    activeId: "s1" as string | undefined,
    messages: new Map<string, ChatMessage[]>(),
    streaming: false,
    filter: new Map<string, CommandFilter>(),
    copies: [] as string[],
    terminals: [] as Array<{ command: string; cwd?: string; autorun: boolean }>,
    cancels: 0,
    jumps: [] as string[],
  }
  const deps: TasksPanelDeps = {
    getMessages: (sid) => state.messages.get(sid),
    isStreaming: () => state.streaming,
    getActiveSessionId: () => state.activeId,
    getFilter: (sid) => state.filter.get(sid) ?? "all",
    setFilter: (sid, f) => state.filter.set(sid, f),
    onJump: (id) => state.jumps.push(id),
    onCopy: (t) => state.copies.push(t),
    onOpenTerminal: (command, cwd, autorun) => state.terminals.push({ command, cwd, autorun }),
    onCancel: () => { state.cancels++ },
    ...over,
  }
  return { state, deps }
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".task-card"))
}

describe("setupTasksPanel", () => {
  beforeEach(() => setupDom())

  it("returns an API with all methods and 4 filter chips", () => {
    const api = setupTasksPanel(els(), makeDeps().deps)!
    for (const m of ["refresh", "open", "close", "toggle", "isOpen", "dispose"]) assert.equal(typeof (api as any)[m], "function")
    assert.equal(document.querySelectorAll(".tasks-filter-chip").length, 4)
  })

  it("renders a card per exec command on open", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "ls", cwd: "/r" }, durationMs: 1200 }), exec({ args: { command: "npm i" }, exitCode: 1 })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    assert.equal(cards().length, 2)
    assert.match(document.querySelector(".task-card-command")!.textContent || "", /ls/)
    assert.ok(document.querySelector(".task-card--failed"), "non-zero exit renders a failed card")
  })

  it("shows the empty state when there are no commands", () => {
    const api = setupTasksPanel(els(), makeDeps().deps)!
    api.open()
    assert.equal(cards().length, 0)
    assert.ok(document.querySelector(".tasks-empty"))
  })

  it("filters by status when a chip is clicked", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "a" }, state: "running" }), exec({ args: { command: "b" }, exitCode: 1 })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    assert.equal(cards().length, 2)
    document.querySelector<HTMLElement>('.tasks-filter-chip[data-filter="failed"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.equal(state.filter.get("s1"), "failed")
    assert.equal(cards().length, 1)
    assert.ok(document.querySelector(".task-card--failed"))
  })

  it("copy command and copy output route to onCopy", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "echo hi" }, result: "hi\n" })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-action-btn"))
    btns.find((b) => b.textContent === "Copy")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    btns.find((b) => b.textContent === "Copy output")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(state.copies, ["echo hi", "hi\n"])
  })

  it("Terminal stages (autorun false) and Re-run executes (autorun true)", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "make", cwd: "/proj" } })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-action-btn"))
    btns.find((b) => b.textContent === "Terminal")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    btns.find((b) => b.textContent === "Re-run")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(state.terminals, [
      { command: "make", cwd: "/proj", autorun: false },
      { command: "make", cwd: "/proj", autorun: true },
    ])
  })

  it("Cancel only appears for running commands and calls onCancel", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "sleep 9" }, state: "running" })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-action-btn")).find((b) => b.textContent === "Cancel")
    assert.ok(cancel, "running command should offer Cancel")
    cancel!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.equal(state.cancels, 1)
  })

  it("does NOT offer Cancel for a finished command", () => {
    const { state, deps } = makeDeps()
    state.messages.set("s1", [msg([exec({ args: { command: "done" }, exitCode: 0 })])])
    const api = setupTasksPanel(els(), deps)!
    api.open()
    assert.equal(Array.from(document.querySelectorAll(".task-action-btn")).some((b) => b.textContent === "Cancel"), false)
  })

  it("toggle opens and closes the panel", () => {
    const api = setupTasksPanel(els(), makeDeps().deps)!
    api.toggle()
    assert.equal(api.isOpen(), true)
    api.toggle()
    assert.equal(api.isOpen(), false)
  })
})
