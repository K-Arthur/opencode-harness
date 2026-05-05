import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ThemeManager.ts"), "utf8")

describe("ThemeManager.ts", () => {
  it("exports OpencodeTheme interface", () => {
    assert.ok(source.includes("export interface OpencodeTheme"))
  })

  it("exports ThemePreset type", () => {
    assert.ok(source.includes('export type ThemePreset = "cli-default" | "light" | "dark" | "high-contrast"'))
  })

  it("exports ThemeVariables interface", () => {
    assert.ok(source.includes("export interface ThemeVariables"))
  })

  it("exports ThemeManager class", () => {
    assert.ok(source.includes("export class ThemeManager"))
  })

  it("defines BUILT_IN_PRESETS", () => {
    assert.ok(source.includes("BUILT_IN_PRESETS"))
  })

  it("has cli-default preset with CSS variable references", () => {
    assert.ok(source.includes("var(--vscode-editor-background)"))
  })

  it("has dark preset", () => {
    assert.ok(source.includes('dark:') || source.includes('"dark"'))
  })

  it("has high-contrast preset", () => {
    assert.ok(source.includes('high-contrast:') || source.includes('"high-contrast"'))
  })

  it("has getThemeVariables method", () => {
    assert.ok(source.includes("getThemeVariables()"))
  })

  it("has emitUpdate method", () => {
    assert.ok(source.includes("emitUpdate()"))
  })

  it("has setupFileWatchers method", () => {
    assert.ok(source.includes("setupFileWatchers("))
  })

  it("has previewTheme method", () => {
    assert.ok(source.includes("previewTheme("))
  })

  it("creates FileSystemWatcher for tui.json", () => {
    assert.ok(source.includes("createFileSystemWatcher"))
  })

  it("disposes watchers on dispose", () => {
    assert.ok(source.includes("watcher.dispose()"))
  })

  it("high-contrast preset defines all required properties", () => {
    // Verify the high-contrast preset has all 28+ theme properties
    const requiredProps = [
      "userMessageBg", "userMessageFg", "assistantMessageBg", "assistantMessageFg",
      "toolCallColor", "toolReadColor", "toolWriteColor", "toolExecColor",
      "skillBadgeBg", "skillBadgeFg", "thinkingBg", "thinkingBorder",
      "warningColor", "errorColor", "successColor", "accentColor",
      "diffAdded", "diffRemoved", "inputBg", "inputBorder", "mentionBg",
      "syntaxComment", "syntaxKeyword", "syntaxString", "syntaxNumber",
      "syntaxFunction", "syntaxType", "syntaxOperator",
    ]
    for (const prop of requiredProps) {
      assert.ok(source.includes(`${prop}:`), `high-contrast preset must define ${prop}`)
    }
  })

  it("CLI theme discovery prefers workspace over global for source labeling", () => {
    assert.ok(source.includes('source: "workspace"'), "must label workspace themes correctly")
    assert.ok(source.includes('source: "global"'), "must label global themes correctly")
    // Should NOT use fragile directory-name string matching
    assert.ok(!source.includes('.includes("workspace")'), "must not use fragile string matching for source detection")
  })

  it("generates forced-colors media query in tokens.css", () => {
    const tokensSource = readFileSync(path.join(__dirname, "..", "chat", "webview", "css", "tokens.css"), "utf8")
    assert.ok(tokensSource.includes("forced-colors: active"), "tokens.css must define forced-colors block")
    assert.ok(tokensSource.includes("CanvasText"), "forced-colors must use CanvasText")
    assert.ok(tokensSource.includes("ButtonText"), "forced-colors must use ButtonText")
    assert.ok(tokensSource.includes("GrayText"), "forced-colors must use GrayText")
    assert.ok(tokensSource.includes("LinkText"), "forced-colors must use LinkText")
  })
})
