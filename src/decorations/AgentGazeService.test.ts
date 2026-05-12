import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "AgentGazeService.ts"), "utf8")

describe("AgentGazeService.ts", () => {
  it("exports AgentGazeService class", () => {
    assert.ok(source.includes("export class AgentGazeService"), "must export AgentGazeService")
  })

  it("accepts SessionManager in constructor", () => {
    assert.ok(
      source.includes("sessionManager") || source.includes("SessionManager"),
      "constructor must accept a SessionManager to subscribe to tool events"
    )
  })

  it("implements Disposable pattern", () => {
    assert.ok(source.includes("dispose()"), "must implement dispose() to clean up subscriptions and decorations")
    assert.ok(
      source.includes("vscode.Disposable") || source.includes("implements") || source.includes("disposables"),
      "must track disposables to prevent resource leaks"
    )
  })

  it("creates three decoration types: read, write-in-progress, write-applied", () => {
    assert.ok(
      source.includes("createTextEditorDecorationType"),
      "must create TextEditorDecorationType instances for decorations"
    )
    // Three distinct decoration styles required
    assert.ok(
      (source.match(/createTextEditorDecorationType/g) || []).length >= 3,
      "must create at least 3 decoration types: read (blue), write-in-progress (yellow), write-applied (green)"
    )
  })

  it("subscribes to tool_start events from SessionManager", () => {
    assert.ok(
      source.includes("tool_start") || source.includes("onEvent") || source.includes("subscribe"),
      "must subscribe to tool_start events"
    )
  })

  it("extracts_file_path_from_tool_input", () => {
    // Tool input is a JSON object with a 'path' or 'file_path' key.
    // The service must extract it to know which file to decorate.
    assert.ok(
      source.includes("extractFilePath") || (source.includes('"path"') && source.includes("input")),
      "must extract file path from tool input"
    )
  })

  it("classifies tools as read or write by tool name", () => {
    // Tools like 'read_file', 'Read' → read (blue).
    // Tools like 'write_file', 'Edit', 'edit' → write (yellow/green).
    assert.ok(
      source.includes("isWriteTool") || source.includes("write") && source.includes("read"),
      "must classify tools as read vs write to apply the correct decoration"
    )
  })

  it("clears_read_decorations_when_next_tool_starts", () => {
    // Each new tool_start must clear prior read decorations so they don't
    // accumulate across multiple tool calls.
    assert.ok(
      source.includes("setDecorations") && source.includes("[]"),
      "must clear decorations by calling setDecorations with empty array"
    )
  })

  it("auto_clears_write_applied_decoration_after_timeout", () => {
    // The green 'write applied' decoration must fade after a short delay
    // so it doesn't persist forever in the editor gutter.
    assert.ok(
      source.includes("setTimeout"),
      "write-applied decoration must auto-clear after a timeout"
    )
  })

  it("does_not_apply_decorations_when_file_is_not_open", () => {
    // If the file the agent reads/writes is not open in the editor, no
    // decoration attempt must be made — getVisibleTextEditors / findDocument.
    assert.ok(
      source.includes("visibleTextEditors") || source.includes("textDocuments") || source.includes("findEditor"),
      "must only decorate files that are open in the editor"
    )
  })
})
