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

  it("uses per-document cache for performance", () => {
    // getSymbolRange extracted to inlineLensScanner.ts; provider now uses a
    // per-document {version, lenses} cache to skip re-scanning unchanged files.
    assert.ok(source.includes("cache") && source.includes("version"), "provider must cache results by document version")
  })

  it("matches functions with regex (via inlineLensScanner)", () => {
    // funcRegex and classRegex extracted to inlineLensScanner.ts; provider delegates to scanLensTargets
    assert.ok(source.includes("scanLensTargets"), "provider must call scanLensTargets from inlineLensScanner")
  })

  it("matches classes with regex (via inlineLensScanner)", () => {
    assert.ok(source.includes("scanLensTargets"), "provider must call scanLensTargets from inlineLensScanner")
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
