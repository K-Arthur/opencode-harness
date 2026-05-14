import * as vscode from "vscode"
import { CheckpointManager } from "../checkpoint/CheckpointManager"
import { SessionStore } from "../session/SessionStore"
import { log } from "../utils/outputChannel"

export function registerRollbackCommand(
  context: vscode.ExtensionContext,
  checkpointManager: CheckpointManager,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.rollback", async () => {
      try {
        const allCheckpoints = await checkpointManager.listCheckpoints(
          sessionStore.getActive()?.cliSessionId || sessionStore.activeId
        )
        if (allCheckpoints.length === 0) {
          vscode.window.showInformationMessage("No checkpoints are available for the active session.")
          return
        }
        const items = allCheckpoints.map((c) => ({
          label: `Checkpoint ${c.id}`,
          description: new Date(c.timestamp).toLocaleString(),
          detail: `${c.filesChanged.length} files changed`,
          id: c.id,
        }))
        const selected = await vscode.window.showQuickPick(items, { placeHolder: "Choose a checkpoint to restore" })
        if (selected) {
          await checkpointManager.restore(selected.id)
          vscode.window.showInformationMessage(`Restored checkpoint ${selected.id}`)
        }
      } catch (err) {
        log.error("Rollback command failed", err)
        vscode.window.showErrorMessage("Failed to restore checkpoint. Check the OpenCode output channel for details.")
      }
    })
  )
}
