import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "InlineCompletionProvider.ts"), "utf8")

describe("InlineCompletionProvider.ts", () => {
  it("exports InlineCompletionProvider class", () => {
    assert.ok(source.includes("export class InlineCompletionProvider"))
  })

  it("implements vscode.InlineCompletionItemProvider", () => {
    assert.ok(source.includes("implements vscode.InlineCompletionItemProvider"))
  })

  it("has provideInlineCompletionItems method", () => {
    assert.ok(source.includes("provideInlineCompletionItems("))
  })

  it("reads inlineSuggestions.enabled config", () => {
    assert.ok(source.includes("inlineSuggestions"))
    assert.ok(source.includes("opencode.inlineSuggestions"))
    assert.ok(source.includes('"enabled"'))
  })

  it("reads inlineSuggestions.triggerDelay config", () => {
    assert.ok(source.includes("triggerDelay"))
  })

  it("does not emit placeholder TODO completions", () => {
    assert.ok(!source.includes("TODO: implement completion"), "must not show implementation placeholders as ghost text")
    assert.ok(source.includes("return null"), "until server-backed completions exist, provider should stay silent")
  })

  it("has debounce with setTimeout pattern", () => {
    assert.ok(source.includes("setTimeout"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })
})
