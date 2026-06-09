/**
 * Shared ANSI escape sequence utilities.
 *
 * Extracted from subagentCard.ts so tool call output, subagent cards, and any
 * other rendering surface all use the same logic.
 */

const ANSI_AND_CONTROL_RE = /\x1b\[[0-9;]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** Remove ANSI SGR/cursor sequences and C0 control chars (preserves \n and \t). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_AND_CONTROL_RE, "")
}
