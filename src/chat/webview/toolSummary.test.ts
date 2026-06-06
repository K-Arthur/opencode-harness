import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createToolSummary } from "./toolCallRenderer"
import type { ToolCallBlock } from "./types"

function tool(name: string, cls: ToolCallBlock["class"], args?: unknown): ToolCallBlock {
  return { type: "tool-call", id: "t", name, class: cls, state: "result", args } as ToolCallBlock
}

function summaryEl(toolBlock: ToolCallBlock, details?: HTMLDetailsElement): HTMLDetailsElement {
  const d = details ?? document.createElement("details")
  const s = createToolSummary(toolBlock, d)
  d.appendChild(s)
  return d
}

// Ensure DOM globals exist for tests that create summary elements
const dom = globalThis.document ? null : (
  (() => { const { JSDOM } = require("jsdom"); const d = new JSDOM("").window.document; globalThis.document = d; return d })()
)

describe("createToolSummary — scannable verb labels", () => {
  it("exec with a command → includes 'Ran'", () => {
    const el = summaryEl(tool("bash", "exec", { command: "npm test" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Ran"))
  })
  it("read with a file → includes 'Read'", () => {
    const el = summaryEl(tool("read", "read", { path: "src/x.ts" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Read"))
  })
  it("grep with a query → includes 'Searched'", () => {
    const el = summaryEl(tool("grep", "read", { query: "useEffect" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Searched"))
  })
  it("glob → includes 'Searched'", () => {
    const el = summaryEl(tool("glob", "read", { pattern: "**/*.ts", query: "**/*.ts" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Searched"))
  })
  it("edit with a file → includes 'Edited'", () => {
    const el = summaryEl(tool("edit", "write", { path: "a.ts" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Edited"))
  })
  it("write with a file → includes 'Wrote'", () => {
    const el = summaryEl(tool("write", "write", { path: "a.ts" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Wrote"))
  })
  it("webfetch with a url → includes 'Fetched'", () => {
    const el = summaryEl(tool("webfetch", "read", { url: "https://x" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Fetched"))
  })
  it("todowrite → includes 'Updated todos' (even without an arg)", () => {
    const el = summaryEl(tool("todowrite", "meta"))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Updated todos"))
  })
  it("skill → includes 'Loaded skill'", () => {
    const el = summaryEl(tool("skill", "meta"))
    assert.ok(el.querySelector("summary")?.textContent?.includes("Loaded skill"))
  })
  it("falls back to the raw tool name when a transitive verb has no target arg", () => {
    const el1 = summaryEl(tool("bash", "exec"))
    assert.ok(el1.querySelector("summary")?.textContent?.includes("bash"))
    const el2 = summaryEl(tool("read", "read"))
    assert.ok(el2.querySelector("summary")?.textContent?.includes("read"))
  })
  it("falls back to the raw name for unknown tools", () => {
    const el = summaryEl(tool("frobnicate", "read", { path: "x" }))
    assert.ok(el.querySelector("summary")?.textContent?.includes("frobnicate"))
  })
})
