import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "PromptManager.ts"), "utf8")

describe("PromptManager.ts", () => {
  it("exports PromptManager class", () => {
    assert.ok(source.includes("export class PromptManager"), "must export PromptManager class")
    assert.ok(source.includes("implements vscode.Disposable"), "must implement vscode.Disposable")
  })

  it("exports CustomPrompt interface", () => {
    assert.ok(source.includes("export interface CustomPrompt"), "must export CustomPrompt interface")
  })

  it("exports PromptCommand interface", () => {
    assert.ok(source.includes("export interface PromptCommand"), "must export PromptCommand interface")
    assert.ok(source.includes("isCustom: boolean"), "PromptCommand must have isCustom flag")
  })

  it("has scanWorkspace method", () => {
    assert.ok(source.includes("scanWorkspace(): void"), "must have scanWorkspace method")
    assert.ok(source.includes(".opencode"), "scanWorkspace must look for .opencode directory")
    assert.ok(source.includes("prompts"), "scanWorkspace must look for prompts directory")
  })

  it("scans opencode prompts directory", () => {
    assert.ok(source.includes("readdirSync("), "must read directory contents")
    assert.ok(source.includes('endsWith(".md")'), "must filter .md files")
    assert.ok(source.includes("readFileSync("), "must read file contents")
  })

  it("parses prompt name from filename", () => {
    assert.ok(source.includes('file.replace(/\\.md$/, "")'), "must strip .md extension for name")
  })

  it("has getPrompts method", () => {
    assert.ok(source.includes("getPrompts(): CustomPrompt[]"), "must have getPrompts method")
  })

  it("has getPromptCommands method", () => {
    assert.ok(source.includes("getPromptCommands(): PromptCommand[]"), "must have getPromptCommands method")
  })

  it("has getPrompt method", () => {
    assert.ok(source.includes("getPrompt(name: string): CustomPrompt | undefined"), "must have getPrompt method")
  })

  it("has resolvePrompt method", () => {
    assert.ok(source.includes("resolvePrompt(name: string, variables: Record<string, string>): string | null"), "must have resolvePrompt method")
  })

  it("substitutes variables in prompt content", () => {
    assert.ok(source.includes("for (const [key, value] of Object.entries(variables))"), "must iterate variables")
    assert.ok(source.includes("new RegExp("), "must use RegExp for variable substitution")
    assert.ok(source.includes("resolved = resolved.replace"), "must replace variable placeholders")
    assert.ok(source.includes('"g"'), "must replace all occurrences globally")
  })

  it("supports selection, file, language, clipboard variables", () => {
    // Variable collection is in ChatProvider or CommandExecutionService (extracted)
    const chatProviderSource = readFileSync(resolve(__dirname, "..", "chat", "ChatProvider.ts"), "utf8")
    const commandExecSource = readFileSync(resolve(__dirname, "..", "chat", "CommandExecutionService.ts"), "utf8")
    assert.ok(chatProviderSource.includes("selection:") || commandExecSource.includes("selection:"), "must collect selection variable")
    assert.ok(chatProviderSource.includes("file:") || commandExecSource.includes("file:"), "must collect file variable")
    assert.ok(chatProviderSource.includes("language:") || commandExecSource.includes("language:"), "must collect language variable")
    assert.ok(chatProviderSource.includes("clipboard") || commandExecSource.includes("clipboard"), "must collect clipboard variable")
  })

  it("has watchPrompts method", () => {
    assert.ok(source.includes("watchPrompts(): void"), "must have watchPrompts method")
  })

  it("watches prompt files for changes", () => {
    assert.ok(source.includes("createFileSystemWatcher"), "must create file system watcher")
    assert.ok(source.includes("onDidCreate"), "must watch for file creation")
    assert.ok(source.includes("onDidChange"), "must watch for file changes")
    assert.ok(source.includes("onDidDelete"), "must watch for file deletion")
    assert.ok(source.includes("*.md"), "must watch for .md files")
  })

  it("has onChanged callback mechanism", () => {
    assert.ok(source.includes("onChanged(callback: () => void)"), "must have onChanged method")
  })

  it("disposes watchers properly", () => {
    assert.ok(source.includes("disposeWatchers()"), "must have disposeWatchers method")
    assert.ok(source.includes("watcher.dispose()") || source.includes("w.dispose()"), "must dispose watchers")
  })

  it("escapes regex special characters in variable names", () => {
    assert.ok(source.includes("escapeRegex("), "must have escapeRegex method")
    assert.ok(source.includes(".replace(/[.*+?^${}()|[\\]\\\\]/g"), "must escape regex special chars")
  })

  it("handles missing .opencode/prompts directory gracefully", () => {
    assert.ok(source.includes("existsSync("), "must check if directory exists")
    assert.ok(source.includes("!fs.existsSync"), "must skip non-existent directories")
  })

  it("extracts description from first heading or first line", () => {
    assert.ok(source.includes("extractDescription("), "must have extractDescription method")
    assert.ok(source.includes("firstLine.startsWith"), "must check for heading prefix")
    assert.ok(source.includes(".replace(/^#+\\s*/, \"\")"), "must strip # heading markers")
  })
})
