/**
 * ANSI 256-colour → hex conversion.
 *
 * OpenCode CLI theme files may express colours as ANSI 256 colour indices
 * (integers 0–255) instead of hex strings — that is valid in the terminal,
 * but `ansi(5)` is NOT a valid CSS colour. Previously ThemeManager emitted
 * `ansi(${n})` for these values, which the webview silently discarded,
 * leaving the corresponding token unset (wrong/missing colours).
 *
 * This module deterministically maps an ANSI 256 index to the standard
 * xterm hex palette so the webview can render full colour:
 *   - 0–15   : the 16 base ANSI colours (standard xterm defaults)
 *   - 16–231 : the 6×6×6 colour cube
 *   - 232–255: the 24-step grayscale ramp
 *
 * Pure module — no VS Code / Node dependencies — so it is unit-testable in
 * isolation (see ansiColor.test.ts).
 */

/** Standard xterm defaults for the 16 base ANSI colours. */
const BASE_16: readonly string[] = [
  "#000000", "#800000", "#008000", "#808000",
  "#000080", "#800080", "#008080", "#c0c0c0",
  "#808080", "#ff0000", "#00ff00", "#ffff00",
  "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
]

/** Cube component levels: 0 → 0, otherwise 55 + level·40 (xterm convention). */
const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255]

function toHexByte(n: number): string {
  return n.toString(16).padStart(2, "0")
}

/**
 * Convert an ANSI 256-colour index to a `#rrggbb` hex string.
 * Returns `undefined` for out-of-range or non-integer input so callers can
 * skip the value rather than inject something invalid.
 */
export function ansiToHex(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined

  if (index < 16) {
    return BASE_16[index]
  }

  if (index < 232) {
    const n = index - 16
    const r = CUBE_LEVELS[Math.floor(n / 36)] ?? 0
    const g = CUBE_LEVELS[Math.floor((n % 36) / 6)] ?? 0
    const b = CUBE_LEVELS[n % 6] ?? 0
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
  }

  // 232–255: grayscale ramp 8, 18, 28 … 238
  const gray = 8 + (index - 232) * 10
  const hex = toHexByte(gray)
  return `#${hex}${hex}${hex}`
}
