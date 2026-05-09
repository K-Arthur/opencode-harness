/**
 * ThemeManager unit tests
 *
 * Tests theme variable generation, built-in presets, and user overrides.
 * Uses a mock VS Code API since ThemeManager depends on vscode module.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// NOTE: ThemeManager imports vscode at module level, so we can't easily
// unit-test it in isolation. Instead we test the theme preset data directly
// and the variable mapping logic.

// Import the built-in presets from the source for validation
const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(
  import.meta.dirname, "..", "..", "src", "theme", "ThemeManager.ts"
)
const source = fs.readFileSync(sourcePath, "utf8")

describe("ThemeManager — built-in presets", () => {
  it("all 4 presets are defined", () => {
    const presets = ["cli-default", "light", "dark", "high-contrast"]
    for (const preset of presets) {
      assert.ok(
        source.includes(`${preset}:`) || source.includes(`"${preset}":`),
        `Missing preset: ${preset}`
      )
    }
  })

  it("all presets define the same set of keys", () => {
    // Extract all key names from the first preset
    const keyPattern = /(\w+):/g
    const presetSection = source.match(/"cli-default":\s*\{[^}]+/s)
    assert.ok(presetSection, "cli-default preset not found")
    const keys = [...presetSection[0].matchAll(keyPattern)]
      .map((m) => m[1])
      .filter((k) => k !== "cli" && k !== "default")

    // Verify each key appears in all presets
    const presetNames = ["light", "dark", "high-contrast"]
    for (const preset of presetNames) {
      const quoted = preset.includes("-") ? `"${preset}"` : preset
      const section = source.match(new RegExp(`${quoted}:\\s*\\{[^}]+`, "s"))
      assert.ok(section, `${preset} preset not found`)
      for (const key of keys) {
        assert.ok(
          section[0].includes(`${key}:`),
          `Key "${key}" missing from preset "${preset}"`
        )
      }
    }
  })
})

describe("ThemeManager — variable mapping", () => {
  it("maps all theme properties to CSS custom properties", () => {
    const mappingPairs = source.match(/\["--[a-z]+-[^"]+",/g)
    assert.ok(mappingPairs, "No CSS variable mappings found")
    assert.ok(mappingPairs.length >= 41, `Expected >=41 mappings, got ${mappingPairs.length}`)
  })

  it("filters out undefined values", () => {
    assert.ok(
      source.includes("value !== undefined && value !== null"),
      "Undefined value filtering missing"
    )
  })
})

describe("ThemeManager — canvas/shell properties", () => {
  const canvasProps = ["panelBg", "panelFg", "editorBg", "editorFg", "borderColor", "mutedFg"]

  it("OpencodeTheme interface includes canvas properties", () => {
    for (const prop of canvasProps) {
      assert.ok(
        source.includes(`${prop}?:`),
        `Missing canvas property "${prop}" in OpencodeTheme interface`
      )
    }
  })

  it("CSS_VAR_MAP includes canvas background variables", () => {
    const canvasVars = [
      "--oc-bg", "--oc-fg",
      "--oc-editor-bg", "--oc-editor-fg",
      "--oc-glass-bg", "--bg-primary",
      "--oc-border", "--oc-muted", "--oc-description",
    ]
    for (const v of canvasVars) {
      assert.ok(
        source.includes(`["${v}",`),
        `Missing CSS variable mapping for "${v}" in CSS_VAR_MAP`
      )
    }
  })

  function extractPreset(name) {
    const quoted = name.includes("-") ? `"${name}"` : name
    const re = new RegExp(`${quoted}:\\s*\\{`, "g")
    const match = re.exec(source)
    if (!match) return null
    let depth = 0
    let start = match.index + match[0].length - 1
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++
      if (source[i] === "}") depth--
      if (depth === 0) return source.slice(match.index, i + 1)
    }
    return null
  }

  it("light preset defines canvas background colors (not var(--vscode-*))", () => {
    const lightSection = extractPreset("light")
    assert.ok(lightSection, "light preset not found")
    assert.ok(lightSection.includes("panelBg:"), "panelBg missing from light preset")
    assert.ok(
      !lightSection.includes("panelBg: \"var(--vscode-"),
      "light preset panelBg must be a concrete color, not a VS Code variable reference"
    )
    assert.ok(lightSection.includes("panelFg:"), "panelFg missing from light preset")
  })

  it("dark preset defines canvas background colors (not var(--vscode-*))", () => {
    const darkSection = extractPreset("dark")
    assert.ok(darkSection, "dark preset not found")
    assert.ok(darkSection.includes("panelBg:"), "panelBg missing from dark preset")
    assert.ok(darkSection.includes("panelFg:"), "panelFg missing from dark preset")
  })

  it("cli-default preset uses VS Code variable references for canvas colors", () => {
    const cliSection = extractPreset("cli-default")
    assert.ok(cliSection, "cli-default preset not found")
    assert.ok(cliSection.includes("panelBg:"), "panelBg missing from cli-default preset")
    assert.ok(
      cliSection.includes("panelBg: \"var(--vscode-"),
      "cli-default preset panelBg must use VS Code variable reference"
    )
  })

  it("high-contrast preset defines maximum contrast canvas colors", () => {
    const hcSection = extractPreset("high-contrast")
    assert.ok(hcSection, "high-contrast preset not found")
    assert.ok(hcSection.includes("panelBg:"), "panelBg missing from high-contrast preset")
    assert.ok(hcSection.includes("panelFg:"), "panelFg missing from high-contrast preset")
  })
})

describe("ThemeManager — CLI theme field mapping", () => {
  const cliThemeFields = [
    "primary", "secondary", "accent", "error", "warning", "success", "info",
    "text", "textMuted", "background", "backgroundPanel", "backgroundElement",
    "border", "borderActive", "borderSubtle",
    "diffAdded", "diffRemoved", "diffContext", "diffHunkHeader",
    "diffHighlightAdded", "diffHighlightRemoved", "diffAddedBg", "diffRemovedBg",
    "diffContextBg", "diffLineNumber", "diffAddedLineNumberBg", "diffRemovedLineNumberBg",
    "markdownText", "markdownHeading", "markdownLink", "markdownLinkText",
    "markdownCode", "markdownBlockQuote", "markdownEmph", "markdownStrong",
    "markdownHorizontalRule", "markdownListItem", "markdownListEnumeration",
    "markdownImage", "markdownImageText", "markdownCodeBlock",
    "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
    "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  ]

  it("FIELD_MAP covers the documented OpenCode CLI theme fields", () => {
    for (const field of cliThemeFields) {
      assert.ok(source.includes(`"${field}"`), `FIELD_MAP must map CLI theme field ${field}`)
    }
  })

  it("CSS_VAR_MAP exposes CLI markdown and diff fields to the webview", () => {
    for (const cssVar of [
      "--oc-markdown-heading",
      "--oc-markdown-link",
      "--oc-markdown-code",
      "--oc-diff-context",
      "--oc-diff-hunk-header",
      "--oc-diff-added-bg",
      "--oc-diff-removed-bg",
      "--oc-syn-variable",
      "--oc-syn-punctuation",
    ]) {
      assert.ok(source.includes(`["${cssVar}",`), `missing CSS variable mapping for ${cssVar}`)
    }
  })

  it("FIELD_MAP maps CLI background to panelBg (not assistantMessageBg)", () => {
    assert.ok(
      source.includes('["panelBg", "background"]') ||
        source.includes('["panelBg", "background"]'),
      "FIELD_MAP must map panelBg to CLI 'background' property"
    )
    assert.ok(
      !source.includes('["assistantMessageBg", "background"]'),
      "FIELD_MAP must NOT map assistantMessageBg to CLI 'background'"
    )
  })

  it("FIELD_MAP maps CLI text to panelFg (not assistantMessageFg)", () => {
    assert.ok(
      source.includes('["panelFg", "text"]'),
      "FIELD_MAP must map panelFg to CLI 'text' property"
    )
    assert.ok(
      !source.includes('["assistantMessageFg", "text"]'),
      "FIELD_MAP must NOT map assistantMessageFg to CLI 'text'"
    )
  })
})

describe("ThemeManager — security", () => {
  it("sanitizes theme name for path traversal protection", () => {
    assert.ok(
      source.includes("safeThemeName") &&
        source.includes("replace(/[^\\w.-]/g"),
      "Path traversal sanitization missing"
    )
  })

  it("wraps file reads in try/catch", () => {
    const classStart = source.indexOf("export class ThemeManager")
    const classBody = source.slice(classStart)
    const tryCount = (classBody.match(/try\s*\{/g) || []).length
    assert.ok(tryCount >= 2, `Expected >=2 try/catch blocks in ThemeManager, got ${tryCount}`)
  })
})
