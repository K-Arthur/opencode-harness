/**
 * Behavioral tests for "Edited N files" task-banner handling.
 *
 * These inline edit banners were removed from the transcript: they duplicated
 * the persistent bottom changed-files strip + header dropdown, rendered
 * out-of-flow, stacked one card per edit batch, and surfaced disk edits the
 * originating session never made. renderTaskBanner now returns null for them.
 * Non-edit banners (errors/warnings/auto-compact notices) still render.
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

describe("renderTaskBanner — inline 'Edited N files' banners are suppressed", () => {
  beforeEach(() => setupDom())

  it("returns null for a multi-file edit banner (no inline card)", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(
      { type: "task_banner", status: "success", text: "Edited 3 files: a.ts, b.ts, c.ts" },
      { postMessage: () => {} },
    )
    assert.equal(el, null, "multi-file edit banner must not render inline — the changed-files strip is canonical")
  })

  it("returns null for a single-file edit banner", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(
      { type: "task_banner", status: "success", text: "Edited src/StreamCoordinator.ts" },
      { postMessage: () => {} },
    )
    assert.equal(el, null, "single-file edit banner must not render inline")
  })

  it("still renders non-edit success banners (e.g. auto-compact notice)", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(
      { type: "task_banner", status: "success", text: "Session auto-compacted (context was >= 80%)" },
      { postMessage: () => {} },
    )
    assert.ok(el, "non-edit informational banners must still render")
    assert.ok(el!.classList.contains("task-banner"), "uses the task-banner card")
  })

  it("preserves error styling for failed tasks (keeps the alert card for non-edit alerts)", async () => {
    const { renderBlock } = await import("./renderer")
    const el = renderBlock(
      { type: "task_banner", status: "error", text: "Task failed" },
      { postMessage: () => {} },
    )
    assert.ok(el, "error banners must still render")
    assert.ok(el!.classList.contains("task-banner"), "error path still uses task-banner")
    assert.equal(el!.getAttribute("role"), "alert")
  })

  it("does not surface a chip list or open_file affordance for edits anymore", async () => {
    const { renderBlock } = await import("./renderer")
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(
      { type: "task_banner", status: "success", text: "Edited src/x.ts" },
      { postMessage: (m) => posted.push(m) },
    )
    assert.equal(el, null, "no element, hence no chips and no click affordance")
  })
})
