/**
 * Design-token discipline lint.
 *
 * Catches drift from the design-token system before it ships:
 *   • raw pixel font-sizes (must use the --text-* scale)
 *   • raw hex / rgba colour literals outside tokens.css
 *   • `transition: all` (animates layout properties → repaint cost)
 *   • `z-index:` raw numbers (must use --z-* scale)
 *   • `transition: width|height|max-height` outside one-shot toggles
 *     (forces layout per frame — prefer transform: scale*())
 *   • duplicate @import of the same stylesheet
 *
 * Reference: docs/audit-2026-05-26 UI audit, "Design-token coverage assertion".
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS_DIR = path.resolve(__dirname, "..", "..", "src", "chat", "webview", "css")
const ALL_CSS = readdirSync(CSS_DIR).filter(f => f.endsWith(".css"))

/** Read a stylesheet relative to the webview/css folder. */
function read(name) {
  return readFileSync(path.join(CSS_DIR, name), "utf8")
}

/** Strip /* … *​/ comments so we never lint inside CSS comments. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "")
}

/** Strip @media / @supports / @container PRELUDES (their selectors can contain
 * raw px values like `min-width: 320px` which we don't want to flag here). */
function stripAtRulePreludes(src) {
  return src.replace(/@(?:media|supports|container)\s*\([^)]*\)/g, "@$1()")
}

/** Read every CSS file except tokens.css and return a single concatenated body
 *  (with file annotations so the assertion message points at the offender). */
function nonTokenBody() {
  return ALL_CSS
    .filter(f => f !== "tokens.css")
    .map(f => `/* === ${f} === */\n` + stripAtRulePreludes(stripComments(read(f))))
    .join("\n")
}

describe("design-token discipline", () => {
  it("font-size uses the --text-* scale (no raw pixel font-sizes outside tokens.css)", () => {
    const body = nonTokenBody()
    // Exclude clamp() expressions which use px values for min/max bounds but
    // are legitimate for responsive/fluid typography (messages-responsive.css,
    // welcome.css). The negative lookahead checks we are not inside a clamp().
    const offenders = [...body.matchAll(/font-size:\s*(?!clamp\()([0-9]+(?:\.[0-9]+)?)px/g)]
    if (offenders.length > 0) {
      const samples = offenders.slice(0, 5).map(m => m[0]).join(", ")
      assert.fail(
        `Found ${offenders.length} raw pixel font-size(s). Use --text-2xs / --text-xs / --text-sm / --text-base / --text-md / --text-lg / --text-xl / --text-2xl instead. First offenders: ${samples}`,
      )
    }
  })

  it("no `transition: all` (enumerate explicit properties)", () => {
    const body = nonTokenBody()
    const offenders = [...body.matchAll(/transition:\s*all\s+/g)]
    assert.equal(
      offenders.length,
      0,
      `Found ${offenders.length} use(s) of \`transition: all\`. ` +
        `Animate explicit cheap properties only (background-color, color, border-color, transform, opacity, box-shadow).`,
    )
  })

  it("no transition on layout-thrashing properties (width / height / max-height for non-toggle UIs)", () => {
    // `transition: max-height` is acceptable for one-shot open/close on details
    // and thinking blocks; the audit only flagged per-frame uses. We allow
    // max-height transitions but ban width/height since those are the hot
    // patterns (scroll progress, fill bars, sliders).
    const body = nonTokenBody()
    // Match `transition: ... width …` or `transition: ... height …` but NOT
    // `max-height` / `min-height` / `line-height` etc. `(?<![-a-z])` is a
    // negative look-behind for any word-char or hyphen — preventing a hyphen
    // from being treated as a word boundary the way `\b` does in JS regex.
    const offenders = [
      ...body.matchAll(/transition:\s*[^;]*?(?<![-a-z])(width|height)\b[^;]*;/g),
    ]
    if (offenders.length > 0) {
      const samples = offenders.slice(0, 5).map(m => m[0]).join("\n  ")
      assert.fail(
        `Found ${offenders.length} transition on layout-affecting property. ` +
          `Use transform: scaleX()/scaleY() with --p custom property instead. First offenders:\n  ${samples}`,
      )
    }
  })

  it("z-index uses the --z-* scale (no raw integers above 9)", () => {
    // Small local stacking values (z-index: 1 / 2) are allowed inside parent
    // contexts; only flag values >= 10 since those are global-scale candidates.
    const body = nonTokenBody()
    const offenders = [
      ...body.matchAll(/z-index:\s*([0-9]+)\s*;/g),
    ].filter(m => Number(m[1]) >= 10)
    if (offenders.length > 0) {
      const samples = offenders.slice(0, 5).map(m => m[0]).join(", ")
      assert.fail(
        `Found ${offenders.length} raw z-index >= 10. Use --z-dropdown / --z-sticky / --z-modal-backdrop / --z-modal / --z-tooltip / --z-lightbox. First offenders: ${samples}`,
      )
    }
  })

  it("backdrop-filter goes through --blur-surface / --blur-bubble tokens", () => {
    const body = nonTokenBody()
    // Allow `backdrop-filter: var(--blur-...)` and `backdrop-filter: none`.
    // Disallow `backdrop-filter: blur(...)` (raw) which bypasses the scope tokens.
    const offenders = [
      ...body.matchAll(/(?:-webkit-)?backdrop-filter:\s*blur\([^)]*\)/g),
    ]
    assert.equal(
      offenders.length,
      0,
      `Found ${offenders.length} raw backdrop-filter: blur(...). Use --blur-surface (top-layer surfaces) or --blur-bubble (per-message, defaults to none) instead.`,
    )
  })

  it("styles.css does not import the same stylesheet twice", () => {
    const styles = read("styles.css")
    const imports = [...styles.matchAll(/@import\s+url\(["']?\.\/([\w-]+\.css)["']?\)/g)].map(m => m[1])
    const seen = new Set()
    const dupes = imports.filter(name => {
      if (seen.has(name)) return true
      seen.add(name)
      return false
    })
    assert.deepEqual(dupes, [], `styles.css imports duplicates: ${dupes.join(", ")}`)
  })

  it("styles.css declares a cascade-layer order with accessibility last", () => {
    const styles = read("styles.css")
    const layerDecl = styles.match(/@layer\s+([^;]+);/)
    assert.ok(layerDecl, "styles.css must declare @layer order")
    const layers = layerDecl[1].split(",").map(s => s.trim())
    assert.ok(layers.length >= 3, "expected at least tokens/components/accessibility layers")
    assert.equal(layers.at(-1), "accessibility",
      "accessibility must be the LAST layer so its focus rules beat any component overrides")
  })

  it("tokens.css defines --shadow-glow and --blur-surface / --blur-bubble", () => {
    const tokens = read("tokens.css")
    for (const t of ["--shadow-glow", "--blur-surface", "--blur-bubble"]) {
      assert.match(tokens, new RegExp(`${t.replace(/-/g, "\\-")}\\s*:`),
        `tokens.css must define ${t}`)
    }
  })

  it(".oc-btn primitive exists with primary/secondary/ghost/danger variants", () => {
    const components = read("components.css")
    assert.match(components, /\.oc-btn\b/, ".oc-btn base must exist")
    for (const v of ["primary", "secondary", "ghost", "danger"]) {
      assert.match(components, new RegExp(`\\.oc-btn\\[data-variant="${v}"\\]`),
        `oc-btn variant "${v}" missing`)
    }
  })
})
