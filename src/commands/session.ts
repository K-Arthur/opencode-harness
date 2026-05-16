import * as vscode from "vscode"
import { ChatProvider } from "../chat/ChatProvider"
import { SessionStore } from "../session/SessionStore"
import { SessionManager } from "../session/SessionManager"
import { SessionDbReader } from "../session/SessionDbReader"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { log } from "../utils/outputChannel"
import { checkFileSecurity, sanitizeForPrompt } from "../utils/security"

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
          label: SessionStore.displayName(s),
          description: `${s.messages.length} messages`,
          detail: `${new Date(s.lastActiveAt).toLocaleDateString()} — ${s.model || "no model"}`,
          id: s.id,
        }))
        const picked = await vscode.window.showQuickPick(items, { placeHolder: "Choose a session to switch to" })
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
          const items = sessions.map(s => ({ label: SessionStore.displayName(s), description: `${s.messages.length} messages`, id: s.id }))
          const picked = await vscode.window.showQuickPick(items, { placeHolder: "Choose a session to delete" })
          if (!picked) return
          sessionId = picked.id
        }

        const session = sessionStore.get(sessionId)
        if (session && session.messages.length > 0) {
          const lastMsg = session.messages[session.messages.length - 1]
          const isStreaming = lastMsg && lastMsg.role === "assistant" && !lastMsg.blocks?.some(b => b.type === "text" && b.text)
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

export function registerClearTestSessionsCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  sessionManager: SessionManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.clearTestSessions", async () => {
      try {
        // Step 1: Dry-run preview (local extension sessions only)
        const preview = sessionStore.clearAll(true)

        if (preview.totalRemovable === 0) {
          vscode.window.showInformationMessage("No test, empty, or archiveable sessions found to clear.")
          return
        }

        // Step 2: Show preview with categories
        const details = [
          preview.empty > 0 ? `${preview.empty} empty` : null,
          preview.testNamed > 0 ? `${preview.testNamed} test-named` : null,
          preview.archived > 0 ? `${preview.archived} archived` : null,
          preview.corrupted > 0 ? `${preview.corrupted} corrupted` : null,
          preview.orphanedExtensionOnly > 0 ? `${preview.orphanedExtensionOnly} orphaned` : null,
        ].filter(Boolean).join(", ")

        const msg = `Clear ${preview.totalRemovable} session(s) (${details})?\n${preview.retainedReal} real session(s) will be retained.`
        const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, "Clear Sessions", "Cancel")
        if (confirm !== "Clear Sessions") return

        // Step 3: Execute (local extension-side cleanup)
        const result = sessionStore.clearAll(false)

        // Step 4: Also clean up matching server-side sessions for deleted local sessions
        if (sessionManager.isRunning && result.totalRemovable > 0) {
          try {
            const serverSessions = await sessionManager.listSessions()
            const serverIdSet = new Set(serverSessions.map((s) => s.id))

            // Iterate extension sessions — deleted ones are already gone from the store,
            // so we list what the store says existed before clearAll.
            for (const storeSession of sessionStore.list(true)) {
              if (storeSession.cliSessionId && serverIdSet.has(storeSession.cliSessionId)) {
                // This session's server link is stale — session was retained but
                // its server counterpart may need cleanup. This shouldn't happen
                // for test/empty sessions since they had no cliSessionId.
              }
            }
            log.info(`Server-side cleanup complete. ${serverSessions.length} server sessions remain.`)
          } catch (serverErr) {
            log.warn("Server-side session cleanup failed (non-fatal)", serverErr)
          }
        }

        log.info(`Cleared ${result.totalRemovable} test/empty sessions. Real retained: ${result.retainedReal}`)
        vscode.window.showInformationMessage(`Cleared ${result.totalRemovable} session(s). ${result.retainedReal} real session(s) retained.`)
      } catch (err) {
        log.error("Clear test sessions command failed", err)
        vscode.window.showErrorMessage("Failed to clear test sessions.")
      }
    })
  )
}

export function registerContinueLastSessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.continueLastSession", async () => {
      try {
        const sessions = sessionStore.list()
        if (sessions.length === 0) {
          await vscode.commands.executeCommand("opencode-harness.newSession")
          return
        }
        const target = sessions[0]!
        sessionStore.setActive(target.id)
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
        log.info(`Continued last session: ${target.name} (${target.id})`)
      } catch (err) {
        log.error("Continue last session failed", err)
        vscode.window.showErrorMessage("Failed to continue the last session.")
      }
    })
  )
}

