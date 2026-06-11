import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webviewDir = path.join(__dirname, "..", "..", "src", "chat", "webview")
const mainSource = readFileSync(path.join(webviewDir, "main.ts"), "utf8")
const mentionsSource = readFileSync(path.join(webviewDir, "mentions.ts"), "utf8")
const slashCommandsSource = readFileSync(path.join(webviewDir, "slash-commands.ts"), "utf8")

describe("Slash command unification", () => {
  it("SLASH_COMMANDS must not be defined in main.ts — only the canonical registry is allowed", () => {
    const hasSlashCommands = mainSource.includes("const SLASH_COMMANDS")
    assert.ok(!hasSlashCommands, "SLASH_COMMANDS must be removed from main.ts")
  })

  it("renderSlashAutocomplete must be removed from main.ts", () => {
    const hasRender = mainSource.includes("function renderSlashAutocomplete(")
    assert.ok(!hasRender, "renderSlashAutocomplete must be removed — uses mentions system instead")
  })

  it("updateSlashAutocomplete must be removed from main.ts", () => {
    const hasUpdate = mainSource.includes("function updateSlashAutocomplete(")
    assert.ok(!hasUpdate, "updateSlashAutocomplete must be removed — uses mentions system instead")
  })

  it("slash-commands.ts is the canonical source of truth (used by both modal and dropdown)", () => {
    // Canonical registry exports the master list
    assert.ok(
      /export\s+const\s+LOCAL_SLASH_COMMANDS/.test(slashCommandsSource),
      "slash-commands.ts must export LOCAL_SLASH_COMMANDS",
    )
    // Both adapters live here too
    assert.ok(
      /export\s+function\s+toMentionItems/.test(slashCommandsSource),
      "slash-commands.ts must export toMentionItems()",
    )
    assert.ok(
      /export\s+function\s+toCommandEntries/.test(slashCommandsSource),
      "slash-commands.ts must export toCommandEntries()",
    )

    // mentions.ts consumes the adapter, doesn't redefine
    assert.ok(
      mentionsSource.includes('from "./slash-commands"'),
      "mentions.ts must import from ./slash-commands",
    )
    // The icons map argument is webview-only — the registry itself must stay
    // icon-free so /help generation doesn't pull SVGs into dist/extension.js.
    assert.ok(
      mentionsSource.includes("toMentionItems("),
      "mentions.ts must use toMentionItems() rather than carrying its own list",
    )

    // main.ts consumes the adapter
    assert.ok(
      mainSource.includes('from "./slash-commands"'),
      "main.ts must import from ./slash-commands",
    )
    assert.ok(
      mainSource.includes("toCommandEntries()"),
      "main.ts must use toCommandEntries() rather than carrying its own list",
    )
  })

  it("server commands are deduped against local entries", () => {
    assert.ok(
      /export\s+function\s+dedupServerCommands/.test(slashCommandsSource),
      "must export dedupServerCommands",
    )
  })
})
