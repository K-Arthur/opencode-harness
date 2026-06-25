/**
 * File diff statistics computation (added/removed line counts).
 *
 * Used by ChatProvider when the opencode server's file.edited event does not
 * carry explicit added/removed counts. This module provides a robust fallback
 * that:
 *   - Normalizes paths across WSL2/Docker boundaries
 *   - Reads file content from disk when not open in an editor
 *   - Uses git diff --numstat for fast stats, falling back to hunk computation
 *   - Logs command failures for debugging
 *   - Normalizes line endings (CRLF vs LF) to avoid false zero diffs
 *
 * Pure — no VS Code APIs, no direct filesystem access — so it is exhaustively
 * unit-testable with mocked deps.
 */
import { getFileHunks } from "./hunkRevertPlan"
import type { execSync as ExecSyncType } from "node:child_process"

export interface DiffStatsDeps {
  /** Run a shell command synchronously, return stdout string. Throw on non-zero exit. */
  execSync: typeof ExecSyncType
  /** Read file content from disk as a UTF-8 string. Throw on failure. */
  readFileSync: (path: string) => string
  /** Get the current content of an open text document, or undefined if not open. */
  getOpenDocumentText: (absPath: string) => string | undefined
  /** Logging interface for debug/warning messages. */
  log: { debug: (msg: string) => void; warn: (msg: string) => void }
}

export interface DiffStatsResult {
  added: number
  removed: number
}

/**
 * Normalize a file path from the opencode server into a workspace-relative path.
 *
 * Handles:
 *   - Backslash → forward slash conversion
 *   - Absolute paths with container prefixes (e.g. /workspace/foo → foo)
 *   - WSL UNC paths (e.g. //wsl$/Ubuntu/home/user/foo → foo)
 *   - Windows drive letters (e.g. C:/foo → foo if workspaceRoot ends with /foo)
 *
 * Returns undefined if the path cannot be normalized.
 */
function normalizePath(rawPath: string, workspaceRoot: string): string | undefined {
  let p = rawPath.trim().replace(/\\/g, "/")
  if (!p) return undefined

  // If already relative and reasonable, return as-is
  if (!p.startsWith("/")) {
    return p
  }

  // Normalize workspace root to forward slashes
  const wsRoot = workspaceRoot.replace(/\\/g, "/")

  // Try to strip a matching prefix: if p starts with wsRoot, remove it
  // e.g. p = "/workspace/projects/foo", wsRoot = "/workspace/projects" → "foo"
  if (p.startsWith(wsRoot + "/")) {
    return p.slice(wsRoot.length + 1)
  }

  // If p starts with wsRoot exactly, return empty (workspace root itself)
  if (p === wsRoot) {
    return ""
  }

  // Try to match the last N segments: if workspace root is "/workspace/foo" and p is
  // "/container/workspace/foo/bar.txt", match the "workspace/foo" suffix.
  const wsSegments = wsRoot.split("/").filter(Boolean)
  const pSegments = p.split("/").filter(Boolean)

  // Find the longest matching suffix
  let matchLen = 0
  const minLen = Math.min(wsSegments.length, pSegments.length)
  for (let i = 1; i <= minLen; i++) {
    const wsSuffix = wsSegments.slice(-i).join("/")
    const pSuffix = pSegments.slice(-i).join("/")
    if (wsSuffix === pSuffix) {
      matchLen = i
    }
  }

  if (matchLen > 0) {
    // Return the unmatched prefix of p (the part before the matched suffix)
    const unmatched = pSegments.slice(0, pSegments.length - matchLen).join("/")
    return unmatched ? `${unmatched}/${wsSegments.slice(-matchLen).join("/")}` : wsSegments.slice(-matchLen).join("/")
  }

  // WSL UNC path: //wsl$/Ubuntu/home/user/foo → try to match home/user/foo
  if (p.startsWith("//wsl$/") || p.startsWith("\\\\wsl$\\")) {
    const withoutWsl = p.replace(/^\/\/wsl\$\/|^\\\\wsl\$\\/, "").replace(/\\/g, "/")
    // Recursively normalize the WSL path
    const wslResult = normalizePath(withoutWsl, wsRoot)
    if (wslResult !== undefined) {
      return wslResult
    }
  }

  // Fallback: return the path as-is if it looks like a relative path under a known prefix
  // This handles cases where the server sends absolute paths that are actually correct
  // for the extension host's workspace (e.g., both in the same container).
  return p
}

/**
 * Compute added/removed line counts for a file.
 *
 * Strategy:
 *   1. Try `git diff --numstat HEAD -- <path>` for fast stats.
 *   2. If that fails, fall back to `git show HEAD:<path>` + disk/open-document read.
 *   3. Normalize line endings to LF before diffing to avoid CRLF false positives.
 *   4. Log all failures at debug level for troubleshooting.
 *
 * Returns { added: 0, removed: 0 } on any error, but logs the failure.
 */
export function computeFileDiffStats(
  rawPath: string,
  workspaceRoot: string,
  deps: DiffStatsDeps,
): DiffStatsResult {
  const relPath = normalizePath(rawPath, workspaceRoot)
  if (relPath === undefined) {
    deps.log.warn(`Cannot normalize path "${rawPath}" against workspace root "${workspaceRoot}"`)
    return { added: 0, removed: 0 }
  }

  const absPath = workspaceRoot.replace(/\\/g, "/") + (relPath ? `/${relPath}` : "")

  // Strategy 1: git diff --numstat (fast, authoritative)
  try {
    const out = deps.execSync(
      `git diff --numstat HEAD -- "${relPath}"`,
      { cwd: workspaceRoot, encoding: "utf-8", timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
    )
    if (typeof out === "string") {
      const m = /^\s*(\d+)\s+(\d+)\s+/.exec(out)
      if (m) {
        const added = Number(m[1])
        const removed = Number(m[2])
        deps.log.debug(`git diff --numstat for ${relPath}: +${added} -${removed}`)
        return { added, removed }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    deps.log.debug(`git diff --numstat failed for ${relPath}: ${msg}`)
  }

  // Strategy 2: git show HEAD: + content diff
  let before = ""
  try {
    const beforeResult = deps.execSync(
      `git show HEAD:${relPath}`,
      { cwd: workspaceRoot, encoding: "utf-8", timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
    )
    if (typeof beforeResult === "string") {
      before = beforeResult
    }
  } catch (err) {
    // File not in git HEAD (new/untracked file) - this is expected
    const msg = err instanceof Error ? err.message : String(err)
    deps.log.debug(`git show HEAD:${relPath} failed: ${msg}`)
  }

  // Get "after" content: prefer open document, fall back to disk
  let after = deps.getOpenDocumentText(absPath)
  if (after === undefined) {
    try {
      after = deps.readFileSync(absPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      deps.log.warn(`Cannot read ${absPath}: ${msg}`)
      return { added: 0, removed: 0 }
    }
  }

  // Normalize line endings to LF to avoid CRLF/LF mismatches across Windows/WSL/Docker
  before = before.replace(/\r\n/g, "\n")
  after = after.replace(/\r\n/g, "\n")

  if (!before && !after) {
    return { added: 0, removed: 0 }
  }

  // Compute hunks from before/after content
  const hunks = getFileHunks(before, after)
  const result = hunks.reduce(
    (acc, h) => ({ added: acc.added + h.additions, removed: acc.removed + h.deletions }),
    { added: 0, removed: 0 },
  )
  deps.log.debug(`Computed diff stats for ${relPath} via hunks: +${result.added} -${result.removed}`)
  return result
}
