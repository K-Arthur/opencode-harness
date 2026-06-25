/**
 * Behavioral DOM tests for inline file-edit preview cards.
 *
 * Write-class tool calls that target a file path render as a compact preview card
 * in the chat stream: file path, change status, mini diff/content preview, and
 * actions to open the file or request the full diff.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import type { ToolCallBlock } from "./types"

function setupDom(): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  globalThis.document = dom.window.document as unknown as Document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  return dom
}

function writeBlock(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    type: "tool-call",
    id: "write-1",
    name: "write",
    class: "write",
    state: "result",
    args: { path: "src/foo.ts", content: "export const foo = 1\n" },
    ...overrides,
  } as ToolCallBlock
}

describe("fileEditCard", () => {
  beforeEach(() => setupDom())

  it("returns null for non-write tools", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard({
      type: "tool-call",
      id: "read-1",
      name: "read",
      class: "read",
      state: "result",
      args: { path: "src/foo.ts" },
    } as ToolCallBlock)
    assert.equal(el, null)
  })

  it("returns null for write tools without a file path", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(writeBlock({ args: { content: "hello" } }))
    assert.equal(el, null)
  })

  it("renders a card with the file path", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(writeBlock())
    assert.ok(el)
    assert.ok(el!.classList.contains("file-edit-card"))
    assert.equal(el!.querySelector(".file-edit-card__path")?.textContent, "src/foo.ts")
  })

  it("renders the tool state as a status badge", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(writeBlock({ state: "running" }))
    assert.equal(el!.querySelector(".file-edit-card__status")?.textContent, "Running")
  })

  it("renders an inline diff when 'Show diff' is clicked", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(
      writeBlock({
        name: "edit",
        args: { path: "src/foo.ts", oldString: "const x = 1", newString: "const x = 2" },
      }),
    )
    const btn = el!.querySelector(".file-edit-card__diff-btn") as HTMLButtonElement | null
    assert.ok(btn, "expected a Show diff button")
    btn!.click()
    assert.equal(btn!.textContent, "Hide diff")
    const diff = el!.querySelector(".file-edit-card__diff")
    assert.ok(diff, "expected inline diff container")
    assert.equal(diff!.children.length > 0, true, "expected inline diff lines")
    assert.ok(diff!.textContent?.includes("const x = 1"))
    assert.ok(diff!.textContent?.includes("const x = 2"))
  })

  it("renders an 'Open file' action that posts to the host", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const messages: Record<string, unknown>[] = []
    const el = renderFileEditCard(writeBlock(), { postMessage: (m) => messages.push(m) })
    const btn = el!.querySelector(".file-edit-card__open-btn") as HTMLButtonElement | null
    assert.ok(btn, "expected an Open file button")
    btn!.click()
    assert.deepEqual(messages, [{ type: "open_file", path: "src/foo.ts" }])
  })

  it("renders a mini diff preview for edit tools with old/new strings", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(
      writeBlock({
        name: "edit",
        args: { path: "src/foo.ts", oldString: "const x = 1", newString: "const x = 2" },
      }),
    )
    const preview = el!.querySelector(".file-edit-card__preview")
    assert.ok(preview)
    assert.ok(preview!.textContent?.includes("const x = 1"))
    assert.ok(preview!.textContent?.includes("const x = 2"))
  })

  it("renders a content preview for write tools with content", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const el = renderFileEditCard(writeBlock())
    const preview = el!.querySelector(".file-edit-card__preview")
    assert.ok(preview)
    assert.ok(preview!.textContent?.includes("export const foo = 1"))
  })

  it("truncates large content previews", async () => {
    const { renderFileEditCard } = await import("./fileEditCard")
    const content = "line\n".repeat(60)
    const el = renderFileEditCard(writeBlock({ args: { path: "src/foo.ts", content } }))
    const preview = el!.querySelector(".file-edit-card__preview")
    const lines = preview!.querySelectorAll(".file-edit-card__preview-line")
    assert.ok(lines.length <= 50, "large previews should be truncated")
  })

  it("is used by the tool-call renderer for write-class blocks", async () => {
    const { renderToolCallBlock } = await import("./toolCallRenderer")
    const el = renderToolCallBlock(writeBlock(), {})
    assert.ok(el)
    assert.ok(el!.classList.contains("file-edit-card"))
    assert.equal(el!.querySelector(".file-edit-card__path")?.textContent, "src/foo.ts")
  })
})
