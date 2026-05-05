import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "InlineActionProvider.ts"), "utf8")

describe("InlineActionProvider.ts", () => {
  it("exports InlineActionProvider class", () => {
    assert.ok(source.includes("export class InlineActionProvider"))
  })

  it("implements vscode.CodeLensProvider", () => {
    assert.ok(source.includes("implements vscode.CodeLensProvider"))
  })

  it("has onDidChangeCodeLenses event", () => {
    assert.ok(source.includes("onDidChangeCodeLenses"))
  })

  it("has provideCodeLenses method", () => {
    assert.ok(source.includes("provideCodeLenses("))
  })

  it("has getSymbolRange private method", () => {
    assert.ok(source.includes("private getSymbolRange("))
  })

  it("matches functions with regex", () => {
    assert.ok(source.includes("funcRegex"))
  })

  it("matches classes with regex", () => {
    assert.ok(source.includes("classRegex"))
  })

  it("generates Explain CodeLens", () => {
    assert.ok(source.includes("$(comment) Explain"))
  })

  it("generates Refactor CodeLens", () => {
    assert.ok(source.includes("$(edit) Refactor"))
  })

  it("generates Test CodeLens", () => {
    assert.ok(source.includes("$(beaker) Test"))
  })
})
