import * as vscode from "vscode"
import { SessionExporter } from "../session/SessionExporter"
import { SessionStore } from "../session/SessionStore"
import { importFromFile } from "../session/SessionImporter"
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

/**
 * Register the "Import Conversation from JSON" command (P3.3 — audit §11).
 * Mirrors the export format: reads a JSON file produced by exportConversationJson,
 * parses it into an OpenCodeSession, and adds it to the SessionStore.
 */
export function registerImportCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.importConversationJson", async () => {
      try {
        const imported = await importFromFile()
        if (!imported) return // user cancelled the file dialog
        // Create a local session shell via the store, then populate it with
        // the imported messages. Imports are local copies — no server link.
        const session = sessionStore.create(imported.name)
        session.messages = imported.messages
        session.model = imported.model
        session.cost = imported.cost
        session.createdAt = imported.createdAt
        session.lastActiveAt = imported.lastActiveAt
        vscode.window.showInformationMessage(
          `Imported "${session.name}" (${session.messages.length} messages). It is now available in your session list.`,
        )
      } catch (err) {
        log.error("Import conversation failed", err)
        vscode.window.showErrorMessage("Could not import this conversation. Check the output channel for details.")
      }
    })
  )
}
