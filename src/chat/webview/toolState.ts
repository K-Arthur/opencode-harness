/**
 * Single source of truth for tool-call terminal-state classification.
 * Every piece of code that checks "is this tool done?" must use this
 * function so the set of terminal states never drifts between the badge
 * renderer, timing logic, stream tail, and grouping code.
 */
export function isTerminalState(state?: string): boolean {
  if (!state) return false
  return (
    state === 'result' ||
    state === 'completed' ||
    state === 'success' ||
    state === 'error' ||
    state === 'stale' ||
    state === 'cancelled' ||
    state === 'timed_out' ||
    state === 'retried'
  )
}
