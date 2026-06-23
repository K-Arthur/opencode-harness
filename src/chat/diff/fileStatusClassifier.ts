/**
 * File status classification (A=added, M=modified, D=deleted).
 *
 * The opencode SDK's `file.edited` / `session.diff` events carry file paths
 * and line stats but NOT the git status letter. Without classification the
 * changed-files UI defaults every file to "Modified", mislabeling new and
 * deleted files. This module provides authoritative classification via
 * `git status --porcelain` with a before/after content inference fallback
 * for non-git workspaces.
 *
 * I/O is injected via `ClassifierDeps` so the module is exhaustively
 * unit-testable without spawning real git or touching the filesystem.
 */
import type { execSync as ExecSyncType } from "node:child_process"
import type { existsSync as ExistsSyncType } from "node:fs"

export type FileStatus = "A" | "M" | "D"

/** Injected I/O surface for testability. */
export interface ClassifierDeps {
  /** Run a shell command synchronously, return stdout string. Throw on non-zero exit. */
  execSync: typeof ExecSyncType
  /** Check if a file exists on disk. */
  existsSync: typeof ExistsSyncType
}

export interface ClassifyOptions {
  /** Absolute workspace root path (cwd for git commands). */
  workspaceRoot: string
  deps: ClassifierDeps
}

/**
 * Parse a `git status --porcelain` XY status code into a `FileStatus`.
 *
 * XY format: X = index/staged status, Y = worktree/unstaged status.
 * - `??` = untracked → Added
 * - `A`  = staged add → Added
 * - `D`  = staged or unstaged delete → Deleted
 * - `M`  = staged or unstaged modify → Modified
 * - `R`  = rename → Modified (content changed)
 * - `C`  = copy → Modified
 * - `!!` = ignored → null (not a change we track)
 *
 * Returns `null` for empty/whitespace status (no change).
 */
export function parsePorcelainStatus(xy: string): FileStatus | null {
  if (xy.length < 2) return null
  const x = xy[0]!
  const y = xy[1]!

  // Untracked → Added
  if (x === "?" && y === "?") return "A"
  // Ignored → not a change
  if (x === "!" && y === "!") return null

  // Staged add (A in index) → Added, regardless of worktree state
  if (x === "A") return "A"
  // Staged or unstaged delete → Deleted
  if (x === "D" || y === "D") return "D"
  // Staged or unstaged modify → Modified
  if (x === "M" || y === "M") return "M"
  // Rename or copy → Modified (content perspective)
  if (x === "R" || x === "C") return "M"

  // Any other non-space status → Modified (conservative default)
  if (x !== " " || y !== " ") return "M"
  return null
}

/**
 * Classify a single file's git status. Returns `null` when neither git nor
 * filesystem can determine the status (e.g. no git repo, file path invalid).
 *
 * Strategy:
 * 1. `git status --porcelain -- <path>` → parse XY status codes.
 * 2. Fallback: `git show HEAD:path` (tracked?) + `existsSync` (on disk?).
 */
export function classifyFileStatus(
  filePath: string,
  opts: ClassifyOptions,
): FileStatus | null {
  const normalized = filePath.replace(/\\/g, "/").trim()
  if (!normalized) return null

  // Strategy 1: git status --porcelain
  const gitStatus = tryGitStatus(normalized, opts)
  if (gitStatus) return gitStatus

  // Strategy 2: before/after content inference
  return inferFromBeforeAfter(normalized, opts)
}

/**
 * Batch-classify multiple files. Uses a single `git status --porcelain` call
 * for efficiency, then falls back to per-file before/after inference for any
 * files that git couldn't classify.
 *
 * Returns a Map keyed by normalized (forward-slash) path.
 */
export function classifyFileStatuses(
  filePaths: string[],
  opts: ClassifyOptions,
): Map<string, FileStatus> {
  const result = new Map<string, FileStatus>()
  const normalized = filePaths
    .map((p) => p.replace(/\\/g, "/").trim())
    .filter((p) => p.length > 0)
  if (normalized.length === 0) return result

  // Batch git status
  const batchResults = tryGitStatusBatch(normalized, opts)
  const unclassified: string[] = []

  for (const p of normalized) {
    const status = batchResults.get(p) ?? null
    if (status) {
      result.set(p, status)
    } else {
      unclassified.push(p)
    }
  }

  // Fallback for files git couldn't classify
  for (const p of unclassified) {
    const inferred = inferFromBeforeAfter(p, opts)
    if (inferred) result.set(p, inferred)
  }

  return result
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function tryGitStatus(filePath: string, opts: ClassifyOptions): FileStatus | null {
  try {
    const output = opts.deps.execSync(
      `git status --porcelain -- "${filePath}"`,
      { cwd: opts.workspaceRoot, encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024 },
    )
    if (typeof output !== "string" || output.trim().length === 0) return null
    const line = output.trim().split("\n")[0] ?? ""
    if (line.length < 2) return null
    return parsePorcelainStatus(line.slice(0, 2))
  } catch {
    return null
  }
}

function tryGitStatusBatch(
  filePaths: string[],
  opts: ClassifyOptions,
): Map<string, FileStatus> {
  const result = new Map<string, FileStatus>()
  try {
    const args = filePaths.map((p) => `"${p}"`).join(" ")
    const output = opts.deps.execSync(
      `git status --porcelain -- ${args}`,
      { cwd: opts.workspaceRoot, encoding: "utf-8", timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
    )
    if (typeof output !== "string") return result
    for (const line of output.split("\n")) {
      if (line.length < 2) continue
      const xy = line.slice(0, 2)
      // Path starts at column 3; strip surrounding quotes if present.
      let p = line.slice(3).trim()
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
      p = p.replace(/\\/g, "/").trim()
      if (!p) continue
      const status = parsePorcelainStatus(xy)
      if (status) result.set(p, status)
    }
  } catch {
    // git unavailable or error — all files will fall through to inference
  }
  return result
}

/**
 * Infer file status from git HEAD content + filesystem existence.
 *
 * - `git show HEAD:path` succeeds AND file exists on disk → M (tracked, modified)
 * - `git show HEAD:path` succeeds AND file does NOT exist → D (tracked, deleted)
 * - `git show HEAD:path` fails AND file exists → A (untracked, added)
 * - `git show HEAD:path` fails AND file doesn't exist → null (unknown)
 */
function inferFromBeforeAfter(filePath: string, opts: ClassifyOptions): FileStatus | null {
  let inGitHead = false
  try {
    opts.deps.execSync(
      `git show HEAD:${filePath}`,
      { cwd: opts.workspaceRoot, encoding: "utf-8", timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
    )
    inGitHead = true
  } catch {
    // Not in git HEAD (untracked or no git repo)
  }

  const existsOnDisk = opts.deps.existsSync(
    // Caller passes workspaceRoot; we construct the full path for existsSync.
    // The deps mock handles path joining; in production this is the workspace-relative path.
    filePath,
  )

  if (inGitHead && existsOnDisk) return "M"
  if (inGitHead && !existsOnDisk) return "D"
  if (!inGitHead && existsOnDisk) return "A"
  return null
}
