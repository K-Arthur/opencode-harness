/**
 * WCAG 2.1 relative-luminance & contrast-ratio helpers.
 *
 * Pure module (no VS Code / DOM dependencies) so the built-in presets can be
 * lint-tested for accessibility without booting the extension host. Used by
 * the preset contrast-lint test to guarantee our shipped themes meet
 * WCAG AA (4.5:1 for normal text, 3:1 for large text / UI affordances).
 *
 * Only `#rgb` / `#rrggbb` hex inputs are computable here — `var(--vscode-*)`,
 * `rgba()`, `color-mix()` and `transparent` resolve at render time against the
 * live VS Code theme and are intentionally out of scope (returns null).
 */

export type Rgb = readonly [number, number, number]

/** WCAG AA thresholds. */
export const AA_NORMAL = 4.5
export const AA_LARGE = 3.0

export function parseHex(color: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim())
  if (!m || !m[1]) return null
  let hex = m[1]
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("")
  }
  const int = parseInt(hex, 16)
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

function linearize(channel8bit: number): number {
  const c = channel8bit / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of an sRGB colour (0 = black, 1 = white). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])
}

/**
 * Contrast ratio between two hex colours (1..21), or null when either colour
 * is not a plain hex value (and therefore not statically computable).
 */
export function contrastRatio(a: string, b: string): number | null {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return null
  const la = relativeLuminance(ra)
  const lb = relativeLuminance(rb)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** True when fg/bg meet the WCAG AA threshold for the given text size. */
export function meetsAA(fg: string, bg: string, large = false): boolean {
  const ratio = contrastRatio(fg, bg)
  if (ratio === null) return false
  return ratio >= (large ? AA_LARGE : AA_NORMAL)
}
