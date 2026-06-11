import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "ChatCommands.ts"), "utf8")

void describe("ChatCommands.ts", () => {
  void it("exports ChatCommands class", () => {
    assert.ok(source.includes("export class ChatCommands"), "ChatCommands class must be exported")
  })

  void it("constructor accepts sessionStore, sessionManager, tabManager, streamCoordinator", () => {
    assert.ok(source.includes("private readonly sessionStore: SessionStore"), "must accept SessionStore")
    assert.ok(source.includes("private readonly sessionManager: SessionManager"), "must accept SessionManager")
    assert.ok(source.includes("private readonly tabManager: TabManager"), "must accept TabManager")
    assert.ok(source.includes("private readonly streamCoordinator: StreamCoordinator"), "must accept StreamCoordinator")
  })

  void it("has clear method that aborts streaming and preserves session history", () => {
    assert.ok(source.includes("async clear("), "must have clear method")
    assert.ok(source.includes("tab.isStreaming"), "must check streaming state")
    assert.ok(source.includes("this.streamCoordinator.abort("), "must abort in-progress streams")
    assert.ok(source.includes('postMessage({ type: "clear_messages", sessionId })'), "must send clear_messages")
    assert.ok(source.includes("this.sessionStore.truncateMessages"), "must truncate messages to preserve history")
    assert.ok(source.includes("this.sessionManager.isRunning"), "must check sessionManager.isRunning")
    assert.ok(source.includes("this.sessionManager.createSession()"), "must create new server session")
    assert.ok(source.includes("this.sessionStore.updateCliSessionId"), "must update CLI session ID")
  })

  void it("has cost method that shows server figures", () => {
    assert.ok(source.includes("async cost("), "must have cost method")
    assert.ok(source.includes("this.sessionStore.get("), "must get session from store")
    assert.ok(source.includes("this.sessionManager.getSession("), "must request cost from server")
    assert.ok(source.includes("Session cost"), "must label as session cost")
    assert.ok(source.includes("serverCost"), "must track server cost")
    assert.ok(source.includes('role: "system"'), "must send as system message")
  })

  void it("has continue method that focuses most recently closed session", () => {
    assert.ok(source.includes("continue("), "must have continue method")
    assert.ok(source.includes("this.sessionStore.list()"), "must list all sessions")
    assert.ok(source.includes("this.sessionStore.activeId"), "must skip active session")
    assert.ok(source.includes("most recently closed"), "must handle recently closed")
    assert.ok(source.includes('"No previous sessions to continue."'), "must handle no sessions case")
  })

  void it("has methodology method that reports and toggles per-tab guidance", () => {
    assert.ok(source.includes("methodology("), "must have methodology method")
    assert.ok(source.includes("methodologyDisabled"), "must read/set tab.methodologyDisabled")
    assert.ok(source.includes("Usage: /methodology"), "invalid arguments must show usage")
    const idx = source.indexOf("methodology(")
    const block = source.slice(idx, idx + 2500)
    assert.ok(block.includes('role: "system"'), "state changes must be reported as a system message")
  })

  void it("has help method that shows command table", () => {
    assert.ok(source.includes("help("), "must have help method")
    assert.ok(source.includes("Available slash commands"), "must show available commands")
    assert.ok(source.includes("/clear"), "must include /clear")
    assert.ok(source.includes("/cost"), "must include /cost")
    assert.ok(source.includes("/continue"), "must include /continue")
    assert.ok(source.includes("/help"), "must include /help")
    assert.ok(source.includes('role: "system"'), "must send as system message")
  })
})
