/**
 * DOM tests for write/edit tool INPUT rendering (createToolArgsPanel).
 *
 * Same flaw class as the bash tool: edit/write inputs were dumped as
 * JSON-escaped strings (\n noise, quoted content). Edits should preview as a
 * removed/added diff; writes should show their content as a code block. Small
 * read-class args keep the JSON viewer.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createToolArgsPanel } from "./toolCallRenderer"
import type { ToolCallBlock } from "./types"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
}

const tool = (over: Partial<ToolCallBlock>): ToolCallBlock =>
  ({ type: "tool-call", id: "t1", name: "edit", class: "write", state: "running", ...over } as ToolCallBlock)

describe("createToolArgsPanel — edit tools", () => {
  beforeEach(setupDom)

  it("previews an edit as removed/added lines, not raw JSON", () => {
    const panel = createToolArgsPanel(
      tool({ args: { filePath: "src/a.ts", oldString: "const x = 1", newString: "const x = 2" } }),
    )!
    assert.ok(panel.querySelector(".diff-line--removed"), "has a removed line")
    assert.ok(panel.querySelector(".diff-line--added"), "has an added line")
    assert.ok(panel.textContent!.includes("const x = 1"))
    assert.ok(panel.textContent!.includes("const x = 2"))
    assert.equal(panel.querySelector(".json-viewer"), null, "no JSON tree for an edit")
  })

  it("supports snake_case old_string/new_string", () => {
    const panel = createToolArgsPanel(
      tool({ name: "apply_patch", args: { path: "a.ts", old_string: "foo", new_string: "bar" } }),
    )!
    assert.ok(panel.querySelector(".diff-line--removed"))
    assert.ok(panel.querySelector(".diff-line--added"))
  })
})

describe("createToolArgsPanel — write tools", () => {
  beforeEach(setupDom)

  it("renders write content as a code block, not a JSON-escaped string", () => {
    const panel = createToolArgsPanel(
      tool({ name: "write", args: { filePath: "src/new.ts", content: "line1\nline2\nline3" } }),
    )!
    const pre = panel.querySelector("pre")
    assert.ok(pre, "content rendered in a <pre>")
    assert.ok(pre!.textContent!.includes("line1"))
    assert.ok(!panel.textContent!.includes('\\n'), "no escaped newlines leaked")
    assert.equal(panel.querySelector(".json-viewer"), null)
  })
})

describe("createToolArgsPanel — read tools keep JSON viewer (regression)", () => {
  beforeEach(setupDom)

  it("small read args still use the JSON viewer", () => {
    const panel = createToolArgsPanel(
      ({ type: "tool-call", id: "r", name: "read", class: "read", state: "result", args: { path: "x.ts", offset: 1, limit: 50 } } as ToolCallBlock),
    )!
    assert.ok(panel.querySelector(".json-viewer"))
    assert.equal(panel.querySelector(".diff-line--removed"), null)
  })
})