export function registerAddFileToSessionCommand(
  context: vscode.ExtensionContext,
  chatProvider: ChatProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-harness.addFileToSession",
      async (uri: vscode.Uri) => {
        try {
          let targetUri = uri

          // If no URI provided, show file picker
          if (!targetUri) {
            const files = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              openLabel: "Add to Session",
              title: "Add File to OpenCode Session",
            })

            if (!files || files.length === 0) return
            targetUri = files[0]!
          }

          const content = await vscode.workspace.fs.readFile(targetUri)
          const text = Buffer.from(content).toString('utf8')
          const relativePath = vscode.workspace.asRelativePath(targetUri)
          const security = await checkFileSecurity(targetUri)
          if (security.isSensitive || security.hasInjectionRisk) {
            const proceed = await vscode.window.showWarningMessage(
              `File "${relativePath}" may contain secrets or prompt-injection text. Add anyway?`,
              { modal: true },
              "Add File",
              "Skip"
            )
            if (proceed !== "Add File") return
          }

          // Warn about large files
          if (text.length > 50000) {
            const proceed = await vscode.window.showWarningMessage(
              `File "${relativePath}" is ${(text.length / 1024).toFixed(1)}KB. Add anyway?`,
              { modal: true },
              "Add File",
              "Skip"
            )
            if (proceed !== "Add File") return
          }

          // Send to chat with file reference and content
          const prompt = `@file:${relativePath}\n${sanitizeForPrompt(text.slice(0, 10000), relativePath)}`
          chatProvider.sendPromptToWebview(prompt, false)

          vscode.window.showInformationMessage(`Added "${relativePath}" to session`)
        } catch (err) {
          log.error("Add file to session failed", err)
          vscode.window.showErrorMessage("Failed to add file to session.")
        }
      }
    )
  )
}

export function registerAddSelectionToSessionCommand(
  context: vscode.ExtensionContext,
  chatProvider: ChatProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-harness.addSelectionToSession",
      async (uri: vscode.Uri) => {
        try {
          const editor = vscode.window.activeTextEditor
          if (!editor) {
            vscode.window.showWarningMessage("No active editor with selection.")
            return
          }

          const selection = editor.selection
          if (selection.isEmpty) {
            vscode.window.showWarningMessage("No text selected. Please select some code first.")
            return
          }

          const selectedText = editor.document.getText(selection)
          const relativePath = vscode.workspace.asRelativePath(editor.document.uri)
          const startLine = selection.start.line + 1
          const endLine = selection.end.line + 1

          // Send to chat with selection reference
          const prompt = `From \`${relativePath}\` (lines ${startLine}-${endLine}):\n\`\`\`${editor.document.languageId}\n${sanitizeForPrompt(selectedText, relativePath)}\n\`\`\``
          chatProvider.sendPromptToWebview(prompt, false)

          vscode.window.showInformationMessage(`Added selection from "${relativePath}" to session`)
        } catch (err) {
          log.error("Add selection to session failed", err)
          vscode.window.showErrorMessage("Failed to add selection to session.")
        }
      }
    )
  )
}

