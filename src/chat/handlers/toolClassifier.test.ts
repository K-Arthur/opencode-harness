import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { classifyTool } from "./toolClassifier"

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
