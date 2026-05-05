import * as vscode from "vscode"
import { SessionExporter } from "../session/SessionExporter"
import { SessionStore } from "../session/SessionStore"
import { log } from "../utils/outputChannel"

export function registerExportCommand(
  context: vscode.ExtensionContext,
  sessionExporter: SessionExporter,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportConversation", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        await sessionExporter.exportMarkdown(session)
      } catch (err) {
        log.error("Export conversation failed", err)
        vscode.window.showErrorMessage("Failed to export conversation.")
      }
    })
  )
}
