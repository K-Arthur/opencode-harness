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
})
