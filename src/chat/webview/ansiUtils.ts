/**
 * Shared ANSI escape sequence utilities.
 *
 * Extracted from subagentCard.ts so tool call output, subagent cards, and any
 * other rendering surface all use the same logic.
 */

const ANSI_AND_CONTROL_RE = /\x1b\[[0-9;]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
const ANSI_SGR_RE = /\x1b\[([0-9;]*)m/g
const ANSI_NON_SGR_RE = /\x1b\[[0-9;]*[A-LN-Z_a-ln-z]|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g

let renderAnsiEnabled = false

/** Remove ANSI SGR/cursor sequences and C0 control chars (preserves \n and \t). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_AND_CONTROL_RE, "")
}

export function setToolOutputRenderAnsi(enabled: boolean): void {
  renderAnsiEnabled = enabled
}

export function isToolOutputRenderAnsiEnabled(): boolean {
  return renderAnsiEnabled
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function classesForCodes(codes: number[], current: Set<string>): Set<string> {
  const next = new Set(current)
  for (const code of codes.length > 0 ? codes : [0]) {
    if (code === 0) next.clear()
    else if (code === 1) next.add("ansi-bold")
    else if (code === 22) next.delete("ansi-bold")
    else if (code >= 30 && code <= 37) {
      for (const cls of Array.from(next)) if (cls.startsWith("ansi-fg-")) next.delete(cls)
      next.add(["ansi-fg-black", "ansi-fg-red", "ansi-fg-green", "ansi-fg-yellow", "ansi-fg-blue", "ansi-fg-magenta", "ansi-fg-cyan", "ansi-fg-white"][code - 30]!)
    } else if (code >= 90 && code <= 97) {
      for (const cls of Array.from(next)) if (cls.startsWith("ansi-fg-")) next.delete(cls)
      next.add(["ansi-fg-bright-black", "ansi-fg-bright-red", "ansi-fg-bright-green", "ansi-fg-bright-yellow", "ansi-fg-bright-blue", "ansi-fg-bright-magenta", "ansi-fg-bright-cyan", "ansi-fg-bright-white"][code - 90]!)
    } else if (code === 39) {
      for (const cls of Array.from(next)) if (cls.startsWith("ansi-fg-")) next.delete(cls)
    }
  }
  return next
}

export function renderAnsiToHtml(input: string): string {
  const text = input.replace(ANSI_NON_SGR_RE, "")
  let out = ""
  let lastIndex = 0
  let classes = new Set<string>()
  for (const match of text.matchAll(ANSI_SGR_RE)) {
    const index = match.index ?? 0
    const segment = text.slice(lastIndex, index)
    if (segment) {
      const escaped = escapeHtml(segment)
      out += classes.size > 0
        ? `<span class="${Array.from(classes).join(" ")}">${escaped}</span>`
        : escaped
    }
    const codes = (match[1] ?? "")
      .split(";")
      .filter(Boolean)
      .map((code) => Number(code))
      .filter((code) => Number.isFinite(code))
    classes = classesForCodes(codes, classes)
    lastIndex = index + match[0].length
  }
  const tail = text.slice(lastIndex)
  if (tail) {
    const escaped = escapeHtml(tail)
    out += classes.size > 0
      ? `<span class="${Array.from(classes).join(" ")}">${escaped}</span>`
      : escaped
  }
  return out
}
