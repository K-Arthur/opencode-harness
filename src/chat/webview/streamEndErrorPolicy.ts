import type { ChatMessage } from "../../types"

/**
 * A structured error card — rendered by `handleServerStatus("error")` /
 * `handleStreamError` and carrying category, severity, actions and collapsible
 * technical detail — is the canonical surface for a failed generation.
 *
 * The end-of-stream path *also* used to append a generic
 * "An error occurred while generating the response" card for `reason === "error"`,
 * so a single fault stacked two (or three, with the status echo) cards. When a
 * structured error card already exists among the most recent messages, that
 * generic card is a duplicate and must be suppressed.
 *
 * Scoped to a small recent window so a long-ago error never silences a genuine
 * new end-of-stream error.
 */
export function hasRecentErrorCard(messages: readonly ChatMessage[], windowSize = 3): boolean {
  if (messages.length === 0) return false
  const start = Math.max(0, messages.length - windowSize)
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i]
    if (m && m.role === "system" && m.blocks[0]?.type === "error") return true
  }
  return false
}
