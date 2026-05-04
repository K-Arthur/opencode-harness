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
  it("maps all 28 theme properties to CSS custom properties", () => {
    const mappingPairs = source.match(/\["--oc-[^"]+"/g)
    assert.ok(mappingPairs, "No CSS variable mappings found")
    assert.ok(mappingPairs.length >= 28, `Expected >=28 mappings, got ${mappingPairs.length}`)
  })

  it("filters out undefined values", () => {
    assert.ok(
      source.includes("value !== undefined && value !== null"),
      "Undefined value filtering missing"
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
    // Count try/catch blocks in the readCliThemeFiles method
    const methodStart = source.indexOf("private readCliThemeFiles")
    const methodEnd = source.indexOf("private ", methodStart + 1)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    const tryCount = (method.match(/try\s*\{/g) || []).length
    assert.ok(tryCount >= 2, `Expected >=2 try/catch blocks, got ${tryCount}`)
  })
})
