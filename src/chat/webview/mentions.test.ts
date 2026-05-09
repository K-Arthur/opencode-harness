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

  it("includes /clear command", () => {
    assert.ok(source.includes('"clear"'))
  })

  it("includes /help command", () => {
    assert.ok(source.includes('"help"'))
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

  it("command icons use SVG constants from icons.ts, not emoji codepoints", () => {
    // LOCAL_COMMANDS should reference SVG constants imported from icons.ts
    assert.ok(source.includes("COMMAND_SVG"), "clear must use COMMAND_SVG")
    assert.ok(source.includes("BRAIN_SVG"), "model must use BRAIN_SVG")
    assert.ok(source.includes("CODE_SVG"), "help must use CODE_SVG")
    assert.ok(source.includes("import"), "must import SVG constants")
  })

  it("renders slash commands with structured command rows", () => {
    assert.ok(source.includes("command-mode"), "slash dropdown must get command-mode styling")
    assert.ok(source.includes("command-item"), "slash commands must use command-item rows")
    assert.ok(source.includes("dropdown-content"), "rows must group label and description")
    assert.ok(source.includes("aria-selected"), "keyboard selection state must be exposed")
  })
})
