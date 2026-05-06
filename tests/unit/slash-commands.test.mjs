import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")
const mentionsSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "mentions.ts"), "utf8")

describe("Slash command unification", () => {
  it("SLASH_COMMANDS must not be defined in main.ts — only LOCAL_COMMANDS in mentions.ts", () => {
    const hasSlashCommands = mainSource.includes("const SLASH_COMMANDS")
    assert.ok(!hasSlashCommands, "SLASH_COMMANDS must be removed from main.ts — all slash commands must live in mentions.ts LOCAL_COMMANDS")
  })

  it("renderSlashAutocomplete must be removed from main.ts", () => {
    const hasRender = mainSource.includes("function renderSlashAutocomplete(")
    assert.ok(!hasRender, "renderSlashAutocomplete must be removed — uses mentions system instead")
  })

  it("updateSlashAutocomplete must be removed from main.ts", () => {
    const hasUpdate = mainSource.includes("function updateSlashAutocomplete(")
    assert.ok(!hasUpdate, "updateSlashAutocomplete must be removed — uses mentions system instead")
  })

  it("LOCAL_COMMANDS in mentions.ts is the single source of truth for slash commands", () => {
    assert.ok(mentionsSource.includes("LOCAL_COMMANDS"), "LOCAL_COMMANDS must exist in mentions.ts")
    assert.ok(mentionsSource.includes('"clear"'), "must include clear command")
    assert.ok(mentionsSource.includes('"help"'), "must include help command")
  })
})
