import type { SessionState, TokenUsage } from "./types"

export interface DisplayedUsage {
  sessionId: string
  usage: TokenUsage
  cost: number | undefined
  model: string
}

/**
 * Returns true if a token/cost update for `updatedSessionId` should refresh
 * the global token/cost display. Only the active tab's data is shown.
 */
export function shouldRefreshOnUpdate(
  updatedSessionId: string,
  activeSessionId: string | null | undefined,
): boolean {
  if (!updatedSessionId) return false
  if (!activeSessionId) return false
  return updatedSessionId === activeSessionId
}

/**
 * Pick the token/cost data that should currently be shown in the header.
 * Returns null when there is no active session, or the active session has
 * not yet received any token usage.
 */
export function selectDisplayedUsage(
  sessions: Record<string, SessionState | undefined>,
  activeSessionId: string | null | undefined,
): DisplayedUsage | null {
  if (!activeSessionId) return null
  const session = sessions[activeSessionId]
  if (!session?.tokenUsage) return null
  return {
    sessionId: session.id,
    usage: session.tokenUsage,
    cost: session.cost,
    model: session.model,
  }
}
