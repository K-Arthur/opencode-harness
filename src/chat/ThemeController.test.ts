import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ThemeController.ts"), "utf8")

void describe("ThemeController.ts", () => {
  void it("exports ThemeController class", () => {
    assert.ok(source.includes("export class ThemeController"))
  })

  void it("constructor accepts themeManager and postMessage callback", () => {
    assert.ok(source.includes("private readonly themeManager: ThemeManager"))
    assert.ok(source.includes("private readonly postMessage"))
  })

  void it("pushThemeToWebview posts theme_vars with custom vars", () => {
    assert.ok(source.includes('type: "theme_vars"'))
    assert.ok(source.includes("getThemeVariables()"))
  })

  void it("pushThemeConfigToWebview posts theme_config with getThemeConfig", () => {
    assert.ok(source.includes('type: "theme_config"'))
    assert.ok(source.includes("getThemeConfig()"))
  })

  void it("getThemeConfig reads from workspace configuration", () => {
    assert.ok(source.includes('getConfiguration("opencode")'))
    assert.ok(source.includes('"theme"'))
  })

  void it("handleUpdateThemeConfig writes then emits and pushes", () => {
    assert.ok(source.includes("emitUpdate()"))
    assert.ok(source.includes("pushThemeToWebview()"))
    assert.ok(source.includes("pushThemeConfigToWebview()"))
  })

  void it("isValidThemeConfigPayload rejects null, arrays, oversized keys", () => {
    assert.ok(source.includes("typeof theme !== \"object\""))
    assert.ok(source.includes("Array.isArray(theme)"))
    assert.ok(source.includes("key.length > 64"))
    assert.ok(source.includes("value.length > 200"))
  })

  void it("normalizeThemeConfig validates preset and overrides", () => {
    assert.ok(source.includes("validPresets"))
    assert.ok(source.includes("\"cli-default\""))
    assert.ok(source.includes("\"light\""))
    assert.ok(source.includes("\"dark\""))
    assert.ok(source.includes("\"high-contrast\""))
    assert.ok(source.includes("overrides[key] = value.trim()"))
  })
})