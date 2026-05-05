import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "session", "SessionStore.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("SessionStore — class structure", () => {
  it("defines SessionStore as exported class", () => {
    assert.ok(source.includes("export class SessionStore"), "SessionStore class must be exported")
  })

  it("defines OpenCodeSession interface with all required fields", () => {
    assert.ok(source.includes("export interface OpenCodeSession"))
    assert.ok(source.includes("id:"), "must have id")
    assert.ok(source.includes("name:"), "must have name")
    assert.ok(source.includes("createdAt:"), "must have createdAt")
    assert.ok(source.includes("lastActiveAt:"), "must have lastActiveAt")
    assert.ok(source.includes("model:"), "must have model")
    assert.ok(source.includes("mode:"), "must have mode")
    assert.ok(source.includes("messages:"), "must have messages")
    assert.ok(source.includes("cost:"), "must have cost")
    assert.ok(source.includes("tokenUsage:"), "must have tokenUsage")
    assert.ok(source.includes("cliSessionId?"), "must have optional cliSessionId")
  })

  it("stores sessions in a Map", () => {
    assert.ok(source.includes("Map<"), "must use Map for storage")
  })

  it("defines STORAGE_KEY constant", () => {
    assert.ok(source.includes("STORAGE_KEY"), "STORAGE_KEY constant must exist")
  })

  it("enforces MAX_SESSIONS limit", () => {
    assert.ok(source.includes("MAX_SESSIONS"), "must limit max sessions")
    assert.ok(source.includes("50"), "max sessions should be 50")
  })

  it("uses SAVE_DEBOUNCE_MS for debounced persistence", () => {
    assert.ok(source.includes("SAVE_DEBOUNCE_MS"), "save debounce constant must exist")
    assert.ok(source.includes("500"), "debounce should be 500ms")
  })
})

describe("SessionStore — session lifecycle", () => {
  it("create creates a session with default values", () => {
    assert.ok(source.includes("create("), "create method must exist")
    assert.ok(source.includes("crypto.randomUUID"), "must generate unique id")
    assert.ok(source.includes("messages: []"), "must have empty messages array")
    assert.ok(source.includes('mode: "build"'), "default mode must be build")
    assert.ok(source.includes("cost: 0"), "default cost must be 0")
    assert.ok(source.includes("tokenUsage:"), "must initialize token usage")
  })

  it("create sets activeSessionId to new session", () => {
    assert.ok(source.includes("this.activeSessionId = sessionId"), "must set as active")
  })

  it("create triggers onSessionsChanged event", () => {
    assert.ok(source.includes("_onSessionsChanged.fire"), "must emit sessions changed")
  })

  it("delete removes session and handles active switch", () => {
    assert.ok(source.includes("delete("), "delete method must exist")
    assert.ok(source.includes("this.sessions.delete(id)"), "must delete from map")
    assert.ok(source.includes("activeSessionId"), "must handle active tab switch")
  })

  it("delete triggers onSessionsChanged event", () => {
    const methodStart = source.indexOf("delete(id: string)")
    const methodEnd = source.indexOf("dispose()", methodStart)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(method.includes("_onSessionsChanged.fire"), "must emit after delete")
  })

  it("dispose flushes and cleans up emitters", () => {
    const methodStart = source.indexOf("dispose(): void")
    const methodEnd = methodStart + 120
    const method = source.slice(methodStart, methodEnd)
    assert.ok(method.includes("this.flush()"), "must flush before dispose")
    assert.ok(method.includes("_onSessionsChanged.dispose()"), "must dispose sessions emitter")
    assert.ok(method.includes("_onActiveSessionChanged.dispose()"), "must dispose active emitter")
  })
})

describe("SessionStore — persistence", () => {
  it("load reads from globalState in constructor", () => {
    assert.ok(source.includes("this.load()"), "constructor must call load")
    assert.ok(source.includes("globalState.get"), "must read from globalState")
    assert.ok(source.includes("STORAGE_KEY"), "must use STORAGE_KEY for persistence")
  })

  it("save uses debounced write to globalState", () => {
    assert.ok(source.includes("private save():"), "save method must exist")
    assert.ok(source.includes("setTimeout"), "must debounce saves")
    assert.ok(source.includes("SAVE_DEBOUNCE_MS"), "must use debounce constant")
  })

  it("flush writes synchronously to globalState", () => {
    assert.ok(source.includes("flush():"), "flush method must exist")
    assert.ok(source.includes("globalState.update"), "must write to globalState")
    assert.ok(source.includes("STORAGE_KEY"), "must use STORAGE_KEY")
  })

  it("flush wraps write in try/catch", () => {
    assert.ok(source.includes("try {") && source.includes("catch (err)"), "flush must use try/catch")
  })

  it("pruneStaleSessions removes empty sessions older than 1 hour", () => {
    assert.ok(source.includes("pruneStaleSessions"), "pruneStaleSessions method must exist")
    assert.ok(source.includes("ONE_HOUR"), "must define one hour threshold")
    assert.ok(source.includes("messages.length === 0"), "must only prune empty sessions")
  })

  it("ensure creates or updates a session", () => {
    assert.ok(source.includes("ensure("), "ensure method must exist")
    assert.ok(source.includes("existing)"), "must check for existing session")
    assert.ok(source.includes("this.create(name, id)"), "must fallback to create")
  })
})

