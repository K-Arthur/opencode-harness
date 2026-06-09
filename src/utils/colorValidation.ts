const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGBA_RE = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/
const HSLA_RE = /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/i
const CSS_VAR_RE = /^var\(--[\w-]+\)$/
const COLOR_MIX_RE = /^color-mix\(\s*in\s+srgb\s*,/i

export function isValidCssColor(value: string): boolean {
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
