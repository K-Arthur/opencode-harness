/**
 * Behavioral tests for the compact "Edited N files" task banner.
 *
 * Replaces the tall multi-row card (which stacked vertically and consumed
 * a whole viewport when the model made repeated edit batches) with a single
 * compact row that shares the file-chip helper with the bottom strip.
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

describe("renderTaskBanner — compact single-row layout", () => {
  beforeEach(() => setupDom())

  it("renders a single .task-banner element (no nested card)", async () => {
    const { renderBlock } = await import("./renderer-test-shim.js" as any)
      .catch(async () => await import("./renderer"))
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited 3 files: a.ts, b.ts, c.ts",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el, "renderTaskBanner must return an element")
    assert.ok(el!.classList.contains("task-banner"), "must have task-banner class")
    assert.ok(el!.classList.contains("task-banner--compact"), "must opt into compact variant")
  })

  it("renders chips using the shared cf-strip-chip class for consistency with the bottom strip", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited 3 files: src/a.ts, src/b.ts, src/c.ts",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    const chips = el!.querySelectorAll(".cf-strip-chip")
    assert.equal(chips.length, 3, "must render 3 chips for 3 files")
    // Inline banner shares chip style with the strip
    assert.ok(chips[0]?.getAttribute("data-path")?.includes("a.ts"))
  })

  it("collapses to a single closed row by default (expanded chip area is hidden)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited 13 files: " + Array.from({ length: 13 }, (_, i) => `f${i}.ts`).join(", "),
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    // The compact row shows up to maxVisible chips + an overflow pill
    const overflow = el!.querySelector(".cf-strip-overflow")
    assert.ok(overflow, "must render +N more pill when files exceed maxVisible")
    assert.ok(overflow!.textContent!.includes("+"), "overflow pill text")
  })

  it("click toggles task-banner--expanded class to reveal all chips", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited 13 files: " + Array.from({ length: 13 }, (_, i) => `f${i}.ts`).join(", "),
    }
    const el = renderBlock(block, { postMessage: () => {} }) as HTMLElement
    assert.ok(!el.classList.contains("task-banner--expanded"), "starts collapsed")
    el.click()
    assert.ok(el.classList.contains("task-banner--expanded"), "click expands")
    el.click()
    assert.ok(!el.classList.contains("task-banner--expanded"), "second click collapses")
  })

  it("handles single-file edits (no comma-separated list)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited src/StreamCoordinator.ts",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    const chips = el!.querySelectorAll(".cf-strip-chip")
    assert.equal(chips.length, 1, "single-file edit produces one chip")
    assert.ok(chips[0]?.getAttribute("data-path") === "src/StreamCoordinator.ts")
  })

  it("preserves error styling for failed tasks (keeps existing card for non-edit alerts)", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "error",
      text: "Task failed",
    }
    const el = renderBlock(block, { postMessage: () => {} })
    assert.ok(el)
    assert.ok(el!.classList.contains("task-banner"), "error path still uses task-banner")
    // The compact variant is only for edits; errors keep their alert styling.
    assert.equal(el!.getAttribute("role"), "alert")
  })

  it("emits open_file postMessage when a chip is clicked", async () => {
    const { renderBlock } = await import("./renderer")
    const block = {
      type: "task_banner",
      status: "success",
      text: "Edited src/x.ts",
    }
    const posted: Array<Record<string, unknown>> = []
    const el = renderBlock(block, { postMessage: (m) => posted.push(m) }) as HTMLElement
    const chip = el.querySelector(".cf-strip-chip") as HTMLElement | null
    assert.ok(chip)
    chip!.click()
    const openMsg = posted.find((m) => m.type === "open_file")
    assert.ok(openMsg, "expected open_file postMessage")
    assert.equal(openMsg!.path, "src/x.ts")
  })
})