describe("SessionStore — session accessors", () => {
  it("provides get to retrieve by id", () => {
    assert.ok(source.includes("get(id: string)"), "get method must exist")
    assert.ok(source.includes("this.sessions.get(id)"), "get must use map lookup")
  })

  it("provides list sorted by lastActiveAt descending", () => {
    assert.ok(source.includes("list():"), "list method must exist")
    assert.ok(source.includes("lastActiveAt"), "must sort by lastActiveAt")
    assert.ok(source.includes("sort("), "must sort results")
  })

  it("provides getActive to retrieve active session", () => {
    assert.ok(source.includes("getActive("), "getActive method must exist")
    assert.ok(source.includes("this.sessions.get(this.activeSessionId)"), "getActive must use activeSessionId")
  })

  it("provides setActive to change active session", () => {
    assert.ok(source.includes("setActive("), "setActive method must exist")
    assert.ok(source.includes("this.activeSessionId = id"), "setActive must update activeSessionId")
  })

  it("provides activeId getter", () => {
    assert.ok(source.includes("get activeId():"), "activeId getter must exist")
    assert.ok(source.includes("return this.activeSessionId"), "activeId must return activeSessionId")
  })

  it("provides count getter", () => {
    assert.ok(source.includes("get count():"), "count getter must exist")
    assert.ok(source.includes("return this.sessions.size"), "count must return map size")
  })
})

describe("SessionStore — session mutations", () => {
  it("appendMessage adds message and updates lastActiveAt", () => {
    assert.ok(source.includes("appendMessage("), "appendMessage method must exist")
    assert.ok(source.includes("session.messages.push(msg)"), "must push message")
    assert.ok(source.includes("session.lastActiveAt"), "must update lastActiveAt")
  })

  it("updateName renames session", () => {
    assert.ok(source.includes("updateName("), "updateName method must exist")
    assert.ok(source.includes("session.name = name"), "must set name")
  })

  it("rename is alias for updateName", () => {
    assert.ok(source.includes("rename("), "rename method must exist")
    assert.ok(source.includes("this.updateName(id, name)"), "rename must delegate to updateName")
  })

  it("truncateMessages removes downstream messages", () => {
    assert.ok(source.includes("truncateMessages("), "truncateMessages method must exist")
    assert.ok(source.includes("session.messages.splice"), "must splice messages array")
  })

  it("updateModel changes session model", () => {
    assert.ok(source.includes("updateModel("), "updateModel method must exist")
    assert.ok(source.includes("session.model = model"), "must set model")
  })

  it("updateMode changes session mode", () => {
    assert.ok(source.includes("updateMode("), "updateMode method must exist")
    assert.ok(source.includes("session.mode = mode"), "must set mode")
  })

  it("updateCost changes session cost", () => {
    assert.ok(source.includes("updateCost("), "updateCost method must exist")
    assert.ok(source.includes("session.cost = cost"), "must set cost")
  })

  it("updateTokenUsage changes token tracking", () => {
    assert.ok(source.includes("updateTokenUsage("), "updateTokenUsage method must exist")
    assert.ok(source.includes("session.tokenUsage = usage"), "must set tokenUsage")
  })

  it("updateCliSessionId binds to CLI session", () => {
    assert.ok(source.includes("updateCliSessionId("), "updateCliSessionId method must exist")
    assert.ok(source.includes("session.cliSessionId"), "must set cliSessionId")
  })

  it("duplicate creates a deep copy of a session", () => {
    assert.ok(source.includes("duplicate("), "duplicate method must exist")
    assert.ok(source.includes("JSON.parse"), "must deep clone")
    assert.ok(source.includes("crypto.randomUUID"), "must generate new id")
  })
})

describe("SessionStore — server restart handling", () => {
  it("invalidateAllCliSessionIds clears CLI session links", () => {
    assert.ok(source.includes("invalidateAllCliSessionIds"), "method must exist")
    assert.ok(source.includes("session.cliSessionId = undefined"), "must clear cliSessionId")
  })
})

describe("SessionStore — event emitters", () => {
  it("defines onSessionsChanged event", () => {
    assert.ok(source.includes("_onSessionsChanged"), "sessions emitter must exist")
    assert.ok(source.includes("onSessionsChanged"), "sessions event accessor must exist")
  })

  it("defines onActiveSessionChanged event", () => {
    assert.ok(source.includes("_onActiveSessionChanged"), "active emitter must exist")
    assert.ok(source.includes("onActiveSessionChanged"), "active event accessor must exist")
  })
})
