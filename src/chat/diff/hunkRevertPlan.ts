/**
 * Hunk-reject planning (audit §14.3, design §14c of the agent-visibility doc).
 *
 * The correct way to "discard one hunk of an agent edit" in opencode's
 * server-authoritative model: the edit is already on disk, so rejecting a hunk
 * is a normal, undoable user edit that reverts those lines — which opencode's
 * file watcher reconciles. This module is the pure planner the host uses: given
 * the file's before (git HEAD) / after (current) and the hunk to reject, it
 * returns the new file content (all hunks kept EXCEPT the rejected one). The host
 * applies the result via a single vscode.WorkspaceEdit.
 *
 * Host-authoritative on purpose: the host computes hunks from git before/after
 * and ships their ids to the webview, so revert_hunk(id) recomputes the SAME
 * deterministic hunks and the ids can never drift between the two sides.
 */
import { computeHunks, applyHunkSelection, countHunkChanges, type StagingHunk } from "./hunkStaging"

export interface FileHunkSummary {
  id: string
  additions: number
  deletions: number
  /** Unified-diff lines for this hunk (prefixed " "/"-"/"+"). */
  lines: string[]
}

/** Hunks for display, computed from before/after (stable ids). */
export function getFileHunks(before: string, after: string): FileHunkSummary[] {
  return computeHunks(before, after).map((h) => {
    const c = countHunkChanges(h)
    return { id: h.id, additions: c.additions, deletions: c.deletions, lines: h.lines }
  })
}

export interface HunkRevertPlan {
  /** Full new file content with the rejected hunk reverted to its before-state. */
  newContent: string
  hunks: StagingHunk[]
}

/**
 * Plan a single-hunk revert. Returns null if the hunk id isn't found (stale
 * request — the diff changed underneath the user), so the caller can no-op.
 */
export function planHunkRevert(before: string, after: string, rejectedHunkId: string): HunkRevertPlan | null {
  const hunks = computeHunks(before, after)
  if (!hunks.some((h) => h.id === rejectedHunkId)) return null
  const acceptedIds = hunks.filter((h) => h.id !== rejectedHunkId).map((h) => h.id)
  return { newContent: applyHunkSelection(before, hunks, acceptedIds), hunks }
}
