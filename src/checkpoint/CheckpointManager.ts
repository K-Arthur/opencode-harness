import * as vscode from "vscode"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { log } from "../utils/outputChannel"

export interface Checkpoint {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  filesChanged: string[]
  gitRef: string
}

const MAX_CHECKPOINTS = 20

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map()
  private git: SimpleGit | null = null
  private snapshotLock = false

  constructor() {
    this.initializeGit()
  }

  private async initializeGit(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return
    try {
      this.git = simpleGit(folders[0]!.uri.fsPath)
      const isRepo = await this.git.checkIsRepo()
      if (!isRepo) {
        this.git = null
        vscode.window.showWarningMessage("Checkpointing requires a git repository.")
      }
    } catch {
      this.git = null
    }
  }

  /**
   * Create a checkpoint snapshot.
   * If the per-session cap (MAX_CHECKPOINTS) is exceeded, prune oldest first.
   */
  async snapshot(sessionId: string, messageId: string): Promise<Checkpoint | null> {
    if (!this.git) return null
    if (this.snapshotLock) {
      log.warn("Snapshot already in progress — skipping concurrent snapshot")
      return null
    }
    this.snapshotLock = true
    let originalBranch: string | undefined
    let stashed = false
    try {
      const branchSummary = await this.git.branch()
      originalBranch = branchSummary.current

      const status = await this.git.status()
      const filesChanged = [...status.modified, ...status.created, ...status.deleted, ...status.not_added]
      if (filesChanged.length === 0) return null

      const timestamp = Date.now()
      const checkpointId = `oc-ckp-${timestamp}`
      const branchName = `opencode-harness/checkpoint/${checkpointId}`

      await this.git.stash(["push", "--include-untracked", "-m", checkpointId])
      stashed = true
      await this.git.checkoutLocalBranch(branchName)
      await this.git.stash(["pop"])
      stashed = false
      await this.git.add(".")
      await this.git.commit(`checkpoint: ${sessionId}:${messageId}`)

      const checkpoint: Checkpoint = { id: checkpointId, sessionId, messageId, timestamp, filesChanged, gitRef: branchName }
      this.checkpoints.set(checkpointId, checkpoint)
      this.pruneOldestCheckpoints(sessionId)
      return checkpoint
    } catch (err) {
      log.error("Checkpoint snapshot failed", err)
      // Rollback: if we stashed but failed after, restore stash
      if (stashed && this.git) {
        try {
          await this.git.stash(["pop"])
        } catch {
          log.error("Failed to recover stash after checkpoint failure — user may need to run git stash pop manually")
        }
      }
      return null
    } finally {
      this.snapshotLock = false
      if (originalBranch && this.git) {
        try {
          await this.git.checkout(originalBranch)
        } catch (restoreErr) {
          log.error("Failed to restore original branch after checkpoint", restoreErr)
        }
      }
    }
  }

  /**
   * Snapshot before a write action (pre-action checkpoint).
   * Creates a checkpoint before a file write so it can be rolled back.
   */
  async snapshotBeforeAction(sessionId: string, actionName: string, filePath: string): Promise<Checkpoint | null> {
    return this.snapshot(sessionId, `before-${actionName}:${filePath}`)
  }

  /**
   * Prune oldest checkpoints for a session when exceeding MAX_CHECKPOINTS.
   */
  private pruneOldestCheckpoints(sessionId: string): void {
    const sessionCheckpoints = Array.from(this.checkpoints.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => a.timestamp - b.timestamp)

    while (sessionCheckpoints.length > MAX_CHECKPOINTS) {
      const oldest = sessionCheckpoints.shift()
      if (oldest) {
        this.checkpoints.delete(oldest.id)
        log.info(`Pruned oldest checkpoint ${oldest.id} for session ${sessionId}`)
      }
    }
  }

  async restore(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint || !this.git) return false
    try {
      await this.git.checkout(checkpoint.gitRef)
      vscode.window.showInformationMessage(`Restored to checkpoint ${checkpointId}`)
      return true
    } catch {
      vscode.window.showErrorMessage("Could not restore checkpoint. The workspace may have changed since the snapshot was created.")
      return false
    }
  }

  async listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  dispose(): void { this.checkpoints.clear() }
}
