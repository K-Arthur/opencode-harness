/**
 * Client-side hunk staging (audit §14.3).
 *
 * The opencode server applies edits itself and exposes `FileDiff { before, after }`
 * (no per-hunk structure) on the `session.diff` event. To offer per-hunk
 * accept/reject (Roo-Code-style review), this module reconstructs hunks from
 * before/after and applies an arbitrary SUBSET of them — with **zero external
 * dependencies** (jsdiff is only a transitive dep with no types; adding it would
 * need an approved-packages/ADR entry) and **no DOM/IO**, so it is exhaustively
 * unit-testable.
 *
 * Apply model: the file on disk is already at `after` (server applied it).
 * Rejecting a hunk means restoring that region to `before` while keeping accepted
 * hunks. `applyHunkSelection` computes the resulting full-file content from
 * `before` + the accepted hunk ids; the caller turns that into a single undoable
 * `WorkspaceEdit` (constitution rule #3, transactional writes).
 */
import type { DiffChunk } from "../../types"

/** A reconstructed hunk: jsdiff/`DiffChunk` shape (unified `lines: string[]`) + a stable id. */
export type StagingHunk = DiffChunk & { id: string }

/** Guard: above this combined line count we skip O(n·m) LCS and emit one whole-file hunk. */
const MAX_LCS_LINES = 4000

type Op = { kind: "eq" | "del" | "ins"; line: string }

/**
 * Line-level edit script via longest-common-subsequence backtracking.
 * `del` = present only in `before`, `ins` = present only in `after`.
 */
function diffOps(beforeLines: readonly string[], afterLines: readonly string[]): Op[] {
  const n = beforeLines.length
  const m = afterLines.length

  // Size guard: degrade to a single replace-all op stream (correct, just coarse).
  if (n + m > MAX_LCS_LINES) {
    const ops: Op[] = []
    for (const l of beforeLines) ops.push({ kind: "del", line: l })
    for (const l of afterLines) ops.push({ kind: "ins", line: l })
    return ops
  }

  // dp[i][j] = LCS length of beforeLines[i..] and afterLines[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = beforeLines[i] === afterLines[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ kind: "eq", line: beforeLines[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "del", line: beforeLines[i]! })
      i++
    } else {
      ops.push({ kind: "ins", line: afterLines[j]! })
      j++
    }
  }
  while (i < n) ops.push({ kind: "del", line: beforeLines[i++]! })
  while (j < m) ops.push({ kind: "ins", line: afterLines[j++]! })
  return ops
}

/**
 * Reconstruct hunks from `before`/`after`. Each hunk groups one contiguous run of
 * changes plus up to `context` unchanged lines on each side (matching unified-diff
 * convention). Returns `[]` when the inputs are identical.
 */
export function computeHunks(before: string, after: string, context = 3): StagingHunk[] {
  if (before === after) return []
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const ops = diffOps(beforeLines, afterLines)

  const hunks: StagingHunk[] = []
  let oldLine = 1 // 1-based position in `before`
  let newLine = 1 // 1-based position in `after`

  // Track the lines of the current open hunk and where it started.
  let cur: { oldStart: number; newStart: number; lines: string[]; oldCount: number; newCount: number } | null = null
  let trailingContext = 0 // unchanged lines accumulated after the last change in `cur`

  const flush = () => {
    if (!cur) return
    // Drop context beyond `context` from the tail.
    while (trailingContext > context) {
      const last = cur.lines[cur.lines.length - 1]!
      if (last.startsWith(" ")) {
        cur.lines.pop()
        cur.oldCount--
        cur.newCount--
        trailingContext--
      } else break
    }
    hunks.push({
      id: `h${hunks.length}-${cur.oldStart}-${cur.newStart}`,
      oldStart: cur.oldStart,
      oldLines: cur.oldCount,
      newStart: cur.newStart,
      newLines: cur.newCount,
      lines: cur.lines,
    })
    cur = null
    trailingContext = 0
  }

  // Leading-context ring buffer so a new hunk can include preceding context lines.
  const recentContext: Array<{ text: string; oldLine: number; newLine: number }> = []

  for (const op of ops) {
    if (op.kind === "eq") {
      if (cur) {
        cur.lines.push(` ${op.line}`)
        cur.oldCount++
        cur.newCount++
        trailingContext++
        // Close the hunk once we've seen enough trailing context to be safe AND
        // there's a comfortable gap (2*context) before a potential next change.
        if (trailingContext >= context * 2) flush()
      } else {
        recentContext.push({ text: op.line, oldLine, newLine })
        if (recentContext.length > context) recentContext.shift()
      }
      oldLine++
      newLine++
    } else {
      if (!cur) {
        // Open a hunk, seeding it with the buffered leading context.
        const lead = recentContext.slice()
        const oldStart = lead.length ? lead[0]!.oldLine : oldLine
        const newStart = lead.length ? lead[0]!.newLine : newLine
        cur = { oldStart, newStart, lines: [], oldCount: 0, newCount: 0 }
        for (const c of lead) {
          cur.lines.push(` ${c.text}`)
          cur.oldCount++
          cur.newCount++
        }
        recentContext.length = 0
      }
      if (op.kind === "del") {
        cur.lines.push(`-${op.line}`)
        cur.oldCount++
        oldLine++
      } else {
        cur.lines.push(`+${op.line}`)
        cur.newCount++
        newLine++
      }
      trailingContext = 0
    }
  }
  flush()
  return hunks
}

const oldSideCount = (h: StagingHunk): number => h.lines.filter((l) => l.startsWith(" ") || l.startsWith("-")).length

/**
 * Apply only the accepted hunks to `before`, returning the full resulting content.
 * Rejected hunks keep their original (`before`) lines. Accept-all reproduces
 * `after`; accept-none reproduces `before`.
 */
export function applyHunkSelection(before: string, hunks: readonly StagingHunk[], acceptedIds: Iterable<string>): string {
  const accepted = new Set(acceptedIds)
  const beforeLines = before.split("\n")
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart)
  const out: string[] = []
  let cursor = 0 // 0-based index into beforeLines

  for (const h of sorted) {
    const start = h.oldStart - 1
    while (cursor < start && cursor < beforeLines.length) out.push(beforeLines[cursor++]!)
    if (accepted.has(h.id)) {
      for (const l of h.lines) if (l.startsWith(" ") || l.startsWith("+")) out.push(l.slice(1))
    } else {
      for (const l of h.lines) if (l.startsWith(" ") || l.startsWith("-")) out.push(l.slice(1))
    }
    cursor += oldSideCount(h)
  }
  while (cursor < beforeLines.length) out.push(beforeLines[cursor++]!)
  return out.join("\n")
}

/** Count additions/deletions within a single hunk (for badges/summaries). */
export function countHunkChanges(hunk: StagingHunk): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const l of hunk.lines) {
    if (l.startsWith("+")) additions++
    else if (l.startsWith("-")) deletions++
  }
  return { additions, deletions }
}
