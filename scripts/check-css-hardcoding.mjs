#!/usr/bin/env node
/**
 * CSS Hardcoding Detector
 *
 * Scans CSS files for hardcoded colors (#hex, rgb(), rgba(), hsl()) and
 * pixel values (Npx) that appear OUTSIDE of var() fallback positions and
 * outside of known-acceptable contexts (shadows, terminal dots, high-contrast
 * overrides, media queries, etc.).
 *
 * The goal is to catch values that should be using design tokens but aren't.
 *
 * Usage:
 *   node scripts/check-css-hardcoding.mjs [--dir <css-dir>] [--format <text|json>]
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — violations found
 *   2 — script error
 */

import { readdirSync, readFileSync, statSync } from "fs"
import { join, relative, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Patterns ────────────────────────────────────────────────────────────

// Hardcoded hex colors: #abc, #aabbcc, #aabbccdd (but not inside var() fallback)
const HEX_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

// Hardcoded rgba/rgb colors
const RGBA_COLOR = /rgba?\(\s*\d+/g

// Hardcoded hsl colors
const HSL_COLOR = /hsla?\(\s*\d+/g

// Hardcoded pixel values (Npx) — but not inside var() fallback
const PX_VALUE = /\b(\d+)px\b/g

// ─── Exclusion contexts ──────────────────────────────────────────────────

// Lines that are acceptable hardcoded contexts:
const ACCEPTABLE_CONTEXTS = [
  // var() fallbacks: var(--token, #hex) or var(--token, rgba(...))
  /var\(/,
  // Shadow definitions: 0 2px 8px rgba(0,0,0,0.12)
  /--shadow/,
  /box-shadow\s*:/,
  /text-shadow\s*:/,
  // Terminal traffic-light dots (decorative macOS window controls)
  /\.theme-preset-card__dot/,
  /\.theme-preset-card__dot--/,
  // High contrast mode overrides (intentionally hardcoded)
  /\.vscode-high-contrast\b/,
  /\.vscode-high-contrast-light\b/,
  // forced-colors media query
  /forced-colors/,
  // Media query / container query breakpoints
  /@media/,
  /@container/,
  // Comments
  /^\s*\/\//,
  /^\s*\*/,
  /^\s*\*\//,
  /^\s*\/\*/,
  // color-mix() expressions (these use hex as base, not as a direct value)
  /color-mix\(/,
  // Z-index values (not colors)
  /z-index/,
  // border-radius: 50% or 9999px (standard for circles)
  /border-radius\s*:\s*(?:50%|9999px)/,
  // outline-offset, outline width
  /outline(?:-offset)?\s*:\s*\d+px/,
  // min-width / min-height for touch targets (44px is accessibility standard)
  /min-(?:width|height)\s*:\s*(?:44|48)px/,
  // SVG width/height attributes in HTML
  /width="\d+"/,
  /height="\d+"/,
  // CSS custom property definitions (--token-name: value)
  // These ARE the design tokens, not hardcoded consumers
  /^\s*--[\w-]+\s*:/,
  // clamp() / min() / max() / calc() expressions (responsive by nature)
  /clamp\(/,
  /min\(/,
  /max\(/,
  /calc\(/,
  // transition / animation timing (ms/s, not px)
  /transition\s*:/,
  /animation\s*:/,
  // Grid template columns (structural, not design tokens)
  /grid-template/,
  // flex-grow / flex-shrink values
  /flex\s*:\s*\d/,
]

// Specific hex values that are always acceptable (decorative, structural)
const ACCEPTABLE_HEX = new Set([
  "#000",      // used in backdrop color-mix
  "#fff",      // white text in high-contrast
  "#ffffff",   // white
  "#000000",   // black
])

// Specific px values that are always acceptable (accessibility, structural)
const ACCEPTABLE_PX = new Set([
  "1px",   // standard border width
  "2px",   // standard outline width
  "44px",  // WCAG touch target
  "48px",  // WCAG touch target
])

// ─── Core logic ──────────────────────────────────────────────────────────

/**
 * Check if a line is in an acceptable hardcoded context.
 */
function isAcceptableContext(line) {
  return ACCEPTABLE_CONTEXTS.some((re) => re.test(line))
}

/**
 * Extract hardcoded hex colors from a line, excluding acceptable contexts.
 */
function findHardcodedHex(line) {
  const violations = []
  const trimmed = line.trim()

  // Skip acceptable contexts
  if (isAcceptableContext(line)) return violations

  let match
  HEX_COLOR.lastIndex = 0
  while ((match = HEX_COLOR.exec(line)) !== null) {
    const hex = match[0]
    if (!ACCEPTABLE_HEX.has(hex.toLowerCase())) {
      violations.push({
        type: "hex-color",
        value: hex,
        snippet: trimmed,
      })
    }
  }

  return violations
}

/**
 * Extract hardcoded rgba/rgb colors from a line, excluding acceptable contexts.
 */
function findHardcodedRgba(line) {
  const violations = []
  const trimmed = line.trim()

  if (isAcceptableContext(line)) return violations

  let match
  RGBA_COLOR.lastIndex = 0
  while ((match = RGBA_COLOR.exec(line)) !== null) {
    // Extract the full rgba(...) expression
    const start = match.index
    const end = line.indexOf(")", start)
    const fullExpr = end > -1 ? line.slice(start, end + 1) : match[0]
    violations.push({
      type: "rgba-color",
      value: fullExpr,
      snippet: trimmed,
    })
  }

  return violations
}

/**
 * Extract hardcoded hsl colors from a line, excluding acceptable contexts.
 */
function findHardcodedHsl(line) {
  const violations = []
  const trimmed = line.trim()

  if (isAcceptableContext(line)) return violations

  let match
  HSL_COLOR.lastIndex = 0
  while ((match = HSL_COLOR.exec(line)) !== null) {
    const start = match.index
    const end = line.indexOf(")", start)
    const fullExpr = end > -1 ? line.slice(start, end + 1) : match[0]
    violations.push({
      type: "hsl-color",
      value: fullExpr,
      snippet: trimmed,
    })
  }

  return violations
}

// Properties where hardcoded px should use spacing tokens
const LAYOUT_PX_PROPERTIES = [
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
]

/**
 * Check if a line contains a px value in a layout property context.
 */
function isLayoutPxContext(line) {
  const trimmed = line.trim()
  // Check if this line sets a layout property
  for (const prop of LAYOUT_PX_PROPERTIES) {
    if (new RegExp(`^${prop}\\s*:`).test(trimmed)) {
      return true
    }
  }
  // Also catch shorthand like "padding: 6px 8px"
  for (const prop of ["padding", "margin"]) {
    if (new RegExp(`^${prop}\\s*:`).test(trimmed)) {
      return true
    }
  }
  return false
}

/**
 * Extract hardcoded pixel values from a line, excluding acceptable contexts.
 * Only flags px values in layout properties (padding, margin, gap, width, height).
 */
function findHardcodedPx(line) {
  const violations = []
  const trimmed = line.trim()

  if (isAcceptableContext(line)) return violations
  if (!isLayoutPxContext(line)) return violations

  let match
  PX_VALUE.lastIndex = 0
  while ((match = PX_VALUE.exec(line)) !== null) {
    const px = match[0]
    if (!ACCEPTABLE_PX.has(px)) {
      violations.push({
        type: "px-value",
        value: px,
        snippet: trimmed,
      })
    }
  }

  return violations
}

/**
 * Scan a single CSS file for hardcoded values.
 */
function scanCssFile(filePath) {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const violations = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    const hexViolations = findHardcodedHex(line)
    const rgbaViolations = findHardcodedRgba(line)
    const hslViolations = findHardcodedHsl(line)
    const pxViolations = findHardcodedPx(line)

    for (const v of [...hexViolations, ...rgbaViolations, ...hslViolations, ...pxViolations]) {
      violations.push({
        file: filePath,
        line: lineNum,
        ...v,
      })
    }
  }

  return violations
}

/**
 * Recursively find all .css files in a directory.
 */
function findCssFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...findCssFiles(fullPath))
    } else if (entry.endsWith(".css")) {
      results.push(fullPath)
    }
  }
  return results
}

// ─── Main ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const dirArg = args[args.indexOf("--dir") + 1]
  const formatArg = args[args.indexOf("--format") + 1]

  const cssDir = dirArg || join(__dirname, "..", "src", "chat", "webview", "css")
  const format = formatArg || "text"

  const cssFiles = findCssFiles(cssDir)
  if (cssFiles.length === 0) {
    console.error(`No CSS files found in ${cssDir}`)
    process.exit(2)
  }

  const allViolations = []
  for (const file of cssFiles) {
    allViolations.push(...scanCssFile(file))
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify({ violations: allViolations, count: allViolations.length }, null, 2) + "\n")
  } else {
    if (allViolations.length === 0) {
      console.log(`✓ No hardcoded values found in ${cssFiles.length} CSS files`)
    } else {
      console.log(`✗ Found ${allViolations.length} hardcoded value(s) in ${cssFiles.length} CSS files:\n`)
      const grouped = new Map()
      for (const v of allViolations) {
        const key = v.file
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(v)
      }
      for (const [file, violations] of grouped) {
        const relPath = relative(join(__dirname, ".."), file)
        console.log(`  ${relPath}:`)
        for (const v of violations) {
          console.log(`    L${v.line}  [${v.type}]  ${v.value}`)
          console.log(`           ${v.snippet}`)
        }
        console.log()
      }
    }
  }

  const exitCode = allViolations.length === 0 ? 0 : 1
  process.exitCode = exitCode
}

main()
