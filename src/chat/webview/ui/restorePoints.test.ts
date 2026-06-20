/**
 * Behavioral tests for restore-point webview wiring (audit §14.5).
 *
 * The checkpoint panel surfaces both opencode-managed checkpoints and the
 * session's own snapshot-bearing parts as a "restore to here" rail. This
 * module tests the webview rendering and message contracts; the pure
 * collection logic is in src/checkpoint/restorePoints.ts.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderRestorePoints } from "./fileTracking"

function setupDom(): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body><div id="checkpoint-panel" class="hidden"></div><button id="checkpoint-toggle-btn"></button></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  return dom
}

function makeDeps(overrides: Record<string, unknown> = {}): Parameters<typeof renderRestorePoints>[0] {
  return {
    checkpointPanel: document.getElementById("checkpoint-panel"),
    checkpointToggleBtn: document.getElementById("checkpoint-toggle-btn"),
    postMessage: (msg: Record<string, unknown>) => { (overrides.messages as any[]).push(msg) },
    getActiveSessionId: () => "session-1",
    ...overrides,
  } as any
}

describe("renderRestorePoints", () => {
  beforeEach(() => setupDom())

  it("shows an empty state when there are no restore points", () => {
    const deps = makeDeps({ messages: [] })
    renderRestorePoints(deps, "session-1", [])
    const panel = document.getElementById("checkpoint-panel")!
    assert.ok(!panel.classList.contains("hidden"), "panel becomes visible")
    assert.ok(panel.textContent?.includes("No restore points"), "shows empty state")
  })

  it("renders one row per restore point with a label and timestamp", () => {
    const deps = makeDeps({ messages: [] })
    const points = [
      { index: 0, messageID: "m1", partID: "p1", snapshot: "s1", label: "Step checkpoint", kind: "step" as const, time: Date.now() },
      { index: 1, messageID: "m2", partID: "p2", snapshot: "s2", label: "Before this prompt", kind: "user-turn" as const },
    ]
    renderRestorePoints(deps, "session-1", points)
    const panel = document.getElementById("checkpoint-panel")!
    const items = panel.querySelectorAll(".restore-point-item")
    assert.equal(items.length, 2)
    assert.ok(items[0]!.textContent?.includes("Step checkpoint"))
    assert.ok(items[1]!.textContent?.includes("Before this prompt"))
  })

  it("posts restore_point with messageID, partID, and snapshot when a row is clicked", () => {
    const messages: Record<string, unknown>[] = []
    const deps = makeDeps({ messages })
    const point = { index: 0, messageID: "m1", partID: "p1", snapshot: "s1", label: "Step", kind: "step" as const }
    renderRestorePoints(deps, "session-1", [point])
    const btn = document.querySelector(".restore-point-restore-btn") as HTMLButtonElement | null
    assert.ok(btn, "expected restore button")
    btn!.click()
    assert.deepEqual(messages, [
      { type: "restore_point", sessionId: "session-1", messageID: "m1", partID: "p1", snapshot: "s1" },
    ])
  })
})
