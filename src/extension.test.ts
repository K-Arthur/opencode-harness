import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const extensionSource = readFileSync(path.join(__dirname, "extension.ts"), "utf8")
const rollbackSource = readFileSync(path.join(__dirname, "commands", "rollback.ts"), "utf8")
const themeSource = readFileSync(path.join(__dirname, "commands", "theme.ts"), "utf8")
const sessionSource = readFileSync(path.join(__dirname, "commands", "session.ts"), "utf8")
const modelSource = readFileSync(path.join(__dirname, "commands", "model.ts"), "utf8")
const miscSource = readFileSync(path.join(__dirname, "commands", "misc.ts"), "utf8")
const exportSource = readFileSync(path.join(__dirname, "commands", "export.ts"), "utf8")

describe("extension.ts", () => {
  it("exports activate function", () => {
    assert.ok(extensionSource.includes("export async function activate(") || extensionSource.includes("export function activate("))
  })

  it("exports deactivate function", () => {
    assert.ok(extensionSource.includes("export function deactivate()"))
  })

  it("creates SessionManager", () => {
    assert.ok(extensionSource.includes("new SessionManager"))
  })

  it("creates ContextEngine", () => {
    assert.ok(extensionSource.includes("new ContextEngine()"))
  })

  it("creates ThemeManager", () => {
    assert.ok(extensionSource.includes("new ThemeManager()"))
  })

  it("calls registerCoreCommands with all command modules", () => {
    assert.ok(extensionSource.includes("registerCoreCommands("))
  })

  it("registers opencode-harness.rollback command", () => {
    assert.ok(rollbackSource.includes("opencode-harness.rollback"))
  })

  it("registers opencode-harness.previewTheme command", () => {
    assert.ok(themeSource.includes("opencode-harness.previewTheme"))
  })

  it("registers opencode-harness.captureTerminal command", () => {
    assert.ok(themeSource.includes("opencode-harness.captureTerminal"))
  })

  it("registers opencode-harness.openChat command", () => {
    assert.ok(sessionSource.includes("opencode-harness.openChat"))
  })

  it("registers opencode-harness.newSession command", () => {
    assert.ok(sessionSource.includes("opencode-harness.newSession"))
  })

  it("registers opencode-harness.selectModel command", () => {
    assert.ok(modelSource.includes("opencode-harness.selectModel"))
  })

  it("registers opencode-harness.showRateLimits command", () => {
    assert.ok(miscSource.includes("opencode-harness.showRateLimits"))
  })

  it("registers opencode-harness.checkCli command", () => {
    assert.ok(miscSource.includes("opencode-harness.checkCli"))
  })

  it("registers opencode-harness.exportConversation command", () => {
    assert.ok(exportSource.includes("opencode-harness.exportConversation"))
  })

  it("handles server_connected event", () => {
    assert.ok(extensionSource.includes("server_connected"))
  })

  it("handles server_disconnected event", () => {
    assert.ok(extensionSource.includes("server_disconnected"))
  })

  it("wires SDK-backed session title sync", () => {
    assert.ok(extensionSource.includes("setServerTitleUpdater"), "SessionStore must propagate local renames to the server")
    assert.ok(extensionSource.includes("updateSessionTitle"), "title updater must call the SDK-backed SessionManager method")
    assert.ok(extensionSource.includes('case "session_updated"'), "server title updates must flow back into local cache")
    assert.ok(extensionSource.includes("applyServerTitle"), "session.updated events must update local cached title")
  })
})
