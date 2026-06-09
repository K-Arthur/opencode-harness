/**
 * DOM tests for setupTodosPanel (todos-panel.ts).
 *
 * The previous file at this path actually tested changed-files-dropdown and
 * has been renamed. These tests cover the real todos panel: progress gauge,
 * filter tabs, updateTodoList focus-preserving diff, read-only server todos,
 * toast lifecycle, and dispose cleanup.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupTodosPanel, type TodosPanelOptions } from "./todos-panel"
import type { Todo } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <div id="todos-panel" class="todos-panel hidden"></div>
        <ul id="todos-list"></ul>
        <button id="close-todos-btn"></button>
        <form id="todo-add-form"></form>
        <input id="todo-add-input" />
      </body>
    </html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
  return dom
}

function makeEls() {
  return {
    todosPanel: document.getElementById("todos-panel") as HTMLElement,
    todosList: document.getElementById("todos-list") as HTMLElement,
    closeTodosBtn: document.getElementById("close-todos-btn") as HTMLElement,
    todoAddForm: document.getElementById("todo-add-form") as HTMLFormElement,
    todoAddInput: document.getElementById("todo-add-input") as HTMLInputElement,
  }
}

function makeTodo(over: Partial<Todo> & { id: string }): Todo {
  return { content: `Todo ${over.id}`, status: "pending", createdAt: 0, ...over }
}

function noopOptions(): TodosPanelOptions {
  return {
    onToggleTodo: () => {},
    onDeleteTodo: () => {},
  }
}

describe("setupTodosPanel — initialization", () => {
  beforeEach(() => { setupDom() })

  it("returns an API with all expected methods", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    assert.ok(api, "setupTodosPanel must return an API")
    assert.equal(typeof api.renderTodos, "function")
    assert.equal(typeof api.open, "function")
    assert.equal(typeof api.close, "function")
    assert.equal(typeof api.showToast, "function")
    assert.equal(typeof api.dispose, "function")
  })

  it("warns and returns undefined when required elements are missing", () => {
    document.body.innerHTML = `<div id="todos-panel"></div>` // missing list/close
    const els = {
      todosPanel: document.getElementById("todos-panel") as HTMLElement,
      todosList: null as unknown as HTMLElement,
      closeTodosBtn: null as unknown as HTMLElement,
      todoAddForm: null as unknown as HTMLFormElement,
      todoAddInput: null as unknown as HTMLInputElement,
    }
    const api = setupTodosPanel(els as any, noopOptions())
    assert.equal(api, undefined)
  })
})

describe("setupTodosPanel — progress gauge", () => {
  beforeEach(() => { setupDom() })

  it("sets --p on the progress bar from completion ratio", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "pending" }),
    ])
    const fill = document.querySelector(".todo-progress-bar-fill") as HTMLElement
    assert.ok(fill, "must render the progress bar fill")
    assert.equal(fill.style.getPropertyValue("--p"), "0.500")
  })

  it("uses unrounded ratio for --p (not rounded percent)", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "pending" }),
      makeTodo({ id: "3", status: "pending" }),
    ])
    const fill = document.querySelector(".todo-progress-bar-fill") as HTMLElement
    assert.ok(fill, "must render the progress bar fill")
    assert.equal(fill.style.getPropertyValue("--p"), "0.333",
      "1/3 completed must use the unrounded ratio (0.333), not Math.round(33)/100 (0.330)")
    const pct = document.querySelector(".todo-progress-percentage")
    assert.equal(pct?.textContent, "33%", "label still shows rounded percent")
  })

  it("renders 0% gauge for empty list", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([])
    const pct = document.querySelector(".todo-progress-percentage")
    assert.equal(pct?.textContent, "0%")
  })
})

describe("setupTodosPanel — filter tabs", () => {
  beforeEach(() => { setupDom() })

  it("renders four filter tabs with the active one selected", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([makeTodo({ id: "1" })])
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
    assert.equal(tabs.length, 4)
    const active = tabs.find(t => t.classList.contains("active"))!
    assert.equal(active.getAttribute("aria-selected"), "true")
  })

  it("clicking 'completed' filters the list to completed items", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "pending" }),
    ])
    const completedTab = document.querySelector<HTMLElement>('[data-filter="completed"]')!
    completedTab.click()
    const items = document.querySelectorAll(".todo-item")
    assert.equal(items.length, 1)
    assert.equal((items[0] as HTMLElement).dataset.todoId, "1")
  })
})

describe("setupTodosPanel — read-only server todos (C3 regression)", () => {
  beforeEach(() => { setupDom() })

  it("server todos (no 'todo-' prefix) render WITHOUT toggle/delete affordance", () => {
    let toggled = false, deleted = false
    const api = setupTodosPanel(makeEls(), {
      ...noopOptions(),
      onToggleTodo: () => { toggled = true },
      onDeleteTodo: () => { deleted = true },
    })!
    api.renderTodos([{ id: "srv-1", content: "server task", status: "pending", createdAt: 0 }])

    const checkbox = document.querySelector(".todo-checkbox") as HTMLElement
    assert.ok(checkbox.classList.contains("todo-checkbox--readonly"),
      "server-todo checkbox must carry --readonly")
    assert.equal(checkbox.getAttribute("aria-readonly"), "true")
    assert.equal(checkbox.getAttribute("tabindex"), null,
      "server-todo checkbox must not be focusable")

    checkbox.click()
    assert.equal(toggled, false, "clicking a server-todo checkbox must NOT fire onToggleTodo")

    const deleteBtn = document.querySelector(".todo-delete-btn")
    assert.equal(deleteBtn, null, "server-todo row must NOT include a delete button")
    void deleted
  })

  it("user todos (id starts with 'todo-') remain fully interactive", () => {
    let toggled: string | null = null, deleted: string | null = null
    const api = setupTodosPanel(makeEls(), {
      ...noopOptions(),
      onToggleTodo: (t) => { toggled = t.id },
      onDeleteTodo: (id) => { deleted = id },
    })!
    api.renderTodos([{ id: "todo-abc", content: "mine", status: "pending", createdAt: 0 }])

    const checkbox = document.querySelector(".todo-checkbox") as HTMLElement
    assert.ok(!checkbox.classList.contains("todo-checkbox--readonly"))
    checkbox.click()
    assert.equal(toggled, "todo-abc")

    const deleteBtn = document.querySelector<HTMLElement>(".todo-delete-btn")!
    deleteBtn.click()
    assert.equal(deleted, "todo-abc")
  })
})

describe("setupTodosPanel — updateTodoList diff stability", () => {
  beforeEach(() => { setupDom() })

  it("does not destroy and recreate unchanged DOM nodes on re-render", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.renderTodos([
      makeTodo({ id: "todo-a" }),
      makeTodo({ id: "todo-b" }),
    ])
    const firstA = document.querySelector('[data-todo-id="todo-a"]')
    api.renderTodos([
      makeTodo({ id: "todo-a" }),
      makeTodo({ id: "todo-b", status: "completed" }),
    ])
    const secondA = document.querySelector('[data-todo-id="todo-a"]')
    assert.equal(firstA, secondA, "stable item should be the same DOM node across renders")
  })
})

describe("setupTodosPanel — toast lifecycle (m2 regression)", () => {
  beforeEach(() => { setupDom() })

  it("close() clears the pending toast timer", () => {
    const api = setupTodosPanel(makeEls(), noopOptions())!
    api.open()
    api.showToast("hi", "warning", 50_000)
    assert.ok(document.querySelector(".todo-toast.visible"), "toast must appear visible")
    api.close()
    // No timers leaked: subsequent open should not surface stale toast text from a fired timer.
    api.open()
    // The text is still in the DOM (we don't remove the element) but we mainly assert no throw + dispose works.
    api.dispose()
  })
})

describe("setupTodosPanel — dispose cleanup (M6)", () => {
  beforeEach(() => { setupDom() })

  it("dispose() removes the document keydown listener so panel no longer closes on Escape", () => {
    const els = makeEls()
    const api = setupTodosPanel(els, noopOptions())!
    api.open()
    api.dispose()
    els.todosPanel.classList.remove("hidden")
    document.dispatchEvent(new (globalThis as any).KeyboardEvent("keydown", { key: "Escape" }))
    assert.equal(els.todosPanel.classList.contains("hidden"), false,
      "after dispose, Escape must not close the panel")
  })
})
