/**
 * DOM tests for the interactive plan card (renderPlanCard / renderToolCallBlock).
 * Covers progress bar, status badges, and the approve/revise plan_action wiring.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderPlanCard, renderToolCallBlock, type PlanData } from "./toolCallRenderer"
import type { Block } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  return dom
}

function plan(over: Partial<PlanData> = {}): PlanData {
  return {
    name: "Ship it",
    overview: "do the work",
    filePath: "PLAN.md",
    todos: [
      { id: "1", content: "step one", status: "completed" },
      { id: "2", content: "step two", status: "in-progress" },
      { id: "3", content: "step three", status: "pending" },
    ],
    ...over,
  }
}

describe("renderPlanCard", () => {
  beforeEach(() => setupDom())

  it("renders a progress bar reflecting completed/total", () => {
    const card = renderPlanCard(plan(), {})
    const fill = card.querySelector<HTMLElement>(".plan-card-progress-fill")!
    assert.ok(fill)
    // 1 of 3 complete → ~0.333
    assert.equal(fill.style.getPropertyValue("--p"), "0.333")
    const bar = card.querySelector(".plan-card-progress")!
    assert.equal(bar.getAttribute("aria-valuenow"), "1")
    assert.equal(bar.getAttribute("aria-valuemax"), "3")
  })

  it("renders one row per step with a normalized status badge", () => {
    const card = renderPlanCard(plan(), {})
    const rows = card.querySelectorAll(".plan-card-todo")
    assert.equal(rows.length, 3)
    assert.ok(card.querySelector(".plan-card-todo-status--completed"))
    assert.ok(card.querySelector(".plan-card-todo-status--in-progress"))
    assert.ok(card.querySelector(".plan-card-todo-status--pending"))
  })

  it("normalizes alternate status spellings (done/running/_)", () => {
    const card = renderPlanCard(plan({ todos: [
      { id: "1", content: "a", status: "done" },
      { id: "2", content: "b", status: "in_progress" },
      { id: "3", content: "c", status: "running" },
    ] }), {})
    assert.equal(card.querySelectorAll(".plan-card-todo--completed").length, 1)
    assert.equal(card.querySelectorAll(".plan-card-todo--in-progress").length, 2)
  })

  it("posts plan_action approve when Approve is clicked", () => {
    const posted: Record<string, unknown>[] = []
    const card = renderPlanCard(plan(), { postMessage: (m) => posted.push(m) })
    const btn = card.querySelector<HTMLButtonElement>(".plan-card-action-btn--approve")!
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "plan_action", action: "approve", filePath: "PLAN.md" }])
  })

  it("posts plan_action revise when Revise is clicked", () => {
    const posted: Record<string, unknown>[] = []
    const card = renderPlanCard(plan(), { postMessage: (m) => posted.push(m) })
    card.querySelector<HTMLButtonElement>(".plan-card-action-btn--revise")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.equal(posted[0]!.action, "revise")
  })

  it("Open in Editor posts open_file with the plan path", () => {
    const posted: Record<string, unknown>[] = []
    const card = renderPlanCard(plan(), { postMessage: (m) => posted.push(m) })
    card.querySelector<HTMLButtonElement>(".plan-card-open-btn")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "open_file", path: "PLAN.md" }])
  })
})

describe("renderToolCallBlock — plan integration", () => {
  beforeEach(() => setupDom())

  it("renders a plan card (not a tool details element) for a plan write", () => {
    const content = ["---", "name: Detected Plan", "todos:", "  - id: 1", "    content: x", "    status: pending", "---"].join("\n")
    const block = { type: "tool-call", id: "w", name: "write", class: "write", state: "result", args: { path: "PLAN.md", content } } as Block
    const el = renderToolCallBlock(block, {})!
    assert.ok(el.classList.contains("plan-card"), "expected a plan-card element")
    assert.match(el.querySelector(".plan-card-title")!.textContent || "", /Detected Plan/)
  })
})
