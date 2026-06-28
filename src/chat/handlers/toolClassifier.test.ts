import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { classifyTool, resolveSubagentDisplayName, resolveSubagentActivityName } from "./toolClassifier"

describe("classifyTool — canonical opencode tool names (Batch 3d)", () => {
  // ── Read class: safe inspection ──────────────────────────────────────────
  it("read → 'read'", () => assert.equal(classifyTool("read"), "read"))
  it("grep → 'read'", () => assert.equal(classifyTool("grep"), "read"))
  it("glob → 'read'", () => assert.equal(classifyTool("glob"), "read"))
  it("lsp → 'read'", () => assert.equal(classifyTool("lsp"), "read"))
  it("webfetch → 'read'", () => assert.equal(classifyTool("webfetch"), "read"))
  it("websearch → 'read'", () => assert.equal(classifyTool("websearch"), "read"))

  // ── Write class: mutates the workspace ───────────────────────────────────
  it("write → 'write'", () => assert.equal(classifyTool("write"), "write"))
  it("edit → 'write'", () => assert.equal(classifyTool("edit"), "write"))
  it("apply_patch → 'write'", () => assert.equal(classifyTool("apply_patch"), "write"))

  // ── Exec class: shell commands ───────────────────────────────────────────
  it("bash → 'exec'", () => assert.equal(classifyTool("bash"), "exec"))
  it("shell-related → 'exec'", () => assert.equal(classifyTool("run_shell"), "exec"))

  // ── Meta class: workflow/orchestration ───────────────────────────────────
  it("todowrite → 'meta' (NOT 'write')", () => {
    // The original classifier matched 'write' first and put todowrite in the
    // write bucket — visually marking it as a destructive tool when it's
    // really just task-tracking.
    assert.equal(classifyTool("todowrite"), "meta")
  })

  it("skill → 'meta'", () => assert.equal(classifyTool("skill"), "meta"))
  it("question → 'meta'", () => assert.equal(classifyTool("question"), "meta"))
  it("task → 'meta'", () => assert.equal(classifyTool("task"), "meta"))

  // ── Edge cases ───────────────────────────────────────────────────────────
  it("empty name → 'read' (safe default)", () => assert.equal(classifyTool(""), "read"))
  it("unknown tool name → 'read' (safe default)", () => {
    assert.equal(classifyTool("some_unrecognised_tool"), "read")
  })
  it("case-insensitive: BASH → 'exec'", () => assert.equal(classifyTool("BASH"), "exec"))
  it("case-insensitive: TodoWrite → 'meta'", () => assert.equal(classifyTool("TodoWrite"), "meta"))
})

describe("resolveSubagentDisplayName — shared title resolution", () => {
  it("returns the real agentName when a subagent_type is specified", () => {
    assert.equal(
      resolveSubagentDisplayName({ agentName: "explore", purpose: "Audit UI", prompt: "x" }),
      "explore",
    )
  })

  it("falls back to purpose when agentName is the generic 'subagent'", () => {
    assert.equal(
      resolveSubagentDisplayName({ agentName: "subagent", purpose: "Refactor auth", prompt: "x" }),
      "Refactor auth",
    )
  })

  it("falls back to purpose when agentName is empty", () => {
    assert.equal(
      resolveSubagentDisplayName({ agentName: "", purpose: "Write tests", prompt: "x" }),
      "Write tests",
    )
  })

  it("returns bare 'Subagent' when neither agentName nor purpose is available", () => {
    assert.equal(resolveSubagentDisplayName({ agentName: "subagent", purpose: "", prompt: "" }), "Subagent")
    assert.equal(resolveSubagentDisplayName({ agentName: "", purpose: undefined, prompt: "" }), "Subagent")
  })

  it("truncates long purpose to 80 characters with ellipsis", () => {
    const longPurpose = "A".repeat(120)
    const result = resolveSubagentDisplayName({ agentName: "subagent", purpose: longPurpose, prompt: "" })
    assert.ok(result.length < longPurpose.length + 20, "must be truncated")
    assert.ok(result.endsWith("..."), "must end with ellipsis")
  })
})

describe("resolveSubagentActivityName — activity-panel name resolution", () => {
  it("returns the real agentName when provided", () => {
    assert.equal(resolveSubagentActivityName("explore", "Audit UI"), "explore")
  })

  it("falls back to description when agentName is 'subagent'", () => {
    assert.equal(resolveSubagentActivityName("subagent", "Refactor auth"), "Refactor auth")
  })

  it("falls back to description when agentName is undefined", () => {
    assert.equal(resolveSubagentActivityName(undefined, "Write tests"), "Write tests")
  })

  it("returns bare 'Subagent' when neither is available", () => {
    assert.equal(resolveSubagentActivityName("subagent", undefined), "Subagent")
    assert.equal(resolveSubagentActivityName(undefined, ""), "Subagent")
  })

  it("truncates long description to 80 characters with ellipsis", () => {
    const longDesc = "B".repeat(120)
    const result = resolveSubagentActivityName("subagent", longDesc)
    assert.ok(result.length < longDesc.length + 20, "must be truncated")
    assert.ok(result.endsWith("..."), "must end with ellipsis")
  })
})
