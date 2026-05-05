import * as vscode from "vscode"
import { SessionStore } from "../session/SessionStore"
import { log } from "../utils/outputChannel"

export function registerOpenChatCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openChat", async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      } catch (err) {
        log.error("Failed to open chat", err)
      }
    })
  )
}

export function registerNewSessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.newSession", async () => {
      try {
        const session = sessionStore.create()
        log.info(`New session created: ${session.id}`)
        vscode.window.showInformationMessage(`New session: ${session.name}`)
      } catch (err) {
        log.error("Failed to create new session", err)
        vscode.window.showErrorMessage("Failed to create a new session.")
      }
    })
  )
}

export function registerOpenStoredSessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openStoredSession", async (sessionId: string) => {
      try {
        const session = sessionStore.setActive(sessionId)
        if (session) {
          await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
        } else {
          vscode.window.showWarningMessage("That saved session could not be found.")
        }
      } catch (err) {
        log.error("Failed to open stored session", err)
        vscode.window.showErrorMessage("Failed to open stored session.")
      }
    })
  )
}

export function registerToggleFocusCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.toggleFocus", async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      } catch (err) {
        log.error("Failed to toggle focus", err)
      }
    })
  )
}

export function registerInsertMentionCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.insertMention", async () => {
      try {
        await vscode.commands.executeCommand("opencode-harness.chat.focus")
      } catch (err) {
        log.error("Failed to focus chat for mention", err)
      }
    })
  )
}

export function registerListSessionsCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.listSessions", async () => {
      try {
        const sessions = sessionStore.list()
        if (sessions.length === 0) {
          vscode.window.showInformationMessage("No saved sessions.")
          return
        }
        const items = sessions.map((s) => ({
          label: s.name,
          description: `${s.messages.length} messages`,
          detail: `${new Date(s.lastActiveAt).toLocaleDateString()} — ${s.model || "no model"}`,
          id: s.id,
        }))
        const picked = await vscode.window.showQuickPick(items, { placeHolder: "Switch to session" })
        if (picked) {
          sessionStore.setActive(picked.id)
          vscode.window.showInformationMessage(`Switched to: ${picked.label}`)
        }
      } catch (err) {
        log.error("List sessions command failed", err)
        vscode.window.showErrorMessage("Failed to list sessions.")
      }
    })
  )
}

export function registerDeleteSessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.deleteSession", async (sessionId?: string) => {
      try {
        if (!sessionId) {
          const sessions = sessionStore.list()
          if (sessions.length === 0) {
            vscode.window.showInformationMessage("No sessions to delete.")
            return
          }
          const items = sessions.map(s => ({ label: s.name, description: `${s.messages.length} messages`, id: s.id }))
          const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select session to delete" })
          if (!picked) return
          sessionId = picked.id
        }

        const session = sessionStore.get(sessionId)
        if (session && session.messages.length > 0) {
          const lastMsg = session.messages[session.messages.length - 1]
          const isStreaming = lastMsg && lastMsg.role === "assistant" && !lastMsg.blocks.some(b => b.type === "text" && b.text)
          if (isStreaming) {
            const abortFirst = await vscode.window.showWarningMessage(
              "This session is currently streaming. Abort the stream before deleting?",
              { modal: true },
              "Abort and Delete",
              "Cancel"
            )
            if (abortFirst !== "Abort and Delete") return
            vscode.commands.executeCommand("opencode-harness.openChat")
          }
        }

        const confirm = await vscode.window.showWarningMessage(
          "Delete this session? This cannot be undone.",
          { modal: true },
          "Delete"
        )
        if (confirm === "Delete") {
          sessionStore.delete(sessionId!)
          log.info(`Session deleted: ${sessionId}`)
          vscode.window.showInformationMessage("Session deleted.")
        }
      } catch (err) {
        log.error("Delete session command failed", err)
        vscode.window.showErrorMessage("Failed to delete session.")
      }
    })
  )
}

export function registerRenameSessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.renameSession", async (sessionId?: string) => {
      try {
        if (!sessionId) {
          const active = sessionStore.getActive()
          if (!active) return
          sessionId = active.id
        }
        const currentName = sessionStore.get(sessionId)?.name || ""
        const newName = await vscode.window.showInputBox({
          prompt: "Enter new session name (max 80 chars)",
          value: currentName,
          validateInput: (value) => {
            const err = sessionStore.validateSessionName(value)
            return err || undefined
          },
        })
        if (newName) {
          const success = sessionStore.rename(sessionId, newName)
          if (success) {
            log.info(`Session renamed: ${sessionId} → ${newName}`)
            vscode.window.showInformationMessage(`Renamed to: ${newName}`)
          }
        }
      } catch (err) {
        log.error("Rename session command failed", err)
        vscode.window.showErrorMessage("Failed to rename session.")
      }
    })
  )
}
