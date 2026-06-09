import * as vscode from "vscode"
import * as path from "path"
import { log } from "../utils/outputChannel"

export interface Checkpoint {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  createdAt: number
  filesChanged: string[]
  action?: string
}

interface FileSnapshot {
  path: string
  uri: vscode.Uri
  existed: boolean
  content?: Uint8Array
}

const MAX_CHECKPOINTS = 20

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map()
  private snapshots: Map<string, FileSnapshot[]> = new Map()
  private snapshotQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly context?: vscode.ExtensionContext) {}

  /**
   * Create a checkpoint snapshot for explicit file paths.
   * If the per-session cap (MAX_CHECKPOINTS) is exceeded, prune oldest first.
   * Uses a promise-chain serializer to prevent TOCTOU races between concurrent calls.
   */
  async snapshot(sessionId: string, messageId: string, files: string[] = []): Promise<Checkpoint | null> {
    const next = this.snapshotQueue.then(() => this.snapshotImpl(sessionId, messageId, files))
    this.snapshotQueue = next.catch(() => {})
    return next
  }

  private async snapshotImpl(sessionId: string, messageId: string, files: string[]): Promise<Checkpoint | null> {
    const uniqueFiles = Array.from(new Set(files.map((file) => this.normalizePath(file)).filter(Boolean)))
    if (uniqueFiles.length === 0) return null

    try {
      if (this.context) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, "checkpoints"))
      }

      const timestamp = Date.now()
      const checkpointId = `oc-ckp-${timestamp}`
      const fileSnapshots: FileSnapshot[] = []

      for (const file of uniqueFiles) {
        const uri = this.resolveWorkspaceFile(file)
        if (!uri) continue
        try {
          const content = await vscode.workspace.fs.readFile(uri)
          fileSnapshots.push({ path: file, uri, existed: true, content })
        } catch {
          fileSnapshots.push({ path: file, uri, existed: false })
        }
      }

      if (fileSnapshots.length === 0) return null

      const checkpoint: Checkpoint = {
        id: checkpointId,
        sessionId,
        messageId,
        timestamp,
        createdAt: timestamp,
        filesChanged: fileSnapshots.map((entry) => entry.path),
        action: this.extractAction(messageId),
      }
      this.checkpoints.set(checkpointId, checkpoint)
      this.snapshots.set(checkpointId, fileSnapshots)
      this.pruneOldestCheckpoints(sessionId)
      return checkpoint
    } catch (err) {
      log.error("Checkpoint snapshot failed", err)
      return null
    }
  }

  /**
   * Snapshot before a write action (pre-action checkpoint).
   * Creates a checkpoint before a file write so it can be rolled back.
   */
  async snapshotBeforeAction(sessionId: string, actionName: string, filePath: string | string[]): Promise<Checkpoint | null> {
    const files = Array.isArray(filePath) ? filePath : [filePath]
    return this.snapshot(sessionId, `before-${actionName}:${files.join(",")}`, files)
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
        this.snapshots.delete(oldest.id)
        log.info(`Pruned oldest checkpoint ${oldest.id} for session ${sessionId}`)
      }
    }
  }

  async restore(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId)
    const fileSnapshots = this.snapshots.get(checkpointId)
    if (!checkpoint || !fileSnapshots || fileSnapshots.length === 0) return false

    try {
      const edit = new vscode.WorkspaceEdit()
      for (const snapshot of fileSnapshots) {
        if (snapshot.existed && snapshot.content) {
          try {
            const doc = await vscode.workspace.openTextDocument(snapshot.uri)
            edit.replace(snapshot.uri, new vscode.Range(0, 0, doc.lineCount, 0), Buffer.from(snapshot.content).toString("utf8"))
          } catch {
            edit.createFile(snapshot.uri, { overwrite: true, contents: Buffer.from(snapshot.content) })
          }
        } else {
          edit.deleteFile(snapshot.uri, { ignoreIfNotExists: true })
        }
      }

      const ok = await vscode.workspace.applyEdit(edit)
      if (ok) {
        vscode.window.showInformationMessage(`Restored to checkpoint ${checkpointId}`)
      } else {
        vscode.window.showErrorMessage("Could not restore checkpoint. VS Code rejected the workspace edit.")
      }
      return ok
    } catch (err) {
      log.error("Checkpoint restore failed", err)
      vscode.window.showErrorMessage("Could not restore checkpoint. The workspace may have changed since the snapshot was created.")
      return false
    }
  }

  async listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  dispose(): void {
    this.checkpoints.clear()
    this.snapshots.clear()
  }

  private resolveWorkspaceFile(filePath: string): vscode.Uri | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return undefined
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath)
    const relative = path.relative(workspaceRoot, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return vscode.Uri.file(resolved)
  }

  private normalizePath(filePath: string): string {
    return filePath.trim().replace(/\\/g, "/")
  }

  private extractAction(messageId: string): string | undefined {
    const match = messageId.match(/^before-([^:]+):/)
    return match?.[1]
  }
}
