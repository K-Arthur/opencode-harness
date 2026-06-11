import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "CommandExecutionService.ts"), "utf8")

void describe("CommandExecutionService.ts", () => {
  void it("exports CommandExecutionService class", () => {
    assert.ok(source.includes("export class CommandExecutionService"), "CommandExecutionService class must be exported")
  })

  void it("has handleExecuteCommand method", () => {
    assert.ok(source.includes("async handleExecuteCommand("), "must have handleExecuteCommand")
  })

  void it("ensures server session before executing remote command when cliSessionId is missing", () => {
    assert.ok(
      source.includes("ensureSession") && source.includes("handleExecuteCommand"),
      "handleExecuteCommand must call ensureSession when cliSessionId is missing to create a server session for new tabs"
    )
    const handleIdx = source.indexOf("async handleExecuteCommand(")
    assert.ok(handleIdx >= 0, "handleExecuteCommand must exist")
    const block = source.slice(handleIdx, source.indexOf("async handleLocalSlashCommand", handleIdx))
    assert.ok(
      block.includes("ensureSession"),
      "handleExecuteCommand must call ensureSession before executeRemoteCommand to handle first-command-on-new-session"
    )
  })

  void it("updates cliSessionId on tab after ensuring session", () => {
    const handleIdx = source.indexOf("async handleExecuteCommand(")
    assert.ok(handleIdx >= 0)
    const block = source.slice(handleIdx, source.indexOf("async handleLocalSlashCommand", handleIdx))
    assert.ok(
      block.includes("setCliSessionId"),
      "handleExecuteCommand must update tab.cliSessionId after ensureSession so subsequent commands use the server ID"
    )
  })

  void it("updates cliSessionId on session store after ensuring session", () => {
    const handleIdx = source.indexOf("async handleExecuteCommand(")
    assert.ok(handleIdx >= 0)
    const block = source.slice(handleIdx, source.indexOf("async handleLocalSlashCommand", handleIdx))
    assert.ok(
      block.includes("updateCliSessionId"),
      "handleExecuteCommand must update SessionStore.cliSessionId after ensureSession for persistence"
    )
  })

  void it("shows clear error when server is not running during command execution", () => {
    assert.ok(
      source.includes("server not running"),
      "must show user-friendly error when server is not running"
    )
  })

  void it("custom prompt commands route through sendPromptToWebview (no server session needed)", () => {
    const handleIdx = source.indexOf("async handleExecuteCommand(")
    assert.ok(handleIdx >= 0)
    const block = source.slice(handleIdx, source.indexOf("async handleLocalSlashCommand", handleIdx))
    assert.ok(
      block.includes("getPrompt") && block.includes("sendPromptToWebview"),
      "custom prompt commands must use sendPromptToWebview which triggers normal send flow (creates session automatically)"
    )
  })

  void it("local slash handler receives arguments so /methodology on|off can route", () => {
    assert.ok(
      /handleLocalSlashCommand\(\s*sessionId:\s*string,\s*commandName:\s*string,\s*args/.test(source),
      "handleLocalSlashCommand must accept an args parameter"
    )
    assert.ok(source.includes('case "methodology":'), "must route the methodology command locally")
  })
})
