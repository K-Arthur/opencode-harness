/**
 * Split a streaming markdown buffer into a "stable" prefix and an unstable
 * "tail" (P1/A).
 *
 * The stable prefix consists of markdown blocks that are already closed and
 * whose rendering will not change as more text streams in. The live renderer
 * can render the prefix once and freeze it, re-parsing only the bounded tail on
 * each flush.
 *
 * A boundary is the position just after a blank line ("\n\n") that is OUTSIDE a
 * fenced code block AND where splitting cannot fragment a multi-line block
 * construct. Specifically a boundary is rejected when:
 *   - the last content line of the stable side is a list item or blockquote
 *     (the list/quote could still be extended → loose list / multi-para quote);
 *   - the first content line of the tail is a list item, blockquote, or is
 *     indented (a continuation paragraph of the preceding block).
 * When unsure we keep text in the tail — correctness (status-quo full render)
 * is preferred over the optimization.
 *
 * Guarantees:
 *  - Lossless: `stable + tail === buf` for every input.
 *  - An unclosed (odd) code fence forces the whole buffer into the tail.
 *
 * Cost is a single O(n) line scan with no backtracking.
 */
const LIST_OR_QUOTE = /^\s*([-*+]\s|\d+[.)]\s|>)/
const INDENTED = /^[ \t]/

export function splitAtStableBoundary(buf: string): { stable: string; tail: string } {
  const n = buf.length
  if (n === 0) return { stable: "", tail: "" }

  const lines = buf.split("\n")
  const offsets: number[] = new Array(lines.length)
  const insideFence: boolean[] = new Array(lines.length)
  let inFence = false
  let off = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    offsets[i] = off
    const isFenceLine = line.trimStart().startsWith("```")
    if (isFenceLine) inFence = !inFence
    // A fence delimiter line itself is treated as "inside" so its surrounding
    // blank lines are not mistaken for prose boundaries.
    insideFence[i] = inFence || isFenceLine
    off += line.length + 1
  }
  if (inFence) return { stable: "", tail: buf } // unclosed fence → all tail

  const isBlank = (s: string) => s.trim() === ""

  // Walk candidate boundaries from the last to the first; return the last SAFE
  // one so we freeze as much as is provably safe.
  for (let i = lines.length - 1; i >= 1; i--) {
    if (insideFence[i]) continue
    const line = lines[i] as string
    if (!isBlank(line)) continue

    const boundary = (offsets[i] as number) + line.length + 1
    if (boundary <= 0 || boundary >= n) continue

    let prev = ""
    for (let j = i - 1; j >= 0; j--) {
      const lj = lines[j] as string
      if (!isBlank(lj)) { prev = lj; break }
    }
    let next = ""
    for (let j = i + 1; j < lines.length; j++) {
      const lj = lines[j] as string
      if (!isBlank(lj)) { next = lj; break }
    }
    if (next === "") continue
    if (LIST_OR_QUOTE.test(prev)) continue
    if (LIST_OR_QUOTE.test(next) || INDENTED.test(next)) continue

    return { stable: buf.slice(0, boundary), tail: buf.slice(boundary) }
  }

  return { stable: "", tail: buf }
}
