import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "mentions.ts"), "utf8")

describe("mentions.ts", () => {
  it("exports setupMentions", () => {
    assert.ok(source.includes("export function setupMentions"))
  })

  it("exports MentionState interface", () => {
    assert.ok(source.includes("export interface MentionState"))
  })

  it("defines LOCAL_COMMANDS array", () => {
    assert.ok(source.includes("LOCAL_COMMANDS"))
  })

  it("LOCAL_COMMANDS is populated from the canonical registry (slash-commands.ts)", () => {
    // Specific names live in slash-commands.ts now; mentions.ts just adapts them.
    // The slash-commands.test.ts suite asserts the canonical list contains clear,
    // help, model, etc., so we only verify the import wiring here.
    assert.match(source, /LOCAL_COMMANDS[\s\S]{0,40}toMentionItems\(SLASH_COMMAND_ICONS\)/)
  })

  it("has handleTrigger function", () => {
    assert.ok(source.includes("function handleTrigger()"))
  })

  it("has handleKeydown function", () => {
    assert.ok(source.includes("function handleKeydown"))
  })

  it("has renderResults function", () => {
    assert.ok(source.includes("function renderResults"))
  })

  it("has updateServerCommands function", () => {
    assert.ok(source.includes("function updateServerCommands"))
  })

  it("returns { handleTrigger, handleKeydown, renderResults, updateServerCommands }", () => {
    assert.ok(source.includes("handleTrigger, handleKeydown, renderResults, updateServerCommands"))
  })

  it("uses the canonical slash-commands registry for local commands", () => {
    // mentions.ts must NOT carry its own list of commands — that diverged
    // from main.ts in the past. The canonical module owns the names and
    // descriptions; this file only adapts them for the dropdown.
    assert.ok(
      source.includes('from "./slash-commands"'),
      "mentions.ts must import from slash-commands.ts (canonical registry)",
    )
    assert.ok(
      source.includes("toMentionItems(SLASH_COMMAND_ICONS)"),
      "mentions.ts must build LOCAL_COMMANDS from toMentionItems() (icons supplied webview-side)",
    )
    // Defensive: ensure the old hardcoded array literal is gone so future
    // edits don't re-introduce drift.
    assert.ok(
      !/LOCAL_COMMANDS:\s*MentionItem\[\]\s*=\s*\[\s*\{\s*prefix:/.test(source),
      "mentions.ts must not hardcode a LOCAL_COMMANDS array literal anymore",
    )
  })

  it("renders slash commands with structured command rows", () => {
    assert.ok(source.includes("command-mode"), "slash dropdown must get command-mode styling")
    assert.ok(source.includes("command-item"), "slash commands must use command-item rows")
    assert.ok(source.includes("dropdown-content"), "rows must group label and description")
    assert.ok(source.includes("aria-selected"), "keyboard selection state must be exposed")
  })

  // The old slash trigger regex was anchored to start-of-input (`^\/...$`),
  // so typing "hello /clear" mid-prompt never opened the dropdown. The
  // regex accepts a slash either at the start of input or after whitespace,
  // and its token charset includes "-" and ":" so /export-json and
  // /diagnose:generation keep the dropdown open while being typed.
  it("slash trigger matches mid-line, not only at the start of input", () => {
    assert.ok(
      source.includes("(?:^|\\s)\\/([\\w:-]*)$"),
      "trigger regex must accept slash after whitespace with -/: in the token charset",
    )
    // Defensive: the obsolete start-anchored form must not survive.
    assert.ok(
      !/match\(\/\^\\\/\\?\(\\w\*\)\$\//.test(source),
      "the old `^\\/(\\w*)$` regex must be replaced",
    )
  })

  // @file: category items used to insert "@file:file" (prefix + display
  // concatenation). The handler now honours item.insertText when present.
  it("insertMention honours item.insertText for category rows so @file: doesn't become @file:file", () => {
    const idx = source.indexOf("function insertMention(")
    assert.ok(idx > 0, "insertMention must exist")
    const block = source.slice(idx, source.indexOf("\n  }", idx + 50) + 4)
    assert.ok(
      /item\.insertText/.test(block),
      "insertMention must consult item.insertText",
    )
    assert.ok(
      /endsWith\(["']:["']\)/.test(block),
      "insertMention must skip the trailing space for ':' category prefixes so the cursor lands ready to type",
    )
  })

  // Server commands that share a name with a local one used to appear
  // twice in the dropdown (one row per source). The handler now dedupes.
  it("dedupes server commands whose names collide with local entries", () => {
    const idx = source.indexOf("function handleTrigger()")
    const block = source.slice(idx, source.indexOf("function renderCommandResults", idx))
    assert.match(
      block,
      /dedupServerCommands\(\s*serverCommands/,
      "handleTrigger must dedupe serverCommands against local names",
    )
  })

  // The dropdown filter must be fuzzy (subsequence), not startsWith. The old
  // startsWith filter hid every command the user couldn't spell from its
  // first character — so a custom "/code-review" never appeared when typing
  // "/review", making custom/MCP commands look missing.
  it("filters the slash dropdown with fuzzy matching, not startsWith", () => {
    const idx = source.indexOf("function handleTrigger()")
    const block = source.slice(idx, source.indexOf("function renderCommandResults", idx))
    assert.ok(
      /rankByFuzzy\(/.test(block),
      "handleTrigger must rank command suggestions with rankByFuzzy",
    )
    assert.ok(
      !/\.startsWith\(/.test(block),
      "the old startsWith prefix filter must be gone (it hid non-prefix commands)",
    )
    assert.ok(
      source.includes('from "./fuzzyMatch"'),
      "mentions.ts must import the shared fuzzy matcher",
    )
  })
})
