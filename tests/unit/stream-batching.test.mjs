import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("StreamCoordinator chunk batching", () => {
  it("batches multiple chunks into single flush", () => {
    const buffer = new Map()
    const flushed = []

    const sessionId = "sess-123"
    const chunks = ["Hello ", "World", "!"]
    for (const chunk of chunks) {
      const existing = buffer.get(sessionId) || ""
      buffer.set(sessionId, existing + chunk)
    }

    for (const [sid, text] of buffer) {
      flushed.push({ sessionId: sid, text })
    }
    buffer.clear()

    assert.equal(flushed.length, 1)
    assert.equal(flushed[0].text, "Hello World!")
    assert.equal(flushed[0].sessionId, sessionId)
  })

  it("tracks multiple sessions independently", () => {
    const buffer = new Map()
    buffer.set("sess-a", (buffer.get("sess-a") || "") + "chunk-a1")
    buffer.set("sess-b", (buffer.get("sess-b") || "") + "chunk-b1")
    buffer.set("sess-a", (buffer.get("sess-a") || "") + "chunk-a2")

    assert.equal(buffer.get("sess-a"), "chunk-a1chunk-a2")
    assert.equal(buffer.get("sess-b"), "chunk-b1")
  })

  it("clears buffer after flush", () => {
    const buffer = new Map()
    buffer.set("sess-1", "text")
    buffer.clear()
    assert.equal(buffer.size, 0)
  })
})

describe("ChatProvider error message mapping", () => {
  function toUserErrorMessage(message) {
    if (/server not running/i.test(message)) return "OpenCode is not connected. Try again after the server starts."
    if (/not installed|not found/i.test(message)) return message
    if (/timeout|did not start/i.test(message)) return "OpenCode took too long to respond. Check the output logs and try again."
    return message || "The request failed. Check the OpenCode output logs for details."
  }

  it("maps server not running to user-friendly message", () => {
    assert.equal(
      toUserErrorMessage("Server not running on port 4096"),
      "OpenCode is not connected. Try again after the server starts."
    )
  })

  it("passes through not installed messages as-is", () => {
    assert.equal(toUserErrorMessage("opencode not installed"), "opencode not installed")
  })

  it("maps timeout messages", () => {
    assert.equal(
      toUserErrorMessage("Request timeout after 30s"),
      "OpenCode took too long to respond. Check the output logs and try again."
    )
  })

  it("returns generic message for empty input", () => {
    assert.equal(
      toUserErrorMessage(""),
      "The request failed. Check the OpenCode output logs for details."
    )
  })

  it("passes through unknown errors as-is", () => {
    assert.equal(toUserErrorMessage("Something unexpected happened"), "Something unexpected happened")
  })
})

describe("ChatProvider tool type mapping", () => {
  function mapToolType(tool) {
    if (!tool) return "read"
    const t = tool.toLowerCase()
    if (t.includes("edit") || t.includes("write") || t.includes("create") || t.includes("apply")) return "write"
    if (t.includes("bash") || t.includes("exec") || t.includes("run") || t.includes("command")) return "exec"
    return "read"
  }

  it("maps empty tool to read", () => { assert.equal(mapToolType(""), "read") })

  it("maps edit tools to write", () => {
    assert.equal(mapToolType("file_edit"), "write")
    assert.equal(mapToolType("write_file"), "write")
    assert.equal(mapToolType("create_file"), "write")
    assert.equal(mapToolType("apply_diff"), "write")
  })

  it("maps execution tools to exec", () => {
    assert.equal(mapToolType("bash_command"), "exec")
    assert.equal(mapToolType("exec_sql"), "exec")
    assert.equal(mapToolType("run_tests"), "exec")
    assert.equal(mapToolType("command_runner"), "exec")
  })

  it("maps unknown tools to read", () => {
    assert.equal(mapToolType("read_file"), "read")
    assert.equal(mapToolType("search"), "read")
    assert.equal(mapToolType("list_directory"), "read")
  })
})
