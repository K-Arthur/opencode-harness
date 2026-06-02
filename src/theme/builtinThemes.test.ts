import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BUILTIN_THEMES, builtinThemeNames, getBuiltinTheme } from "./builtinThemes"
import { contrastRatio } from "./contrast"

const HEX = /^#[0-9a-fA-F]{6}$/
const REQUIRED_PALETTE_KEYS = [
  "neutral", "ink", "primary", "accent", "success", "warning", "error", "info", "diffAdd", "diffDelete",
] as const

describe("builtinThemes — bundled OpenCode palettes", () => {
  it("ships a curated set keyed by canonical opencode names", () => {
    const names = builtinThemeNames()
    assert.ok(names.length >= 8, `expected >=8 bundled themes, got ${names.length}`)
    for (const expected of ["tokyonight", "catppuccin", "gruvbox-dark", "nord", "dracula"]) {
      assert.ok(names.includes(expected), `missing bundled theme ${expected}`)
    }
  })

  it("every theme uses the compact palette schema with all core colours as hex", () => {
    for (const [name, file] of Object.entries(BUILTIN_THEMES)) {
      const palette = file.theme.palette
      assert.ok(palette, `${name} has no palette`)
      for (const key of REQUIRED_PALETTE_KEYS) {
        assert.match(palette[key], HEX, `${name}.${key} must be 6-digit hex, got ${palette[key]}`)
      }
    }
  })

  it("syntax overrides (when present) are valid hex", () => {
    for (const [name, file] of Object.entries(BUILTIN_THEMES)) {
      for (const [k, v] of Object.entries(file.theme.overrides ?? {})) {
        assert.match(v as string, HEX, `${name}.overrides.${k} must be hex, got ${v}`)
      }
    }
  })

  it("ink-on-neutral meets WCAG AA so body text is always readable", () => {
    for (const [name, file] of Object.entries(BUILTIN_THEMES)) {
      const { ink, neutral } = file.theme.palette
      const ratio = contrastRatio(ink, neutral)
      assert.ok(ratio !== null && ratio >= 4.5, `${name}: ink ${ink} on ${neutral} = ${ratio?.toFixed(2)}:1 (< 4.5)`)
    }
  })

  it("getBuiltinTheme resolves by exact name and rejects unknown / prototype keys", () => {
    assert.ok(getBuiltinTheme("nord"))
    assert.equal(getBuiltinTheme("does-not-exist"), undefined)
    assert.equal(getBuiltinTheme("toString"), undefined)
    assert.equal(getBuiltinTheme("__proto__"), undefined)
  })
})
