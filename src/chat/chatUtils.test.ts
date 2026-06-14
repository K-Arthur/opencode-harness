import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { toUserErrorMessage, errorValueToMessage, mapToolType, isSessionInCurrentWorkspace, looksLikeSdkError, isAbortErrorValue } from "./chatUtils"

void describe("toUserErrorMessage", () => {
  void it("returns message as-is for non-matching messages", () => {
    assert.equal(toUserErrorMessage("generic error"), "generic error")
  })

  void it("extracts nested error from Command failed JSON", () => {
    const msg = 'Command failed: {"data":{"message":"disk full"}}'
    assert.equal(toUserErrorMessage(msg), "disk full")
  })

  void it("handles deeply nested Command failed JSON", () => {
    const msg = 'Command failed: {"message":"Command failed: {\\"data\\":{\\"message\\":\\"inner\\"}}"}'
    assert.equal(toUserErrorMessage(msg), "inner")
  })

  void it("returns slash command not found message", () => {
    const msg = 'Command not found: "/mycmd"'
    assert.equal(toUserErrorMessage(msg), 'Slash command "/mycmd" is not available in this session. Type /help for local commands or /commands for server commands.')
  })

  void it("handles server not running", () => {
    assert.equal(toUserErrorMessage("Server not running"), "OpenCode is not connected. Try again after the server starts.")
  })

  void it("handles timeout", () => {
    assert.equal(toUserErrorMessage("timeout occurred"), "OpenCode took too long to respond. Check the output logs and try again.")
  })

  void it("returns empty messages with default", () => {
    assert.equal(toUserErrorMessage(""), "The request failed. Check the OpenCode output logs for details.")
  })

  void it("handles not installed message", () => {
    const msg = "python3 is not installed"
    assert.equal(toUserErrorMessage(msg), msg)
  })
})

void describe("errorValueToMessage", () => {
  void it("extracts message from Error", () => {
    assert.equal(errorValueToMessage(new Error("boom")), "boom")
  })

  void it("returns string verbatim", () => {
    assert.equal(errorValueToMessage("oops"), "oops")
  })

  void it("extracts nested data.message from object", () => {
    assert.equal(errorValueToMessage({ data: { message: "inner" } }), "inner")
  })

  void it("extracts top-level message from object", () => {
    assert.equal(errorValueToMessage({ message: "top" }), "top")
  })

  void it("stringifies unknown objects", () => {
    const val = { foo: "bar" }
    assert.equal(errorValueToMessage(val), JSON.stringify(val))
  })

  void it("defaults for null", () => {
    assert.equal(errorValueToMessage(null), "Server error")
  })

  void it("defaults for undefined", () => {
    assert.equal(errorValueToMessage(undefined), "Server error")
  })
})

void describe("looksLikeSdkError", () => {
  void it("recognises a known SDK error name", () => {
    assert.equal(looksLikeSdkError({ name: "ProviderAuthError", data: { message: "x" } }), true)
    assert.equal(looksLikeSdkError({ name: "APIError", data: { statusCode: 429 } }), true)
  })

  void it("recognises a nested statusCode even without a known name", () => {
    assert.equal(looksLikeSdkError({ name: "Whatever", data: { statusCode: 500 } }), true)
  })

  void it("rejects plain connection-error strings", () => {
    assert.equal(looksLikeSdkError("OpenCode event stream connection timed out after 30s"), false)
  })

  void it("rejects null/undefined/non-SDK objects", () => {
    assert.equal(looksLikeSdkError(null), false)
    assert.equal(looksLikeSdkError(undefined), false)
    assert.equal(looksLikeSdkError({ message: "generic" }), false)
  })
})

void describe("isAbortErrorValue", () => {
  void it("recognises the MessageAbortedError SDK error by name", () => {
    assert.equal(isAbortErrorValue({ name: "MessageAbortedError", data: { message: "Aborted" } }), true)
  })

  void it("recognises aborted/cancelled wording in a message field", () => {
    assert.equal(isAbortErrorValue({ message: "The operation was aborted" }), true)
    assert.equal(isAbortErrorValue({ data: { message: "Request cancelled by user" } }), true)
    assert.equal(isAbortErrorValue("Aborted"), true)
    assert.equal(isAbortErrorValue("The request was canceled"), true)
  })

  void it("does not flag unrelated SDK errors as aborts", () => {
    assert.equal(isAbortErrorValue({ name: "APIError", data: { statusCode: 429, message: "rate limited" } }), false)
    assert.equal(isAbortErrorValue({ name: "ProviderAuthError", data: { message: "bad key" } }), false)
    assert.equal(isAbortErrorValue("OpenCode event stream connection timed out after 30s"), false)
  })

  void it("rejects null/undefined/empty", () => {
    assert.equal(isAbortErrorValue(null), false)
    assert.equal(isAbortErrorValue(undefined), false)
    assert.equal(isAbortErrorValue({}), false)
    assert.equal(isAbortErrorValue(""), false)
  })
})

void describe("mapToolType", () => {
  void it("maps edit tools to write", () => {
    assert.equal(mapToolType("editFile"), "write")
    assert.equal(mapToolType("Write"), "write")
    assert.equal(mapToolType("createFile"), "write")
    assert.equal(mapToolType("applyDiff"), "write")
  })

  void it("maps exec tools to exec", () => {
    assert.equal(mapToolType("bash"), "exec")
    assert.equal(mapToolType("executeCommand"), "exec")
    assert.equal(mapToolType("runScript"), "exec")
    assert.equal(mapToolType("command"), "exec")
  })

  void it("defaults to read for unknown tools", () => {
    assert.equal(mapToolType("readFile"), "read")
    assert.equal(mapToolType("search"), "read")
  })

  void it("defaults to read for empty string", () => {
    assert.equal(mapToolType(""), "read")
  })
})

void describe("isSessionInCurrentWorkspace", () => {
  void it("is true when no current workspace", () => {
    assert.equal(isSessionInCurrentWorkspace("/some/path", undefined), true)
  })

  void it("is true when session has no workspace", () => {
    assert.equal(isSessionInCurrentWorkspace(undefined, "/workspace"), true)
  })

  void it("is true when paths match", () => {
    assert.equal(isSessionInCurrentWorkspace("/ws/proj", "/ws/proj"), true)
  })

  void it("is false when paths differ", () => {
    assert.equal(isSessionInCurrentWorkspace("/ws/other", "/ws/proj"), false)
  })
})