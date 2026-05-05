import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "ChatFileOps.ts"), "utf8")

void describe("ChatFileOps.ts", () => {
  void it("exports ChatFileOps class", () => {
    assert.ok(source.includes("export class ChatFileOps"), "ChatFileOps class must be exported")
  })

  void it("has insertAtCursor method", () => {
    assert.ok(source.includes("async insertAtCursor("), "must have insertAtCursor method")
    assert.ok(source.includes("vscode.window.activeTextEditor"), "must check for active editor")
    assert.ok(source.includes("No active editor"), "must warn when no editor")
    assert.ok(source.includes("editBuilder.replace("), "must replace selection with code")
  })

  void it("has createFromCode method that saves to file and opens editor", () => {
    assert.ok(source.includes("async createFromCode("), "must have createFromCode method")
    assert.ok(source.includes("vscode.window.showSaveDialog("), "must show save dialog")
    assert.ok(source.includes("vscode.workspace.fs.writeFile("), "must write file")
    assert.ok(source.includes("vscode.window.showTextDocument("), "must open document")
  })

  void it("has static extensionForLanguage with common mappings", () => {
    assert.ok(source.includes("static extensionForLanguage("), "must have extensionForLanguage method")
    assert.ok(source.includes('javascript: ".js"'), "must map javascript → .js")
    assert.ok(source.includes('typescript: ".ts"'), "must map typescript → .ts")
    assert.ok(source.includes('python: ".py"'), "must map python → .py")
    assert.ok(source.includes('rust: ".rs"'), "must map rust → .rs")
    assert.ok(source.includes('go: ".go"'), "must map go → .go")
    assert.ok(source.includes('bash: ".sh"'), "must map bash → .sh")
    assert.ok(source.includes('json: ".json"'), "must map json → .json")
    assert.ok(source.includes('css: ".css"'), "must map css → .css")
    assert.ok(source.includes('html: ".html"'), "must map html → .html")
    assert.ok(source.includes('markdown: ".md"'), "must map markdown → .md")
  })

  void it("extensionForLanguage falls back to raw language for unknown types", () => {
    assert.ok(source.includes("language?.toLowerCase"), "must normalize language input")
    assert.ok(source.includes("|| `.${language || \"txt\"}`"), "must fallback with dot prefix")
  })
})
