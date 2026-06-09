/**
 * Convert an opencode SDK `FileContent` (from `client.file.read`) into the
 * webview's structured `DiffLine[]`.
 *
 * opencode applies file edits server-side, so the extension never computes
 * diffs itself — it asks the server. `file.read` returns either a structured
 * `patch` (jsdiff `structuredPatch` shape) and/or a unified `diff` string. This
 * module normalizes whichever is present into rows the changed-files dropdown
 * (and any future in-chat diff view) can render directly.
 *
 * Pure — no DOM, no SDK client, no I/O — so it is exhaustively unit-testable.
 */
import type { DiffLine } from "../webview/types"

interface SdkHunk {
  oldStart: number
  oldLines?: number
  newStart: number
  newLines?: number
  lines: string[]
}

interface SdkPatch {
  hunks?: SdkHunk[]
}

export interface SdkFileContentLike {
  type?: "text" | "binary"
  content?: string
  diff?: string
  patch?: SdkPatch
}

/** Map one unified-diff line (e.g. "+foo", "-bar", " ctx") onto a DiffLine, advancing counters. */
function classifyLine(
  raw: string,
  counters: { oldLine: number; newLine: number },
): DiffLine | null {
  const marker = raw[0]
  const content = raw.slice(1)
  switch (marker) {
    case "+":
      return { type: "added", newLine: counters.newLine++, content }
    case "-":
      return { type: "removed", oldLine: counters.oldLine++, content }
    case " ":
      return { type: "context", oldLine: counters.oldLine++, newLine: counters.newLine++, content }
    case "\\":
      // "\ No newline at end of file" — metadata, not a content line.
      return null
    default:
      // Defensive: treat unprefixed lines as context so nothing is dropped.
      return { type: "context", oldLine: counters.oldLine++, newLine: counters.newLine++, content: raw }
  }
}

function hunkToLines(hunk: SdkHunk): DiffLine[] {
  const counters = { oldLine: hunk.oldStart, newLine: hunk.newStart }
  const out: DiffLine[] = []
  for (const raw of hunk.lines) {
    const line = classifyLine(raw, counters)
    if (line) out.push(line)
  }
  return out
}

/** Parse a unified diff string into DiffLine[] (fallback when no structured patch). */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let counters = { oldLine: 0, newLine: 0 }
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      // @@ -oldStart,oldLines +newStart,newLines @@
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) counters = { oldLine: Number(m[1]), newLine: Number(m[2]) }
      continue
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("diff ") || raw.startsWith("index ")) {
      continue // file headers
    }
    if (raw === "") continue
    const line = classifyLine(raw, counters)
    if (line) out.push(line)
  }
  return out
}

/**
 * Normalize an SDK FileContent into DiffLine[]. Prefers the structured `patch`;
 * falls back to parsing the unified `diff` string; returns [] when neither is
 * present (e.g. a binary file or an unchanged read).
 */
export function sdkFileContentToDiffLines(content: SdkFileContentLike | null | undefined): DiffLine[] {
  if (!content) return []
  const hunks = content.patch?.hunks
  if (Array.isArray(hunks) && hunks.length > 0) {
    return hunks.flatMap(hunkToLines)
  }
  if (typeof content.diff === "string" && content.diff.trim()) {
    return parseUnifiedDiff(content.diff)
  }
  return []
}