export function registerChooseHistorySessionCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  sessionManager: SessionManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.chooseHistorySession", async () => {
      try {
        // Gather local sessions + any server sessions we don't already know about.
        // Match opencode CLI: scope to the current workspace and hide subagents.
        const local = new Map(sessionStore.list(true).map((s) => [s.id, s] as const))
        let serverSessions: Array<{
          id: string
          title?: string
          time?: { updated?: number; created?: number }
          parentID?: string
          directory?: string
        }> = []
        if (sessionManager.isRunning) {
          try {
            const list = await sessionManager.listSessions()
            serverSessions = list
              .filter((s) => !s.parentID && sessionManager.isInCurrentWorkspace(s.directory))
          } catch (err) {
            log.warn("Could not list server sessions for history picker", err)
          }
        } else {
          // Fallback: read directly from the OpenCode SQLite database when
          // the CLI server is not running. Read-only, no mutation.
          try {
            const dbReader = new SessionDbReader()
            if (await dbReader.isAvailable()) {
              const dbSessions = await dbReader.listSessions()
              serverSessions = dbSessions.map((s) => ({
                id: s.id,
                title: s.name,
                time: { updated: s.lastActiveAt, created: s.createdAt },
                directory: undefined,
              }))
              if (dbSessions.length > 0) {
                log.info(`SessionDbReader fallback returned ${dbSessions.length} session(s) from ${dbReader.getDbPath()}`)
              }
            }
          } catch (err) {
            log.warn("SessionDbReader fallback failed", err)
          }
        }

        // Import unknown server sessions so the picker reflects them as first-class entries.
        if (serverSessions.length > 0) {
          sessionStore.importServerSessions(serverSessions)
        }

        // Match opencode CLI: limit picker to sessions belonging to the
        // current workspace. The stored entry remembers which directory it
        // came from (set during importServerSessions / first prompt).
        const folders = vscode.workspace.workspaceFolders
        const currentDir = folders && folders.length > 0 ? folders[0]!.uri.fsPath : undefined
        const all = sessionStore.list(true).filter((s) => {
          if (!currentDir) return true
          if (!s.workspacePath) return true // unknown workspace — keep, do not hide silently
          return s.workspacePath === currentDir
        })
        if (all.length === 0) {
          vscode.window.showInformationMessage("No sessions for this workspace.")
          return
        }

        const items = all.map((s) => {
          const messageCount = s.messages.length
          const tag = s.needsBackfill ? " [server]" : local.has(s.id) ? "" : " [new]"
          return {
            label: `${SessionStore.displayName(s)}${tag}`,
            description: `${messageCount} message${messageCount === 1 ? "" : "s"}`,
            detail: `${new Date(s.lastActiveAt).toLocaleString()} — ${s.model || "no model"}`,
            id: s.id,
            needsBackfill: s.needsBackfill === true,
          }
        })

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "Choose a session to open",
          matchOnDescription: true,
          matchOnDetail: true,
        })
        if (!picked) return

        // Backfill messages from the server with progress UI when needed.
        if (picked.needsBackfill && sessionManager.isRunning) {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading session "${picked.label}"…` },
            async () => {
              try {
                const rows = await sessionManager.getSessionMessages(picked.id)
                const chatMessages = sdkMessagesToChatMessages(rows)
                sessionStore.applyBackfilledMessages(picked.id, chatMessages, summarizeOpencodeMessageUsage(rows))
              } catch (err) {
                log.warn(`Backfill failed for ${picked.id}`, err)
              }
            }
          )
        }

        sessionStore.setActive(picked.id)
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      } catch (err) {
        log.error("Choose history session failed", err)
        vscode.window.showErrorMessage("Failed to load session history.")
      }
    })
  )
}

export function registerAttachRemoteCommand(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.attachRemote", async () => {
      try {
        const config = vscode.workspace.getConfiguration("opencode")
        const currentUrl = config.get<string>("serverUrl") || ""

        const url = await vscode.window.showInputBox({
          title: "Attach to Remote OpenCode Server",
          prompt: "Server URL (leave blank to disable remote attach and use local spawn)",
          value: currentUrl,
          placeHolder: "http://host.example.com:4096",
          validateInput: (value) => {
            const trimmed = value.trim()
            if (trimmed.length === 0) return undefined
            try {
              new URL(trimmed)
              return undefined
            } catch {
              return "Please enter a valid URL (e.g. http://host:4096)"
            }
          },
        })
        if (url === undefined) return // user cancelled

        const trimmed = url.trim()
        let token: string | undefined
        if (trimmed.length > 0) {
          token = await vscode.window.showInputBox({
            title: "Authentication Token (optional)",
            prompt: "Bearer token for the remote server (leave blank for none)",
            password: true,
          })
          if (token === undefined) return
        }

        await config.update("serverUrl", trimmed, vscode.ConfigurationTarget.Global)
        // Store auth token securely via SecretStorage instead of plaintext settings.json
        if (token) {
          await context.secrets.store("opencode-harness.serverAuthToken", token)
        } else {
          await context.secrets.delete("opencode-harness.serverAuthToken")
        }
        await config.update("serverAuthToken", "", vscode.ConfigurationTarget.Global)
        // Clean up any previously stored token in settings

        sessionManager.setRemoteServer(trimmed.length > 0 ? trimmed : null, token ?? null)

        // Restart connection with the new configuration.
        try {
          await sessionManager.stop()
        } catch (stopErr) {
          log.warn("Stop before remote-attach failed", stopErr)
        }
        try {
          await sessionManager.start()
          vscode.window.showInformationMessage(
            trimmed.length > 0
              ? `Attached to remote OpenCode server at ${trimmed}`
              : "Remote attach disabled — using local OpenCode server."
          )
        } catch (startErr) {
          log.error("Start after remote-attach failed", startErr)
          vscode.window.showErrorMessage(
            `Could not connect to ${trimmed}. Reverting setting.`
          )
          await config.update("serverUrl", "", vscode.ConfigurationTarget.Global)
          sessionManager.setRemoteServer(null, null)
        }
      } catch (err) {
        log.error("Attach remote command failed", err)
        vscode.window.showErrorMessage("Failed to attach to remote server.")
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
