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
          vscode.window.showInformationMessage("No active session to export. Open a session first.")
          return
        }
        await sessionExporter.exportMarkdown(session)
      } catch (err) {
        log.error("Export conversation failed", err)
        vscode.window.showErrorMessage("Could not export this conversation. Check the output channel for details.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportConversationJson", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export. Open a session first.")
          return
        }
        await sessionExporter.exportJson(session)
      } catch (err) {
        log.error("Export conversation as JSON failed", err)
        vscode.window.showErrorMessage("Could not export this conversation. Check the output channel for details.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportConversationText", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export. Open a session first.")
          return
        }
        await sessionExporter.exportPlainText(session)
      } catch (err) {
        log.error("Export conversation as text failed", err)
        vscode.window.showErrorMessage("Could not export this conversation. Check the output channel for details.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.copyConversation", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to copy. Open a session first.")
          return
        }
        const content = sessionExporter.markdown(session)
        await sessionExporter.copyToClipboard(content)
      } catch (err) {
        log.error("Copy conversation failed", err)
        vscode.window.showErrorMessage("Could not copy the conversation. Check the output channel for details.")
      }
    })
  )
}
