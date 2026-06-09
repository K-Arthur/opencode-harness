import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { LOCAL_SLASH_COMMANDS, toMentionItems, toCommandEntries, dedupServerCommands } from "./slash-commands"

// This module is the single source of truth for all local (webview-resolved)
// slash commands. Two old registries (mentions.ts LOCAL_COMMANDS and
// main.ts LOCAL_COMMAND_ENTRIES) had drifted out of sync: different entries,
// different descriptions. This module unifies them.

describe("slash-commands canonical registry", () => {
  it("contains every command the webview actually handles in sendMessage", () => {
    // Every command in the sendMessage switch must have a registry entry,
    // otherwise the modal/dropdown surface won't list it.
    const expected = [
      "clear", "model", "cost", "new", "help",
      "export", "export-md", "export-json", "export-text", "copy",
      "stash", "stashes", "compact", "commands", "queue", "continue",
    ]
    for (const name of expected) {
      assert.ok(
        LOCAL_SLASH_COMMANDS.find((c) => c.name === name),
        `LOCAL_SLASH_COMMANDS must contain "${name}"`,
      )
    }
  })

  it("each entry has name, description, and either insertText (runnable) or argsHint (templated)", () => {
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      assert.ok(cmd.name, `entry missing name`)
      assert.ok(cmd.description, `entry "${cmd.name}" missing description`)
      // insertText is what gets put into the prompt input; cmd.insertText
      // ending with " " means it expects arguments and shouldn't auto-send.
      assert.ok(cmd.insertText, `entry "${cmd.name}" missing insertText`)
      assert.equal(cmd.insertText[0], "/", `entry "${cmd.name}" insertText must start with /`)
    }
  })

  it("descriptions are non-trivial (no placeholders) — they ship to end users", () => {
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      assert.ok(cmd.description.length >= 5, `description for "${cmd.name}" is too short to be useful`)
      assert.ok(!/^TODO|^FIXME/i.test(cmd.description), `description for "${cmd.name}" is a placeholder`)
    }
  })

  it("the same description appears in both adapter outputs (mention + modal)", () => {
    // Symptom of the old drift: mentions.ts and main.ts described /commands
    // and /continue differently. The adapters must produce consistent text.
    const items = toMentionItems()
    const entries = toCommandEntries()
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      const item = items.find((i) => i.display === cmd.name)
      const entry = entries.find((e) => e.name === cmd.name)
      assert.ok(item, `mention item missing for ${cmd.name}`)
      assert.ok(entry, `command entry missing for ${cmd.name}`)
      assert.equal(item!.description, entry!.description, `description drift for ${cmd.name}`)
      assert.equal(item!.description, cmd.description)
    }
  })
})

describe("dedupServerCommands", () => {
  it("removes server commands whose names collide with local ones", () => {
    const server = [
      { name: "clear", description: "server clear" },
      { name: "deploy", description: "deploy something" },
      { name: "help", description: "server help" },
    ]
    const out = dedupServerCommands(server)
    assert.deepEqual(out.map((c) => c.name), ["deploy"])
  })

  it("preserves order and passes through additional fields", () => {
    const server = [
      { name: "a", description: "first", template: "tpl-a" },
      { name: "b", description: "second" },
      { name: "c", description: "third", template: "tpl-c" },
    ]
    const out = dedupServerCommands(server)
    assert.deepEqual(out, server)
  })

  it("matches names case-insensitively to defend against server casing drift", () => {
    const server = [{ name: "CLEAR", description: "shouty clear" }]
    assert.equal(dedupServerCommands(server).length, 0)
  })

  it("does not mutate the input array", () => {
    const server = [{ name: "clear", description: "x" }, { name: "deploy", description: "y" }]
    const before = JSON.stringify(server)
    dedupServerCommands(server)
    assert.equal(JSON.stringify(server), before)
  })
})

describe("toMentionItems / toCommandEntries", () => {
  it("toMentionItems yields one item per registry entry with prefix '/'", () => {
    const items = toMentionItems()
    assert.equal(items.length, LOCAL_SLASH_COMMANDS.length)
    for (const item of items) {
      assert.equal(item.prefix, "/")
      assert.ok(item.display)
    }
  })

  it("toCommandEntries yields one entry per registry entry with source 'local'", () => {
    const entries = toCommandEntries()
    assert.equal(entries.length, LOCAL_SLASH_COMMANDS.length)
    for (const entry of entries) {
      assert.equal(entry.source, "local")
      assert.ok(entry.insertText)
    }
  })
})
