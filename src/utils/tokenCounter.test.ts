import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "tokenCounter.ts"), "utf8")

describe("tokenCounter.ts", () => {
  it("exports estimateTokens function", () => {
    assert.ok(source.includes("export function estimateTokens("))
  })

  it("exports parseModelRef function", () => {
    assert.ok(source.includes("export function parseModelRef("))
  })

  it("exports estimateContextTokens function", () => {
    assert.ok(source.includes("export function estimateContextTokens("))
  })

  it("estimateTokens returns ceil(text.length / 4)", () => {
    assert.ok(source.includes("Math.ceil(text.length / 4)"))
  })

  it("estimateTokens returns 0 for empty input", () => {
    assert.ok(source.includes("if (!text) return 0"))
  })

  it("parseModelRef splits on slash", () => {
    assert.ok(source.includes("model.indexOf(\"/\")"))
    assert.ok(source.includes('providerID: ""'))
  })

  it("estimateContextTokens processes openFiles", () => {
    assert.ok(source.includes("for (const file of pkg.openFiles)"))
  })

  it("estimateContextTokens handles terminalOutput", () => {
    assert.ok(source.includes("pkg.terminalOutput"))
  })
})
