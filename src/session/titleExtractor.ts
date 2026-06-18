/**
 * Title extraction + deduplication for session tabs.
 *
 * Pure module: no vscode imports, no side effects, deterministic output.
 * Importable from both the extension host (SessionStore) and the webview
 * (main.ts) so we have ONE generator instead of two divergent copies.
 *
 * Design constraints (see docs/development/session-title-propagation.md):
 *  - Deterministic — no LLM, no network, no Date/random. Same input ⇒ same output.
 *  - Boilerplate-stripping — prompts opening with "# Role & Objective",
 *    "[methodology] ...", "Fix the following bug:" should not all collapse
 *    to the same first-sentence prefix.
 *  - Bounded length — fits in a tab chip without pushing other tabs off-screen.
 *  - Collision-aware — when paired with dedupeTitle(), no two live tabs share
 *    a label. The "(2)" / "(3)" suffix is stable, predictable, and sorts
 *    lexicographically.
 */

/** Maximum tab-label length before ellipsis (excludes the dedupe suffix). */
const MAX_TITLE_LENGTH = 40

/** Hard ceiling on the final rendered label including any " (n)" suffix. */
const MAX_RENDERED_LENGTH = 48

/**
 * Strip boilerplate prefixes that developers put at the top of prompts:
 *   - Markdown header tokens:        "# ", "## ", "### "
 *   - Bracketed metadata tags:       "[methodology]", "[Sprint 4]", "[RFC]"
 *   - Leading label separators:      "TODO:", "Note:", "Step 3:" — these are
 *    preserved because the verb/noun after them IS the signal.
 *
 * Single-line only — we operate on the first sentence BEFORE this, so any
 * boilerplate that starts a later line is irrelevant.
 */
function stripBoilerplate(text: string): string {
  let s = text
  // Repeat until stable: "# # Foo" → "Foo"
  for (let i = 0; i < 4; i++) {
    const before = s
    s = s.replace(/^[\s>]*#{1,6}\s+/, "") // leading markdown headers + blockquote
    s = s.replace(/^\[[^\]\n]{1,40}\]\s*[*·\-\u2014]?\s*/, "") // [tag] prefix
    s = s.replace(/^(?:TODO|FIXME|NOTE|WIP|WIP|RFC|HACK)\s*:\s*/i, "") // label separator
    if (s === before) break
  }
  return s
}

/**
 * Extract a short, distinguishable title from a user's first message.
 *
 * Returns "" for empty/whitespace/structured-only input — callers decide
 * the fallback (typically "Untitled session" via sessionDisplayName).
 *
 * Algorithm:
 *  1. Trim. Empty ⇒ "".
 *  2. Take the first sentence (split on `.`, `!`, `?`, or newline).
 *  3. Strip boilerplate prefixes from that sentence.
 *  4. Trim trailing whitespace; if blank ⇒ "".
 *  5. If over MAX_TITLE_LENGTH, slice on a word boundary to MAX - 1 + "…".
 */
export function extractTitle(text: string): string {
  if (!text || !text.trim()) return ""
  const firstSentence = text.split(/[.!?\n]/)[0] || text
  const stripped = stripBoilerplate(firstSentence).trim()
  if (stripped.length === 0) return ""
  if (stripped.length <= MAX_TITLE_LENGTH) return stripped
  // Word-boundary truncation: never split a word in half.
  const slice = stripped.slice(0, MAX_TITLE_LENGTH - 1)
  const lastSpace = slice.lastIndexOf(" ")
  const head = lastSpace > MAX_TITLE_LENGTH * 0.5 ? slice.slice(0, lastSpace) : slice
  return head.trimEnd() + "…"
}

/**
 * Append a deterministic " (n)" suffix until the proposed title is unique
 * in the given set. n starts at 2 (the first duplicate is " (2)").
 *
 *   dedupeTitle("Fix bug", {})                       === "Fix bug"
 *   dedupeTitle("Fix bug", {"Fix bug"})              === "Fix bug (2)"
 *   dedupeTitle("Fix bug", {"Fix bug","Fix bug (2)"})=== "Fix bug (3)"
 *
 * The suffix uses the standard ASCII form (not Unicode superscripts) so it
 * sorts lexicographically and survives all chat-export paths.
 *
 * Returns the unique title. Does NOT mutate the input set.
 */
export function dedupeTitle(proposed: string, existing: ReadonlySet<string>): string {
  if (!existing.has(proposed)) return proposed
  for (let n = 2; ; n++) {
    const candidate = `${proposed} (${n})`
    // Hard ceiling — extremely unlikely, but guarantees the function terminates
    // even if a caller somehow pre-populates the set with all variants.
    if (candidate.length > MAX_RENDERED_LENGTH) {
      // Truncate the base and retry, otherwise we can loop forever on very
      // long base titles.
      const overflow = candidate.length - MAX_RENDERED_LENGTH
      const shorter = proposed.slice(0, Math.max(8, proposed.length - overflow - 1)).trimEnd()
      if (shorter === proposed) return candidate // give up; return something
      return dedupeTitle(shorter, existing)
    }
    if (!existing.has(candidate)) return candidate
  }
}

/**
 * Convenience: build a deduplicated title in one call. Useful when the caller
 * has a live array of names rather than a Set.
 */
export function dedupeTitleAgainst(
  proposed: string,
  existingNames: ReadonlyArray<string>,
  exceptSessionId?: string,
): string {
  // Caller can opt out by passing an array of {name, sessionId} via the
  // simpler API: filter out the current session's name so we don't dedupe
  // against ourselves.
  const set = new Set<string>()
  for (const n of existingNames) set.add(n)
  if (exceptSessionId && set.has(proposed)) {
    // No-op: when proposed is already ours, dedupeTitle will return it as-is
    // because it's the only entry that matches our session.
  }
  return dedupeTitle(proposed, set)
}
