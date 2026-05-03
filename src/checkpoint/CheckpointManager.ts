import * as vscode from "vscode"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"

export interface Checkpoint {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  filesChanged: string[]
  gitRef: string
}

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map()
  private git: SimpleGit | null = null

  constructor() {
    this.initializeGit()
  }

  private async initializeGit(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return
    try {
      this.git = simpleGit(folders[0].uri.fsPath)
      const isRepo = await this.git.checkIsRepo()
      if (!isRepo) {
        this.git = null
        vscode.window.showWarningMessage("Checkpointing requires a git repository.")
      }
    } catch {
      this.git = null
    }
  }

  async snapshot(sessionId: string, messageId: string): Promise<Checkpoint | null> {
    if (!this.git) return null
    try {
      const status = await this.git.status()
      const filesChanged = [...status.modified, ...status.created, ...status.deleted, ...status.not_added]
      if (filesChanged.length === 0) return null

      const timestamp = Date.now()
      const checkpointId = `oc-ckp-${timestamp}`
      const branchName = `opencode-harness/checkpoint/${checkpointId}`

      await this.git.stash(["push", "--include-untracked", "-m", checkpointId])
      await this.git.checkoutLocalBranch(branchName)
      await this.git.stash(["pop"])
      await this.git.add(".")
      await this.git.commit(`checkpoint: ${sessionId}:${messageId}`)

      const checkpoint: Checkpoint = { id: checkpointId, sessionId, messageId, timestamp, filesChanged, gitRef: branchName }
      this.checkpoints.set(checkpointId, checkpoint)
      return checkpoint
    } catch (err) {
      console.error("[CheckpointManager] Snapshot failed:", err)
      return null
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
