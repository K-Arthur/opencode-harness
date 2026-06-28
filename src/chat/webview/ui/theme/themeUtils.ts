/**
 * Pure utility functions for the theme customizer modal.
 *
 * All functions in this module are side-effect free and have no DOM or VS Code
 * dependencies, making them trivially testable in isolation. They are the
 * foundation layer for the theme customizer's color manipulation, validation,
 * and token resolution logic.
 */

import { isValidCssColor } from "../../../../utils/colorValidation"
import { contrastRatio } from "../../../../theme/contrast"

/**
 * Normalise a hex color string to 6-digit lowercase form.
 *
 * Accepts 3-digit (#fff) and 6-digit (#ffffff) hex strings. Returns the input
 * unchanged if it is not a plain hex value (e.g. `var(--x)`, `transparent`,
 * `rgba(...)` — these are valid CSS but not normalisable to hex).
 *
 * @param hex - The hex string to normalise.
 * @returns The 6-digit lowercase hex string, or the original string if not hex.
 */
export function normaliseHex(hex: string): string {
  const trimmed = hex.trim()
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed)
  if (!m || !m[1]) return trimmed
  let digits = m[1]
  if (digits.length === 3) {
    digits = digits.split("").map((c) => c + c).join("")
  }
  return `#${digits.toLowerCase()}`
}

/**
 * Convert a hex color string to an `rgba()` string with the given alpha.
 *
 * @param hex - A 3- or 6-digit hex string (e.g. `#fff` or `#1e1e2e`).
 * @param alpha - The alpha channel value (0–1). Defaults to 1 (opaque).
 * @returns An `rgba(r, g, b, a)` string, or the original input if not hex.
 */
export function hexToRgba(hex: string, alpha = 1): string {
  const normalised = normaliseHex(hex)
  const m = /^#([0-9a-f]{6})$/.exec(normalised)
  if (!m || !m[1]) return hex
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 0xff
  const g = (int >> 8) & 0xff
  const b = int & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Compute the WCAG contrast ratio between two color strings.
 *
 * Delegates to the shared `contrastRatio` helper from `src/theme/contrast.ts`.
 * Returns `null` when either color is not a plain hex value (e.g. `var(--x)`,
 * `transparent`) and therefore not statically computable.
 *
 * @param fg - The foreground color (hex string).
 * @param bg - The background color (hex string).
 * @returns The contrast ratio (1–21), or `null` if not computable.
 */
export function computeContrastRatio(fg: string, bg: string): number | null {
  return contrastRatio(fg, bg)
}

/**
 * Resolve a CSS custom property name to its current computed hex value.
 *
 * Creates a temporary hidden element, sets its `background-color` to the CSS
 * variable, reads the computed value, and converts it back to hex. This is
 * necessary because `<input type="color">` only accepts hex values — when the
 * user has a `var(--vscode-*)` override, we need to show the resolved color in
 * the picker.
 *
 * @param varName - The CSS variable name (e.g. `--oc-accent`).
 * @returns The resolved hex string (e.g. `#0078d4`), or `undefined` if the
 *   variable cannot be resolved or the environment has no DOM.
 */
export function resolveThemeToken(varName: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const temp = document.createElement("div")
  temp.style.position = "absolute"
  temp.style.visibility = "hidden"
  temp.style.width = "1px"
  temp.style.height = "1px"
  temp.style.backgroundColor = `var(${varName})`
  document.body.appendChild(temp)
  const rgb = getComputedStyle(temp).backgroundColor
  document.body.removeChild(temp)
  return rgbToHex(rgb)
}

/**
 * Convert an `rgb()` or `rgba()` computed-style string to a hex string.
 *
 * @param rgb - The computed style string (e.g. `rgb(30, 30, 46)`).
 * @returns The hex string (e.g. `#1e1e2e`), or `undefined` if the input does
 *   not match the expected format.
 */
export function rgbToHex(rgb: string): string | undefined {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!match) return undefined
  const parts = [match[1], match[2], match[3]]
  const hex = parts.map((n) => {
    const h = Number(n).toString(16)
    return h.length === 1 ? `0${h}` : h
  })
  return `#${hex.join("")}`
}

/**
 * Create a debounced version of a function that delays invocation until after
 * `wait` milliseconds have elapsed since the last call.
 *
 * @param fn - The function to debounce.
 * @param wait - The debounce delay in milliseconds.
 * @returns A debounced function with a `cancel()` method.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  wait: number,
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = ((...args: never[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }) as T & { cancel: () => void }
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  return debounced
}

/**
 * Validate that a string is a valid CSS color value.
 *
 * Delegates to the shared `isValidCssColor` from `src/utils/colorValidation.ts`
 * to avoid duplicating the regex patterns. Accepts hex (3/6/8 digit), `rgba()`,
 * `hsla()`, `var(--*)`, `transparent`, and `color-mix()`.
 *
 * @param value - The string to validate.
 * @returns `true` if the value is a valid CSS color, `false` otherwise.
 */
export function isValidColorFormat(value: string): boolean {
  return isValidCssColor(value)
}

/**
 * Check whether a color string is a plain hex value that can be used in a
 * native `<input type="color">` picker.
 *
 * @param value - The color string to check.
 * @returns `true` if the value is a 3- or 6-digit hex string.
 */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}
