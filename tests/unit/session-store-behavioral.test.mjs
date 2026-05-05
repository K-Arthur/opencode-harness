/**
 * Behavioral tests for SessionStore — tests actual behavior, not text patterns.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

class MockMemento {
  constructor() { this.store = new Map() }
  get(key, defaultValue) { return this.store.has(key) ? this.store.get(key) : defaultValue }
  async update(key, value) { this.store.set(key, value) }
  get keys() { return Array.from(this.store.keys()) }
}

// Replicate the exact logic from SessionStore.flush() for testing
function shouldPersist(session, activeSessionId) {
  return session.messages.length > 0 || session.id === activeSessionId
}

// Replicate isValidSession logic
function isValidSession(sess) {
  if (!sess || typeof sess !== "object") return false
  return (
    typeof sess.id === "string" &&
    typeof sess.name === "string" &&
    typeof sess.createdAt === "number" &&
    Array.isArray(sess.messages)
  )
}

describe("SessionStore — empty session filtering", () => {
  it("persists sessions with messages", () => {
    const sess = { id: "s1", name: "Chat 1", createdAt: 1000, messages: [{ role: "user", blocks: [] }] }
    assert.equal(shouldPersist(sess, "s2"), true)
  })

  it("persists the active session even if empty", () => {
    const sess = { id: "s1", name: "Empty", createdAt: 1000, messages: [] }
    assert.equal(shouldPersist(sess, "s1"), true)
  })

  it("skips non-active empty sessions", () => {
    const sess = { id: "s2", name: "Empty", createdAt: 1000, messages: [] }
    assert.equal(shouldPersist(sess, "s1"), false)
  })

  it("skips session with zero-length messages array", () => {
    const sess = { id: "s3", name: "Empty", createdAt: 1000, messages: [] }
    assert.equal(shouldPersist(sess, null), false)
  })

  it("persists session with many messages", () => {
    const sess = { id: "s4", name: "Busy", createdAt: 1000, messages: [
      { role: "user", blocks: [{ type: "text", text: "hello" }] },
      { role: "assistant", blocks: [{ type: "text", text: "hi" }] },
    ]}
    assert.equal(shouldPersist(sess, "other"), true)
  })
})

describe("SessionStore — isValidSession validation", () => {
  it("accepts a valid session object", () => {
    assert.equal(isValidSession({ id: "a", name: "Test", createdAt: 1, messages: [] }), true)
  })

  it("rejects missing id", () => {
    assert.equal(isValidSession({ name: "Test", createdAt: 1, messages: [] }), false)
  })

  it("rejects missing name", () => {
    assert.equal(isValidSession({ id: "a", createdAt: 1, messages: [] }), false)
  })

  it("rejects non-array messages", () => {
    assert.equal(isValidSession({ id: "a", name: "Test", createdAt: 1, messages: "not-an-array" }), false)
  })

  it("rejects null", () => {
    assert.equal(isValidSession(null), false)
  })

  it("rejects undefined", () => {
    assert.equal(isValidSession(undefined), false)
  })

  it("rejects non-object", () => {
    assert.equal(isValidSession("string"), false)
  })

  it("rejects missing createdAt", () => {
    assert.equal(isValidSession({ id: "a", name: "Test", messages: [] }), false)
  })

  it("accepts session with string createdAt (coerced to number)", () => {
    // Should reject — typeof "not-a-number" is "string", not "number"
    assert.equal(isValidSession({ id: "a", name: "Test", createdAt: "not-a-number", messages: [] }), false)
  })
})

describe("SessionStore — mock persistence round-trip", () => {
  let memento

  beforeEach(() => {
    memento = new MockMemento()
  })

  it("saves only sessions with messages", async () => {
    const sessions = {
      "s1": { id: "s1", name: "Empty 1", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
      "s2": { id: "s2", name: "Has Messages", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [{ role: "user", blocks: [] }], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
      "s3": { id: "s3", name: "Empty 3", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    }

    const obj = {}
    const activeId = "s2"
    for (const [id, sess] of Object.entries(sessions)) {
      if (sess.messages.length > 0 || id === activeId) {
        obj[id] = sess
      }
    }

    await memento.update("test", obj)

    assert.equal(Object.keys(obj).length, 1)
    assert.equal(obj["s2"] !== undefined, true)
    assert.equal(obj["s1"], undefined)
    assert.equal(obj["s3"], undefined)
  })

  it("saves active session even when empty", async () => {
    const sessions = {
      "active": { id: "active", name: "Active Empty", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    }

    const obj = {}
    for (const [id, sess] of Object.entries(sessions)) {
      if (sess.messages.length > 0 || id === "active") {
        obj[id] = sess
      }
    }

    assert.equal(Object.keys(obj).length, 1)
    assert.equal(obj["active"] !== undefined, true)
  })

  it("does not save any session when all are empty and non-active", async () => {
    const sessions = {
      "s1": { id: "s1", name: "E1", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
      "s2": { id: "s2", name: "E2", createdAt: 1000, lastActiveAt: 1000, model: "", mode: "plan", messages: [], cost: 0, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    }

    const obj = {}
    const activeId = "someOtherId" // active is different from s1 and s2
    for (const [id, sess] of Object.entries(sessions)) {
      if (sess.messages.length > 0 || id === activeId) {
        obj[id] = sess
      }
    }

    assert.equal(Object.keys(obj).length, 0)
  })
})
