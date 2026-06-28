/**
 * Session-aware baseline resolution for diff review / accept / reject.
 *
 * For a given session and file path, returns the "before" content (the state
 * of the file when the session started). Resolution order:
 *   1. git show <baselineSha>:<relPath> (session's captured git HEAD)
 *   2. CheckpointManager snapshot content (fallback when SHA is lost)
 *   3. git show HEAD:<relPath> (current HEAD, legacy sessions)
 *   4. "" (empty, for untracked/new files)
 *
 * Files outside the session workspace (e.g. model-created files in a
 * different directory) have no git baseline — they are treated as new
 * files and return "".
 */

import * as path from "path"
import type { CheckpointManager } from "../checkpoint/CheckpointManager"
import type { SessionStore } from "../session/SessionStore"

export interface BaselineResolverDeps {
  sessionStore: SessionStore
  checkpointManager: CheckpointManager
  execSync: (command: string, options: { cwd: string; encoding: string; timeout?: number }) => Buffer | string
  log: { debug: (msg: string) => void; warn: (msg: string) => void; info: (msg: string) => void }
}

/**
 * Resolve the "before" content for a file in a session.
 * Returns empty string if the file cannot be resolved.
 */
export async function getBaselineContent(
  sessionId: string,
  filePath: string,
  deps: BaselineResolverDeps,
): Promise<string> {
  const workspaceRoot = deps.sessionStore.getSessionDirectory(sessionId)
  if (!workspaceRoot) {
    deps.log.warn(`No workspace directory for session ${sessionId}`)
    return ""
  }

  const baselineSha = deps.sessionStore.getBaselineSha(sessionId)
  const rawPath = filePath.trim().replace(/\\/g, "/")

  // Convert absolute paths to workspace-relative for git show. If the file
  // is outside the session workspace, there is no git baseline — treat it
  // as a new file and return "".
  const relPath = path.isAbsolute(rawPath)
    ? path.relative(workspaceRoot, rawPath).replace(/\\/g, "/")
    : rawPath

  if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
    deps.log.info(`File "${rawPath}" is outside the session workspace — no git baseline, treating as new file`)
    return ""
  }

  // Strategy 1: git show <baselineSha>:<relPath>
  if (baselineSha) {
    try {
      const result = deps.execSync(
        `git show ${baselineSha}:${relPath}`,
        { cwd: workspaceRoot, encoding: "utf-8", timeout: 5000 },
      )
      if (typeof result === "string" && result.length > 0) {
        deps.log.debug(`Resolved baseline for ${relPath} from SHA ${baselineSha}`)
        return result
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      deps.log.debug(`git show ${baselineSha}:${relPath} failed: ${msg}`)
    }
  }

  // Strategy 2: CheckpointManager snapshot (fallback for lost SHA)
  try {
    const checkpoints = await deps.checkpointManager.listCheckpoints(sessionId)
    const baselineCheckpoint = checkpoints.find((c) => c.action === "baseline" && c.filesChanged.includes(filePath))
    if (baselineCheckpoint) {
      deps.log.debug(`Found baseline checkpoint ${baselineCheckpoint.id} for ${relPath}, but content extraction not yet implemented`)
    }
  } catch (err) {
    deps.log.debug(`Checkpoint lookup failed for ${relPath}: ${err}`)
  }

  // Strategy 3: git show HEAD:<relPath> (legacy sessions without captured SHA)
  if (!baselineSha) {
    deps.log.info(`No baseline SHA for session ${sessionId} — comparing against current HEAD`)
    try {
      const result = deps.execSync(
        `git show HEAD:${relPath}`,
        { cwd: workspaceRoot, encoding: "utf-8", timeout: 5000 },
      )
      if (typeof result === "string" && result.length > 0) {
        return result
      }
    } catch {
      // File not in git HEAD (new/untracked) — this is expected
    }
  }

  // Strategy 4: Empty string (untracked/new file)
  return ""
}
