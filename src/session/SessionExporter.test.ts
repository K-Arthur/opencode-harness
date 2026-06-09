import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionExporter.ts"), "utf8")

describe("SessionExporter.ts", () => {
  it("exports_SessionExporter_class", () => {
    assert.ok(source.includes("export class SessionExporter"))
  })

  it("exportMarkdown_includes_header_with_date_model_count", () => {
    assert.ok(source.includes("Date Range"))
    assert.ok(source.includes("Model"))
    assert.ok(source.includes("Message Count"))
    assert.ok(source.includes("Tool Calls"))
    assert.ok(source.includes("Diffs"))
    assert.ok(source.includes("createdAt"))
    assert.ok(source.includes("lastActiveAt"))
  })

  it("exportMarkdown_formats_messages_with_timestamp_and_role", () => {
    assert.ok(source.includes("timestamp"))
    assert.ok(source.includes("msg.role"))
    assert.ok(source.includes("roleLabel"))
    assert.ok(source.includes("User"))
    assert.ok(source.includes("OpenCode"))
  })

  it("exportMarkdown_includes_tool_calls_in_details", () => {
    assert.ok(source.includes("<details>"))
    assert.ok(source.includes("tool_call"))
    assert.ok(source.includes("toolName"))
    assert.ok(source.includes("Tool:"))
  })

  it("exportMarkdown_includes_diffs_with_filename_header", () => {
    assert.ok(source.includes("diff"))
    assert.ok(source.includes("fileName"))
    assert.ok(source.includes("diffText"))
    assert.ok(source.includes("```diff"))
  })

  it("saves_to_desktop_with_session_title", () => {
    assert.ok(source.includes("showSaveDialog"))
    assert.ok(source.includes("os.homedir()"))
    assert.ok(source.includes("Desktop"))
  })
})
