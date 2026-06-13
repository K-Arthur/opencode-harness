/**
 * Pure builders for session-switching Quick Picks.
 *
 * Used by `OpenCode: View Sessions` (the palette session switcher) and
 * `OpenCode: Jump to Running Session`. Kept free of vscode imports so the
 * ordering/labelling rules are unit-testable.
 */

export interface SessionPickCandidate {
  id: string
  title: string
  lastActiveAt: number
  messageCount: number
  model?: string
  isActive: boolean
  isStreaming: boolean
}

export interface SessionPickItem {
  id: string
  label: string
  description: string
  detail?: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelativeTime(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp)
  if (delta < MINUTE) return "just now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/** Streaming sessions first (they're what the user is most likely chasing),
 *  then most recently active. Active session is marked, not promoted — the
 *  user is switching *away* from it. */
export function buildSessionPickItems(
  candidates: readonly SessionPickCandidate[],
  now: number
): SessionPickItem[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.isStreaming !== b.isStreaming) return a.isStreaming ? -1 : 1
    return b.lastActiveAt - a.lastActiveAt
  })
  return sorted.map((c) => {
    const marker = c.isStreaming ? "$(sync~spin) " : c.isActive ? "$(check) " : ""
    const messages = `${c.messageCount} message${c.messageCount === 1 ? "" : "s"}`
    const parts = [messages, formatRelativeTime(c.lastActiveAt, now)]
    if (c.isStreaming) parts.push("running")
    else if (c.isActive) parts.push("current")
    return {
      id: c.id,
      label: `${marker}${c.title}`,
      description: parts.join(" · "),
      ...(c.model ? { detail: c.model } : {}),
    }
  })
}

export type RunningSessionPick =
  | { kind: "none" }
  | { kind: "single"; id: string }
  | { kind: "multiple"; ids: string[] }

export function pickRunningSession(
  tabs: ReadonlyArray<{ id: string; isStreaming: boolean }>
): RunningSessionPick {
  const running = tabs.filter((t) => t.isStreaming).map((t) => t.id)
  if (running.length === 0) return { kind: "none" }
  if (running.length === 1) return { kind: "single", id: running[0]! }
  return { kind: "multiple", ids: running }
}
