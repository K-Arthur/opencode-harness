import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  LOCAL_SLASH_COMMANDS,
  toMentionItems,
  toCommandEntries,
  dedupServerCommands,
  resolveLocalCommand,
  buildHelpTable,
  classifyComposerInput,
} from "./slash-commands"

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
      "export", "export-json", "export-text", "copy",
      "stash", "stashes", "compact", "commands", "queue", "continue",
      "diagnose:generation",
    ]
    for (const name of expected) {
      assert.ok(
        LOCAL_SLASH_COMMANDS.find((c) => c.name === name),
        `LOCAL_SLASH_COMMANDS must contain "${name}"`,
      )
    }
  })

  it("export-md survives as an alias of /export, not a duplicate entry", () => {
    // Two near-identical registry rows ("Export conversation (Markdown)" vs
    // "as Markdown") confused users browsing the palette. One command, one row.
    assert.equal(LOCAL_SLASH_COMMANDS.filter((c) => c.name === "export-md").length, 0)
    const exportCmd = LOCAL_SLASH_COMMANDS.find((c) => c.name === "export")
    assert.ok(exportCmd?.aliases?.includes("export-md"))
  })

  it("every entry declares a category for palette grouping", () => {
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      assert.ok(cmd.category, `entry "${cmd.name}" missing category`)
    }
  })

  it("commands that take arguments declare a usage hint", () => {
    for (const name of ["model", "stash"]) {
      const cmd = LOCAL_SLASH_COMMANDS.find((c) => c.name === name)
      assert.ok(cmd?.usage, `"${name}" expects arguments and must declare usage`)
    }
  })

  it("includes /methodology so the per-tab guidance override is discoverable", () => {
    // The per-tab methodologyDisabled opt-out existed in StreamCoordinator but
    // nothing ever set it — the override was unreachable from the UI.
    const cmd = LOCAL_SLASH_COMMANDS.find((c) => c.name === "methodology")
    assert.ok(cmd, "registry must contain methodology")
    assert.ok(cmd!.usage?.includes("on"), "usage must document the on|off argument")
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

  it("also removes server commands that collide with a local alias", () => {
    const server = [{ name: "export-md", description: "server export-md" }]
    assert.equal(dedupServerCommands(server).length, 0)
  })

  it("supports a custom name getter for callers whose items use `display`", () => {
    // mentions.ts items carry `display`, not `name` — it used to reimplement
    // this dedup inline, which is exactly how the two copies drifted.
    const server = [
      { display: "clear", description: "dupe" },
      { display: "deploy", description: "keep" },
    ]
    const out = dedupServerCommands(server, (c) => c.display)
    assert.deepEqual(out.map((c) => c.display), ["deploy"])
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

describe("resolveLocalCommand", () => {
  it("resolves a canonical name to its entry", () => {
    assert.equal(resolveLocalCommand("export")?.name, "export")
  })

  it("resolves an alias to the canonical entry", () => {
    assert.equal(resolveLocalCommand("export-md")?.name, "export")
  })

  it("is case-insensitive and tolerates a leading slash", () => {
    assert.equal(resolveLocalCommand("EXPORT-MD")?.name, "export")
    assert.equal(resolveLocalCommand("/clear")?.name, "clear")
  })

  it("returns undefined for unknown commands", () => {
    assert.equal(resolveLocalCommand("deploy"), undefined)
  })
})

describe("buildHelpTable", () => {
  // /help used to hardcode its own markdown table in ChatCommands.ts. It
  // listed /diagnose:generation (absent from the registry) and omitted
  // /export-md (present in the registry) — generated output cannot drift.
  it("contains one row for every registry entry", () => {
    const table = buildHelpTable()
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      assert.ok(table.includes(`\`/${cmd.name}`), `help table missing /${cmd.name}`)
      assert.ok(table.includes(cmd.description), `help table missing description for /${cmd.name}`)
    }
  })

  it("shows usage hints inside the command cell", () => {
    const table = buildHelpTable()
    assert.ok(table.includes("`/stash <name> <content>`"))
    assert.ok(table.includes("`/model <id>`"))
  })

  it("mentions aliases so /export-md stays discoverable", () => {
    assert.ok(buildHelpTable().includes("export-md"))
  })

  it("is a valid markdown table (header + separator + rows)", () => {
    const lines = buildHelpTable().split("\n")
    assert.ok(lines[0]!.startsWith("| Command |"))
    assert.ok(/^\|\s*-+/.test(lines[1]!))
    assert.equal(lines.length, 2 + LOCAL_SLASH_COMMANDS.length)
  })
})

describe("classifyComposerInput", () => {
  // sendMessage() used to route ALL non-empty input to sendSteerPrompt()
  // while streaming — before the slash check ran. Typing /clear mid-stream
  // sent the literal string "/clear" to the model as steering text.
  it("classifies plain text while idle as a prompt", () => {
    assert.equal(classifyComposerInput("fix the login bug", false), "prompt")
  })

  it("classifies command-shaped text while idle as a slash command", () => {
    assert.equal(classifyComposerInput("/clear", false), "slash")
    assert.equal(classifyComposerInput("/model gpt-5", false), "slash")
  })

  it("classifies plain text while streaming as steering", () => {
    assert.equal(classifyComposerInput("focus on the tests", true), "steer")
  })

  it("blocks command-shaped text while streaming — never steer-leak a command", () => {
    assert.equal(classifyComposerInput("/clear", true), "slash-blocked")
    assert.equal(classifyComposerInput("/deploy prod", true), "slash-blocked")
  })

  it("classifies empty input by stream state (abort vs empty)", () => {
    assert.equal(classifyComposerInput("", true), "abort")
    assert.equal(classifyComposerInput("   ", true), "abort")
    assert.equal(classifyComposerInput("", false), "empty")
  })

  it("a lone or space-separated slash is steer text, not a command (escape hatch)", () => {
    assert.equal(classifyComposerInput("/ literal slash steer", true), "steer")
  })
})
