import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildSession,
  isValidSession,
  isAutoSessionName,
  isLocalPlaceholderSessionId,
  sessionDisplayName,
  validateSessionName,
  generateTitleFromMessage,
  classifySession,
} from "./sessionUtils"

void describe("buildSession", () => {
  void it("generates ID when none provided", () => {
    const s = buildSession({})
    assert.equal(typeof s.id, "string")
    assert.equal(s.id.length > 0, true)
    assert.equal(s.name, "")
    assert.equal(s.mode, "build")
  })

  void it("uses provided ID and name", () => {
    const s = buildSession({ id: "abc-123", name: "My Session" })
    assert.equal(s.id, "abc-123")
    assert.equal(s.name, "My Session")
  })

  void it("trims whitespace from name", () => {
    const s = buildSession({ name: "  hello  " })
    assert.equal(s.name, "hello")
  })

  void it("sets cliSessionId from id when not provided", () => {
    const s = buildSession({ id: "abc" })
    assert.equal(s.cliSessionId, "abc")
  })

  void it("sets explicit cliSessionId", () => {
    const s = buildSession({ id: "abc", cliSessionId: "cli-456" })
    assert.equal(s.cliSessionId, "cli-456")
  })

  void it("sets pendingServerLink flag", () => {
    const s = buildSession({ pendingServerLink: true })
    assert.equal(s.pendingServerLink, true)
  })

  void it("does not default pending local placeholder sessions to a CLI session id", () => {
    const s = buildSession({ id: "session-deadbeef", pendingServerLink: true })
    assert.equal(s.cliSessionId, undefined)
    assert.equal(s.pendingServerLink, true)
  })

  void it("detects webview-local placeholder ids", () => {
    assert.equal(isLocalPlaceholderSessionId("session-deadbeef"), true)
    assert.equal(isLocalPlaceholderSessionId("session-4d3efea9"), true)
    assert.equal(isLocalPlaceholderSessionId("session-not-real"), false)
    assert.equal(isLocalPlaceholderSessionId("ses_1ca1abbb0ffe7g3Gwbt4U1lJds"), false)
    assert.equal(isLocalPlaceholderSessionId(undefined), false)
  })

  void it("initializes zero values correctly", () => {
    const s = buildSession({})
    assert.equal(s.cost, 0)
    assert.deepEqual(s.tokenUsage, { prompt: 0, completion: 0, total: 0 })
    assert.deepEqual(s.messages, [])
  })
})

void describe("isValidSession", () => {
  void it("accepts valid session", () => {
    assert.equal(isValidSession({ id: "a", name: "T", createdAt: 1, messages: [] }), true)
  })

  void it("rejects missing id", () => {
    assert.equal(isValidSession({ name: "T", createdAt: 1, messages: [] }), false)
  })

  void it("rejects missing name", () => {
    assert.equal(isValidSession({ id: "a", createdAt: 1, messages: [] }), false)
  })

  void it("rejects non-array messages", () => {
    assert.equal(isValidSession({ id: "a", name: "T", createdAt: 1, messages: "bad" }), false)
  })

  void it("rejects non-numeric createdAt", () => {
    assert.equal(isValidSession({ id: "a", name: "T", createdAt: "str", messages: [] }), false)
  })

  void it("rejects null", () => {
    assert.equal(isValidSession(null as unknown as Record<string, unknown>), false)
  })
})

void describe("sessionDisplayName", () => {
  void it("returns 'Untitled session' for empty name", () => {
    assert.equal(sessionDisplayName({ name: "" }), "Untitled session")
  })

  void it("returns 'Untitled session' for auto-generated names", () => {
    assert.equal(sessionDisplayName({ name: "Session AbC12" }), "Untitled session")
    assert.equal(sessionDisplayName({ name: "Session 42" }), "Untitled session")
  })

  void it("returns real names as-is", () => {
    assert.equal(sessionDisplayName({ name: "Fix login bug" }), "Fix login bug")
  })

  void it("handles undefined session", () => {
    assert.equal(sessionDisplayName(undefined), "Untitled session")
  })
})

void describe("isAutoSessionName", () => {
  void it("treats placeholders as untitled auto names", () => {
    assert.equal(isAutoSessionName(""), true)
    assert.equal(isAutoSessionName("Session abc123"), true)
    assert.equal(isAutoSessionName("Session 4"), true)
    assert.equal(isAutoSessionName("New Session"), true)
    assert.equal(isAutoSessionName("New Chat"), true)
    assert.equal(isAutoSessionName("Untitled session"), true)
  })

  void it("does not treat real first-message titles as auto names", () => {
    assert.equal(isAutoSessionName("Fix the login bug"), false)
  })
})

void describe("validateSessionName", () => {
  void it("rejects empty name", () => {
    assert.equal(validateSessionName(""), "Session name cannot be empty.")
  })

  void it("rejects too-long name", () => {
    assert.equal(validateSessionName("a".repeat(81)), "Session name must be 80 characters or fewer.")
  })

  void it("rejects path separators", () => {
    assert.notEqual(validateSessionName("a/b"), null)
    assert.notEqual(validateSessionName("a\\b"), null)
  })

  void it("accepts valid name", () => {
    assert.equal(validateSessionName("Fix login bug"), null)
  })
})

void describe("generateTitleFromMessage", () => {
  void it("returns empty for empty string", () => {
    assert.equal(generateTitleFromMessage(""), "")
  })

  void it("takes first sentence", () => {
    const result = generateTitleFromMessage("Fix the login bug. Then deploy.")
    assert.equal(result, "Fix the login bug")
  })

  void it("truncates at 40 chars", () => {
    const long = "This is a very long message that should definitely be truncated because it exceeds forty characters"
    const result = generateTitleFromMessage(long)
    assert.equal(result.length <= 40, true)
    assert.equal(result.endsWith("..."), true)
  })

  void it("handles newlines as sentence break", () => {
    assert.equal(generateTitleFromMessage("First line\nSecond line"), "First line")
  })
})

void describe("classifySession", () => {
  void it("classifies corrupted session", () => {
    assert.equal(classifySession({ messages: [] } as Parameters<typeof classifySession>[0]), "corrupted")
  })

  void it("classifies archived session", () => {
    assert.equal(classifySession({ name: "A", createdAt: 1, messages: [{ role: "user" }], archived: true, cliSessionId: "x" }), "archived")
  })

  void it("classifies empty session", () => {
    assert.equal(classifySession({ name: "X", createdAt: 1, messages: [] }), "empty")
  })

  void it("classifies test-named session", () => {
    assert.equal(classifySession({ name: "Default", createdAt: 1, messages: [{ role: "user" }] }), "test_named")
    assert.equal(classifySession({ name: "Session 123", createdAt: 1, messages: [{ role: "user" }] }), "test_named")
  })

  void it("classifies orphaned session (no cliSessionId)", () => {
    assert.equal(classifySession({ name: "Real name", createdAt: 1, messages: [{ role: "user" }] }), "orphaned")
  })

  void it("classifies real session", () => {
    assert.equal(classifySession({ name: "Fix bug", createdAt: 1, messages: [{ role: "user" }], cliSessionId: "cli-1" }), "real")
  })
})
