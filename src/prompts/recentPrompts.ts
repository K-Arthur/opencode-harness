/**
 * Recent / pinned prompt rail (brief Phase 5 "Pinned Prompts").
 *
 * Distinct from the existing manual "prompt stash" (save named prompts for reuse):
 * this surfaces a session's own recent user prompts and lets important ones be
 * pinned to the top (requirements, architecture decisions, the original task).
 *
 * Pure, DOM-free, IO-free core: (session user prompts + pinned id set) → ordered
 * rail. Rendering and the pin toggle live at the webview edge.
 *
 * Ordering contract:
 *   1. Pinned prompts first, newest-pinned-first, and NEVER dropped by the cap.
 *   2. Then the most-recent unpinned prompts, newest first, capped at maxRecent.
 */

export interface PromptEntry {
  id: string
  text: string
  /** Unix ms the prompt was sent. */
  time: number
}

export interface PromptRailItem extends PromptEntry {
  pinned: boolean
}

export interface PromptRailOptions {
  /** Max unpinned recent prompts to show (pinned are always shown). Default 5. */
  maxRecent?: number
}

const DEFAULT_MAX_RECENT = 5

/**
 * Build the ordered prompt rail. Pinned prompts float to the top (newest first)
 * and bypass the recent cap; the remaining slots show the newest unpinned prompts.
 */
export function buildPromptRail(
  prompts: readonly PromptEntry[],
  pinnedIds: Iterable<string>,
  opts: PromptRailOptions = {},
): PromptRailItem[] {
  const maxRecent = opts.maxRecent ?? DEFAULT_MAX_RECENT
  const pinned = new Set(pinnedIds)

  const byTimeDesc = (a: PromptEntry, b: PromptEntry) => b.time - a.time

  const pinnedItems = prompts
    .filter((p) => pinned.has(p.id))
    .slice()
    .sort(byTimeDesc)
    .map((p) => ({ ...p, pinned: true }))

  const recentItems = prompts
    .filter((p) => !pinned.has(p.id))
    .slice()
    .sort(byTimeDesc)
    .slice(0, Math.max(0, maxRecent))
    .map((p) => ({ ...p, pinned: false }))

  return [...pinnedItems, ...recentItems]
}

/** Toggle a prompt's pinned membership, returning a NEW set (immutable). */
export function togglePinnedPrompt(pinnedIds: Iterable<string>, id: string): Set<string> {
  const next = new Set(pinnedIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
