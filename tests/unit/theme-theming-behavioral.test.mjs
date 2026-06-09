/**
 * Theme theming behavioral tests (TDD).
 *
 * Validates color validation, preset completeness, XDG path helpers,
 * CLI theme dedup, and theme file resolution.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THEME_MANAGER_SRC = readFileSync(
  path.join(__dirname, "..", "..", "src", "theme", "ThemeManager.ts"),
  "utf8"
)
const COLOR_VALIDATION_SRC = readFileSync(
  path.join(__dirname, "..", "..", "src", "utils", "colorValidation.ts"),
  "utf8"
)
const THEME_CONTROLLER_SRC = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "ThemeController.ts"),
  "utf8"
)
const THEME_CUSTOMIZER_SRC = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "webview", "ui", "themeCustomizer.ts"),
  "utf8"
)

function extractPreset(source, name) {
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

function extractKeys(section) {
  if (!section) return []
  return [...section.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
}

describe("Issue #1+#2+#12 — Unified color validation (isValidCssColor)", () => {
  const regexPatterns = COLOR_VALIDATION_SRC

  it("accepts 3-digit hex (#RGB)", () => {
    assert.ok(
      COLOR_VALIDATION_SRC.includes("[0-9a-fA-F]{3}"),
      "must include 3-digit hex pattern"
    )
  })

  it("accepts 6-digit hex (#RRGGBB)", () => {
    assert.ok(regexPatterns.includes("[0-9a-fA-F]{6}"), "must include 6-digit hex pattern")
  })

  it("accepts 8-digit hex (#RRGGBBAA)", () => {
    assert.ok(regexPatterns.includes("[0-9a-fA-F]{8}"), "must include 8-digit hex pattern")
  })

  it("accepts rgba format", () => {
    assert.ok(regexPatterns.includes("rgba?"), "must include rgba? pattern")
  })

  it("accepts hsla format", () => {
    assert.ok(regexPatterns.includes("hsla?") || regexPatterns.includes("hsla"), "must include hsla pattern")
  })

  it("accepts CSS variable references var(--*)", () => {
    assert.ok(regexPatterns.includes("var(") || regexPatterns.includes("var\\("), "must include var() pattern")
  })

  it("accepts transparent keyword", () => {
    assert.ok(regexPatterns.includes("transparent"), "must include transparent")
  })

  it("accepts color-mix() values", () => {
    assert.ok(regexPatterns.includes("color-mix"), "must include color-mix pattern")
  })

  it("ThemeController imports shared isValidCssColor (not inline)", () => {
    assert.ok(
      THEME_CONTROLLER_SRC.includes('from "../utils/colorValidation"'),
      "ThemeController must import from shared colorValidation module"
    )
    assert.ok(
      THEME_CONTROLLER_SRC.includes("isValidCssColor"),
      "ThemeController must use isValidCssColor"
    )
    assert.ok(
      !THEME_CONTROLLER_SRC.includes("function isValidColorValue"),
      "ThemeController must NOT define inline isValidColorValue"
    )
  })

  it("webview themeCustomizer also accepts color-mix", () => {
    assert.ok(
      THEME_CUSTOMIZER_SRC.includes("color-mix"),
      "themeCustomizer must accept color-mix() values"
    )
  })
})

describe("Issue #3 — readActiveThemeName fallback", () => {
  it("falls back to empty string (not tokyonight)", () => {
    assert.ok(
      THEME_MANAGER_SRC.includes('let activeTheme = ""') ||
        THEME_MANAGER_SRC.includes("let activeTheme = ''"),
      "readActiveThemeName must default to empty string, not tokyonight"
    )
    assert.ok(
      !THEME_MANAGER_SRC.includes('"tokyonight"'),
      "Must not hardcode tokyonight as fallback"
    )
  })

  it("readThemeFileOverrides skips when activeTheme is empty", () => {
    assert.ok(
      THEME_MANAGER_SRC.includes("if (!activeTheme) return overrides"),
      "readThemeFileOverrides must early-return for empty theme name"
    )
  })
})

describe("Issue #4 — previewTheme reads CLI theme file on pick", () => {
  it("uses readThemeFileOverrides when a CLI theme file is picked", () => {
    const start = THEME_MANAGER_SRC.indexOf("async previewTheme()")
    const methodEnd = THEME_MANAGER_SRC.indexOf("}\n\n  discoverCliThemes()", start)
    assert.ok(start >= 0, "previewTheme method must exist")
    assert.ok(methodEnd >= 0, "previewTheme closing brace must be found")
    const body = THEME_MANAGER_SRC.slice(start, methodEnd)
    assert.ok(
      body.includes("readThemeFileOverrides"),
      "previewTheme must call readThemeFileOverrides when themeFile is picked"
    )
    assert.ok(
      body.includes("path.dirname(picked.themeFile)"),
      "previewTheme must pass the picked file's directory"
    )
    assert.ok(
      body.includes("path.basename(picked.themeFile"),
      "previewTheme must derive theme name from picked file"
    )
  })
})

describe("Issue #11 — XDG path helper centralization", () => {
  it("defines getXdgConfigDir module-level helper", () => {
    assert.ok(
      THEME_MANAGER_SRC.includes("function getXdgConfigDir()"),
      "Must define getXdgConfigDir helper function"
    )
  })

  it("defines getHomeDir module-level helper", () => {
    assert.ok(
      THEME_MANAGER_SRC.includes("function getHomeDir()"),
      "Must define getHomeDir helper function"
    )
  })

  it("does not repeat XDG_CONFIG_HOME computation inline in methods", () => {
    const xdgOccurrences = (THEME_MANAGER_SRC.match(/process\.env\.XDG_CONFIG_HOME/g) || []).length
    assert.ok(
      xdgOccurrences <= 2,
      `XDG_CONFIG_HOME should only be referenced in helpers, found ${xdgOccurrences} occurrences`
    )
  })
})

describe("Issue #14 — Preset property completeness", () => {
  const requiredKeys = [
    "panelBg", "panelFg", "editorBg", "editorFg", "elementBg",
    "borderColor", "borderActive", "borderSubtle", "mutedFg",
    "userMessageBg", "userMessageFg", "assistantMessageBg", "assistantMessageFg",
    "toolCallColor", "toolReadColor", "toolWriteColor", "toolExecColor",
    "skillBadgeBg", "skillBadgeFg", "thinkingBg", "thinkingBorder",
    "warningColor", "errorColor", "successColor", "infoColor",
    "primaryColor", "accentColor",
    "diffAdded", "diffRemoved", "diffContext", "diffHunkHeader",
    "diffAddedBg", "diffRemovedBg", "diffLineNumber",
    "inputBg", "inputBorder", "mentionBg",
    "markdownText", "markdownHeading", "markdownLink", "markdownCode",
    "markdownBlockQuote", "markdownStrong", "markdownListItem",
    "syntaxComment", "syntaxKeyword", "syntaxString", "syntaxNumber",
    "syntaxFunction", "syntaxVariable", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  ]

  for (const preset of ["light", "dark", "high-contrast-dark", "high-contrast-light"]) {
    describe(`${preset} preset defines all required properties`, () => {
      const section = extractPreset(THEME_MANAGER_SRC, preset)
      assert.ok(section, `${preset} preset must exist`)

      for (const key of requiredKeys) {
        it(`defines ${key}`, () => {
          assert.ok(
            section.includes(`${key}:`),
            `${preset} must define ${key}`
          )
        })
      }
    })
  }
})

describe("Issue #15 — CLI theme deduplication", () => {
  it("discoverCliThemes canonicalizes paths to skip duplicates", () => {
    assert.ok(
      THEME_MANAGER_SRC.includes("realpathSync"),
      "discoverCliThemes must use realpathSync for path canonicalization"
    )
    assert.ok(
      THEME_MANAGER_SRC.includes("seenPaths"),
      "discoverCliThemes must track seen paths for deduplication"
    )
  })
})
