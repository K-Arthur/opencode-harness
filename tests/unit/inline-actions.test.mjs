import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "..", "..", "src", "extension.ts"), "utf8")

describe("T1.6 — Inline action handlers factor", () => {
  it("has buildInlinePrompt factory function", () => {
    assert.ok(source.includes("function buildInlinePrompt("), "must have buildInlinePrompt function")
    assert.ok(source.includes(".replace(\"{path}\""), "buildInlinePrompt must replace {path}")
    assert.ok(source.includes(".replace(\"{code}\""), "buildInlinePrompt must replace {code}")
  })

  it("has createInlineCommand factory function", () => {
    assert.ok(source.includes("function createInlineCommand("), "must have createInlineCommand function")
  })

  it("uses Object.entries + factory instead of inline for-of loop with Record", () => {
    assert.ok(source.includes("Object.entries(inlinePrompts)"), "must iterate with Object.entries")
    assert.ok(!source.includes('const prompts: Record<string, string> = {'), "must not have inline prompts Record")
  })

  it("creates one command registration per action via factory", () => {
    assert.ok(source.includes('vscode.commands.registerCommand(`opencode-harness.${action}`, createInlineCommand(action, template, chatProvider))'), "must register via factory")
  })

  it("extracts verb outside try-catch for catch accessibility", () => {
    assert.ok(source.includes("const verb = action.replace(\"Code\", \"\").toLowerCase()"), "must extract verb before try block")
  })
})
