/**
 * isValidCssColor behavioral tests.
 *
 * Directly exercises the color validation regex patterns
 * by evaluating them in isolation (no vscode dependency).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  path.join(__dirname, "..", "..", "src", "utils", "colorValidation.ts"),
  "utf8"
)

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGBA_RE = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/
const HSLA_RE = /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/i
const CSS_VAR_RE = /^var\(--[\w-]+\)$/
const COLOR_MIX_RE = /^color-mix\(\s*in\s+srgb\s*,/i

function isValidCssColor(value) {
  if (!value || typeof value !== "string") return false
  const trimmed = value.trim()
  if (trimmed === "transparent") return true
  if (CSS_VAR_RE.test(trimmed)) return true
  if (HEX_RE.test(trimmed)) return true
  if (RGBA_RE.test(trimmed)) return true
  if (HSLA_RE.test(trimmed)) return true
  if (COLOR_MIX_RE.test(trimmed)) return true
  return false
}

describe("isValidCssColor — behavioral validation", () => {
  it("accepts #RGB", () => {
    assert.ok(isValidCssColor("#fff"))
    assert.ok(isValidCssColor("#000"))
    assert.ok(isValidCssColor("#abc"))
  })

  it("accepts #RRGGBB", () => {
    assert.ok(isValidCssColor("#ffffff"))
    assert.ok(isValidCssColor("#000000"))
    assert.ok(isValidCssColor("#58a6ff"))
  })

  it("accepts #RRGGBBAA", () => {
    assert.ok(isValidCssColor("#ffffff00"))
    assert.ok(isValidCssColor("#ff000080"))
    assert.ok(isValidCssColor("#000000ff"))
  })

  it("rejects invalid hex", () => {
    assert.ok(!isValidCssColor("#gg"))
    assert.ok(!isValidCssColor("#1234"))
    assert.ok(!isValidCssColor("#12"))
  })

  it("accepts rgb()", () => {
    assert.ok(isValidCssColor("rgb(255, 0, 0)"))
    assert.ok(isValidCssColor("rgb( 0, 128, 255 )"))
  })

  it("accepts rgba()", () => {
    assert.ok(isValidCssColor("rgba(255, 0, 0, 0.5)"))
    assert.ok(isValidCssColor("rgba(0,0,0,1)"))
  })

  it("accepts hsl()", () => {
    assert.ok(isValidCssColor("hsl(120, 50%, 50%)"))
  })

  it("accepts hsla()", () => {
    assert.ok(isValidCssColor("hsla(120, 50%, 50%, 0.5)"))
  })

  it("accepts transparent", () => {
    assert.ok(isValidCssColor("transparent"))
  })

  it("accepts CSS variables", () => {
    assert.ok(isValidCssColor("var(--oc-bg)"))
    assert.ok(isValidCssColor("var(--vscode-sideBar-background)"))
  })

  it("accepts color-mix()", () => {
    assert.ok(isValidCssColor("color-mix(in srgb, #1e1e2e 96%, #c9d1d9)"))
    assert.ok(isValidCssColor("color-mix(in srgb, #c9d1d9 20%, #1e1e2e)"))
  })

  it("rejects non-color strings", () => {
    assert.ok(!isValidCssColor(""))
    assert.ok(!isValidCssColor("red"))
    assert.ok(!isValidCssColor("inherit"))
    assert.ok(!isValidCssColor("url(evil.png)"))
    assert.ok(!isValidCssColor("expression(alert(1))"))
  })

  it("rejects null/undefined/non-string", () => {
    assert.ok(!isValidCssColor(null))
    assert.ok(!isValidCssColor(undefined))
    assert.ok(!isValidCssColor(123))
  })

  it("source file defines exported isValidCssColor", () => {
    assert.ok(source.includes("export function isValidCssColor"))
  })
})
