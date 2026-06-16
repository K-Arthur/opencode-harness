import { diff_match_patch as DiffMatchPatch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from "diff-match-patch"

interface DiffLine {
  type: "added" | "removed" | "context"
  oldLine?: number
  newLine?: number
  content: string
  wordDiffHtml?: string
}

export function computeWordDiffs(lines: DiffLine[]): void {
  if (lines.length < 2) return

  let i = 0
  while (i < lines.length) {
    if (lines[i]!.type === "context") {
      i++
      continue
    }

    const blockStart = i
    while (i < lines.length && lines[i]!.type !== "context") i++
    const blockEnd = i

    pairLinesInBlock(lines, blockStart, blockEnd)
  }
}

function pairLinesInBlock(lines: DiffLine[], start: number, end: number): void {
  const removed: number[] = []
  const added: number[] = []

  for (let i = start; i < end; i++) {
    const line = lines[i]!
    if (line.type === "removed") removed.push(i)
    else if (line.type === "added") added.push(i)
  }

  const maxPairs = Math.min(removed.length, added.length)
  if (maxPairs === 0) return

  const dmp = new DiffMatchPatch()

  for (let p = 0; p < maxPairs; p++) {
    const rIdx = removed[p]!
    const aIdx = added[p]!

    const rLine = lines[rIdx]!
    const aLine = lines[aIdx]!

    if (rLine.content === aLine.content) continue

    const diffs = dmp.diff_main(rLine.content, aLine.content)
    dmp.diff_cleanupSemantic(diffs)

    let removedHtml = ""
    let addedHtml = ""

    for (const [op, text] of diffs) {
      const escaped = escapeHtml(text)
      switch (op) {
        case DIFF_EQUAL:
          removedHtml += escaped
          addedHtml += escaped
          break
        case DIFF_DELETE:
          removedHtml += `<del>${escaped}</del>`
          break
        case DIFF_INSERT:
          addedHtml += `<ins>${escaped}</ins>`
          break
      }
    }

    rLine.wordDiffHtml = removedHtml
    aLine.wordDiffHtml = addedHtml
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
