import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildGroupSummaryLabel } from "./groupSummary"
import type { Block } from "./types"

function tool(name: string, cls: string, args?: Record<string, unknown>): Block {
  return { type: "tool-call", id: `id-${name}`, name, class: cls, state: "result", args } as unknown as Block
}

describe("buildGroupSummaryLabel", () => {
  it("single file read", () => {
    const label = buildGroupSummaryLabel([tool("read_file", "read", { path: "a.ts" })])
    assert.strictEqual(label, "1 file read")
  })

  it("multiple file reads", () => {
    const label = buildGroupSummaryLabel([
      tool("read_file", "read", { path: "a.ts" }),
      tool("cat", "read", { path: "b.ts" }),
      tool("view", "read", { path: "c.ts" }),
    ])
    assert.strictEqual(label, "3 file reads")
  })

  it("grep/ripgrep counts as search", () => {
    const label = buildGroupSummaryLabel([
      tool("grep", "read", { query: "foo" }),
      tool("ripgrep", "read", { query: "bar" }),
    ])
    assert.strictEqual(label, "2 searches")
  })

  it("file edits (write class)", () => {
    const label = buildGroupSummaryLabel([
      tool("write_file", "write"),
      tool("edit", "write"),
    ])
    assert.strictEqual(label, "2 file edits")
  })

  it("commands (exec class)", () => {
    const label = buildGroupSummaryLabel([
      tool("bash", "exec", { command: "npm test" }),
    ])
    assert.strictEqual(label, "1 command")
  })

  it("web searches", () => {
    const label = buildGroupSummaryLabel([
      tool("websearch", "read", { query: "opencode" }),
      tool("webfetch", "read", { url: "https://example.com" }),
    ])
    assert.strictEqual(label, "2 web lookups")
  })

  it("mixed group summarizes multiple categories with Oxford comma", () => {
    const label = buildGroupSummaryLabel([
      tool("read_file", "read", { path: "a.ts" }),
      tool("read_file", "read", { path: "b.ts" }),
      tool("bash", "exec", { command: "npm test" }),
      tool("write_file", "write"),
    ])
    assert.strictEqual(label, "2 file reads, 1 command, 1 file edit")
  })

  it("empty array returns empty string", () => {
    assert.strictEqual(buildGroupSummaryLabel([]), "")
  })

  it("unknown meta tool shows fallback tool call label", () => {
    // A meta-class tool with no recognised name falls through to generic "tool call"
    const label = buildGroupSummaryLabel([tool("mystery_meta_op", "meta")])
    assert.strictEqual(label, "1 tool call")
  })

  it("unrecognized read-class tool still classified as file read (class wins)", () => {
    const label = buildGroupSummaryLabel([tool("mystery_tool", "read")])
    assert.strictEqual(label, "1 file read")
  })

  it("todo tool shows descriptive label", () => {
    const label = buildGroupSummaryLabel([tool("todowrite", "meta")])
    assert.strictEqual(label, "1 todo update")
  })

  it("single category plural is correct at exactly 1", () => {
    const label = buildGroupSummaryLabel([tool("grep", "read", { query: "x" })])
    assert.strictEqual(label, "1 search")
  })

  it("lsp/inspect tool is grouped as inspection", () => {
    const label = buildGroupSummaryLabel([
      tool("lsp_hover", "read"),
      tool("lsp_diagnostics", "read"),
    ])
    assert.strictEqual(label, "2 inspections")
  })
})
