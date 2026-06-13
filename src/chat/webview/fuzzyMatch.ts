/**
 * Fuzzy subsequence matcher shared by the two command-search surfaces:
 *   1. The inline `/` dropdown (`mentions.ts`).
 *   2. The commands palette modal (`commands-modal.ts`).
 *
 * Why this exists: both surfaces previously filtered with `startsWith`
 * (dropdown) / `includes` (modal). `startsWith` hid every command the user
 * couldn't spell from its first character — e.g. typing `/review` never
 * surfaced a custom `/code-review` command, so custom/MCP commands looked
 * "missing". This module matches by *subsequence* (the query characters
 * appear in order, not necessarily contiguously) and returns a score so the
 * best matches float to the top.
 *
 * Pure + DOM-free on purpose: it is unit-tested directly (fuzzyMatch.test.ts)
 * and can be reused anywhere without dragging in webview globals.
 */

// Scoring constants. Tuned so that, for short command names, the ordering is:
//   exact  >  prefix (contiguous)  >  boundary-anchored  >  scattered.
const BASE_MATCH = 8
const BOUNDARY_BONUS = 16
// Contiguity is valued slightly above a word boundary so a tight prefix match
// ("clear" in "clear-cache") always beats the same letters scattered across
// boundaries ("c-l-e-a-r").
const CONTIGUOUS_BONUS = 18
const PREFIX_BONUS = 40
const EXACT_BONUS = 1000
// Penalties keep earlier/tighter matches ahead without ever flipping a match
// to a non-match. GAP_PENALTY docks each non-contiguous jump between matched
// characters so scattered matches sink below contiguous ones.
const GAP_PENALTY = 5
const LEADING_GAP_PENALTY = 2
const LENGTH_PENALTY = 0.1

/** A character begins a "word" if it sits at index 0 or follows a separator. */
function isBoundary(text: string, idx: number): boolean {
  if (idx <= 0) return true
  const prev = text.charCodeAt(idx - 1)
  // '-' (45) '_' (95) ':' (58) '/' (47) ' ' (32) '.' (46)
  return prev === 45 || prev === 95 || prev === 58 || prev === 47 || prev === 32 || prev === 46
}

/**
 * Score how well `query` fuzzy-matches `text`.
 *
 * @returns `null` when `query` is not an (in-order) subsequence of `text`;
 *          otherwise a non-negative-ish number where higher = better.
 *          An empty query returns `0` (matches everything, no ranking signal).
 *
 * The walk is greedy left-to-right. For the short identifiers this powers
 * (command names + one-line descriptions) greedy is both fast and produces a
 * sensible order; we do not pay for an optimal-alignment DP.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t === q) return EXACT_BONUS

  let score = 0
  let qi = 0
  let firstMatchIdx = -1
  let prevMatchIdx = -2

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) !== q.charCodeAt(qi)) continue

    let charScore = BASE_MATCH
    if (isBoundary(t, ti)) charScore += BOUNDARY_BONUS
    if (ti === prevMatchIdx + 1) {
      charScore += CONTIGUOUS_BONUS
    } else if (firstMatchIdx >= 0) {
      // A jump over unmatched characters; dock it so contiguous matches win.
      charScore -= GAP_PENALTY
    }
    score += charScore

    if (firstMatchIdx < 0) firstMatchIdx = ti
    prevMatchIdx = ti
    qi++
  }

  // Not all query characters were consumed → not a subsequence.
  if (qi < q.length) return null

  if (firstMatchIdx === 0) score += PREFIX_BONUS
  score -= firstMatchIdx * LEADING_GAP_PENALTY
  score -= Math.max(0, t.length - q.length) * LENGTH_PENALTY
  return score
}

// A name match should always beat a description-only match, regardless of the
// raw subsequence scores (a long description can otherwise out-score a short
// name). This offset is larger than any realistic name score so the two pools
// never interleave.
const NAME_TIER = 100_000

/**
 * Score a description (substring) match. Descriptions are free prose, so we
 * deliberately do NOT fuzzy-subsequence them: a 2-char query like "co" is a
 * subsequence of almost any sentence, which would flood the palette with
 * irrelevant rows. A contiguous substring is the right precision here — it
 * preserves the modal's historical `includes` behaviour while letting the
 * name be fuzzily matched. Earlier and word-boundary hits score higher.
 */
function descriptionScore(query: string, description: string): number | null {
  if (!description) return null
  const d = description.toLowerCase()
  const idx = d.indexOf(query.toLowerCase())
  if (idx < 0) return null
  let s = 20 - Math.min(idx, 30) * 0.5
  if (isBoundary(d, idx)) s += 5
  return s
}

/**
 * Score a command (or any name+description pair) against a query. Matches the
 * name first (tiered above all description matches) and falls back to the
 * description so users can find a command by what it does, not just its id.
 *
 * @returns `null` when neither field matches; `0` for an empty query.
 */
export function scoreCommandMatch(query: string, name: string, description = ""): number | null {
  if (query.length === 0) return 0
  const nameScore = fuzzyScore(query, name)
  if (nameScore !== null) return NAME_TIER + nameScore
  return descriptionScore(query, description)
}

/**
 * Filter + rank a list by fuzzy match. Non-matching items are dropped; the
 * rest are ordered best-first. Ties preserve the caller's original order
 * (stable), so an empty query returns the input order untouched.
 */
export function rankByFuzzy<T>(
  items: ReadonlyArray<T>,
  query: string,
  getName: (item: T) => string,
  getDescription?: (item: T) => string,
): T[] {
  if (query.length === 0) return [...items]
  const scored: Array<{ item: T; score: number; idx: number }> = []
  items.forEach((item, idx) => {
    const score = scoreCommandMatch(query, getName(item), getDescription?.(item) ?? "")
    if (score !== null) scored.push({ item, score, idx })
  })
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
  return scored.map((s) => s.item)
}
