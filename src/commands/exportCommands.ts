import * as vscode from "vscode"
import { SessionExporter } from "../session/SessionExporter"
import { SessionStore } from "../session/SessionStore"
import { log } from "../utils/outputChannel"

/**
 * Register export commands for different formats.
 */
export function registerExportCommands(
  context: vscode.ExtensionContext,
  sessionExporter: SessionExporter,
  sessionStore: SessionStore
): void {
  // Export as Markdown (existing)
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

  // Export as JSON
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportConversationJson", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        await sessionExporter.exportJson(session)
      } catch (err) {
        log.error("Export conversation as JSON failed", err)
        vscode.window.showErrorMessage("Failed to export conversation as JSON.")
      }
    })
  )

  // Export as Plain Text
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportConversationPlainText", async () => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        await sessionExporter.exportPlainText(session)
      } catch (err) {
        log.error("Export conversation as plain text failed", err)
        vscode.window.showErrorMessage("Failed to export conversation as plain text.")
      }
    })
  )

  // Export selected messages as Markdown
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportSelectedMarkdown", async (selection?: number[]) => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        if (!selection || selection.length === 0) {
          vscode.window.showInformationMessage("No messages selected.")
          return
        }
        await sessionExporter.exportMarkdown(session, selection)
      } catch (err) {
        log.error("Export selected messages failed", err)
        vscode.window.showErrorMessage("Failed to export selected messages.")
      }
    })
  )

  // Export selected messages as JSON
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportSelectedJson", async (selection?: number[]) => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        if (!selection || selection.length === 0) {
          vscode.window.showInformationMessage("No messages selected.")
          return
        }
        await sessionExporter.exportJson(session, selection)
      } catch (err) {
        log.error("Export selected messages as JSON failed", err)
        vscode.window.showErrorMessage("Failed to export selected messages as JSON.")
      }
    })
  )

  // Export selected messages as Plain Text
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.exportSelectedPlainText", async (selection?: number[]) => {
      try {
        const session = sessionStore.getActive()
        if (!session) {
          vscode.window.showInformationMessage("No active session to export.")
          return
        }
        if (!selection || selection.length === 0) {
          vscode.window.showInformationMessage("No messages selected.")
          return
        }
        await sessionExporter.exportPlainText(session, selection)
      } catch (err) {
        log.error("Export selected messages as plain text failed", err)
        vscode.window.showErrorMessage("Failed to export selected messages as plain text.")
      }
    })
  )
}
