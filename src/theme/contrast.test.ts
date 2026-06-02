import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { contrastRatio, relativeLuminance, parseHex, meetsAA, AA_NORMAL, AA_LARGE } from "./contrast"

describe("contrast — luminance & ratio math", () => {
  it("parses 3- and 6-digit hex", () => {
    assert.deepEqual(parseHex("#fff"), [255, 255, 255])
    assert.deepEqual(parseHex("#000000"), [0, 0, 0])
    assert.deepEqual(parseHex("#1e1e2e"), [30, 30, 46])
    assert.equal(parseHex("transparent"), null)
    assert.equal(parseHex("var(--x)"), null)
    assert.equal(parseHex("rgba(0,0,0,1)"), null)
  })

  it("computes luminance extremes", () => {
    assert.equal(relativeLuminance([0, 0, 0]), 0)
    assert.equal(relativeLuminance([255, 255, 255]), 1)
  })

  it("black-on-white is the maximal 21:1 ratio", () => {
    const ratio = contrastRatio("#000000", "#ffffff")
    assert.ok(ratio !== null && Math.abs(ratio - 21) < 0.01, `expected ~21, got ${ratio}`)
  })

  it("is symmetric", () => {
    assert.equal(contrastRatio("#123456", "#abcdef"), contrastRatio("#abcdef", "#123456"))
  })

  it("returns null when a colour is not plain hex", () => {
    assert.equal(contrastRatio("var(--vscode-foreground)", "#000000"), null)
    assert.equal(contrastRatio("#000000", "transparent"), null)
  })

  it("meetsAA enforces 4.5 normal / 3.0 large", () => {
    assert.equal(AA_NORMAL, 4.5)
    assert.equal(AA_LARGE, 3.0)
    assert.equal(meetsAA("#767676", "#ffffff"), true) // ~4.54:1
    assert.equal(meetsAA("#808080", "#ffffff"), false) // ~3.95:1 (fails normal)
    assert.equal(meetsAA("#808080", "#ffffff", true), true) // passes large
  })
})

/* ──────────────────────────────────────────────────────────────────────────
 * Preset contrast-lint: the concrete (fully-hex) built-in presets must meet
 * WCAG AA. This guards future palette edits from regressing accessibility.
 * cli-default / high-contrast are skipped here — they resolve against live
 * VS Code variables and are validated by VS Code's own theme contract.
 * ────────────────────────────────────────────────────────────────────────── */

const SRC = readFileSync(path.join(__dirname, "ThemeManager.ts"), "utf8")

function extractPreset(name: string): Record<string, string> {
  const quoted = name.includes("-") ? `"${name}"` : name
  const re = new RegExp(`${quoted}:\\s*\\{`, "g")
  const match = re.exec(SRC)
  if (!match) throw new Error(`preset ${name} not found`)
  let depth = 0
  let start = match.index + match[0].length - 1
  let body = ""
  for (let i = start; i < SRC.length; i++) {
    body += SRC[i]
    if (SRC[i] === "{") depth++
    if (SRC[i] === "}") {
      depth--
      if (depth === 0) break
    }
  }
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    if (m[1] && m[2]) out[m[1]] = m[2]
  }
  return out
}

// fg key, bg key, large?  — pairs that render text/affordances on a surface.
const TEXT_PAIRS: ReadonlyArray<[string, string, boolean]> = [
  ["panelFg", "panelBg", false],
  ["editorFg", "editorBg", false],
  ["userMessageFg", "userMessageBg", false],
  ["assistantMessageFg", "panelBg", false],
  ["mutedFg", "panelBg", false],
  ["markdownText", "editorBg", false],
  ["markdownHeading", "editorBg", false],
  ["markdownLink", "editorBg", false],
  ["skillBadgeFg", "skillBadgeBg", false],
  ["errorColor", "panelBg", false],
  ["successColor", "panelBg", false],
  ["warningColor", "panelBg", false],
  ["infoColor", "panelBg", false],
]

for (const preset of ["light", "dark", "high-contrast-dark", "high-contrast-light"]) {
  describe(`preset "${preset}" meets WCAG AA`, () => {
    const colors = extractPreset(preset)
    for (const [fgKey, bgKey, large] of TEXT_PAIRS) {
      const fg = colors[fgKey]
      const bg = colors[bgKey]
      it(`${fgKey} on ${bgKey}`, () => {
        const ratio = contrastRatio(fg ?? "", bg ?? "")
        if (ratio === null) return // non-hex (e.g. transparent/rgba) — not statically checkable
        const min = large ? AA_LARGE : AA_NORMAL
        assert.ok(
          ratio >= min,
          `${preset}: ${fgKey} (${fg}) on ${bgKey} (${bg}) = ${ratio.toFixed(2)}:1, need ≥ ${min}:1`
        )
      })
    }
  })
}
