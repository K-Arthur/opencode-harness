import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { SessionStore } from "./session/SessionStore"
import { ContextEngine } from "./context/ContextEngine"
import { ContextMonitor } from "./monitor/ContextMonitor"
import { TerminalBridge } from "./terminal/TerminalBridge"
import { CheckpointManager } from "./checkpoint/CheckpointManager"
import { SkillManager } from "./skills/SkillManager"
import { InlineActionProvider } from "./inline/InlineActionProvider"
import { ChatProvider } from "./chat/ChatProvider"
import { ThemeManager } from "./theme/ThemeManager"
import { RateLimitMonitor } from "./monitor/RateLimitMonitor"
import { ModelManager } from "./model/ModelManager"
import { CliDiagnostics } from "./diagnostics/CliDiagnostics"
import { log } from "./utils/outputChannel"

let sessionManager: SessionManager

export function activate(context: vscode.ExtensionContext) {
  log.info("OpenCode Harness extension activating…")

  // Expose output channel for other modules
  context.subscriptions.push(log.outputChannel)

  sessionManager = new SessionManager()
  // C2: Don't push sessionManager to context.subscriptions — it's manually
  // cleaned up in deactivate() to avoid double-dispose (EventEmitter crash).

  const contextEngine = new ContextEngine()
  context.subscriptions.push(contextEngine)

  const contextMonitor = new ContextMonitor()
  context.subscriptions.push(contextMonitor)

  const themeManager = new ThemeManager()
  context.subscriptions.push(themeManager)

  const rateLimitMonitor = new RateLimitMonitor()
  context.subscriptions.push(rateLimitMonitor)

  const terminalBridge = new TerminalBridge()
  context.subscriptions.push(terminalBridge)

  const checkpointManager = new CheckpointManager()
  context.subscriptions.push(checkpointManager)

  const modelManager = new ModelManager()
  context.subscriptions.push(modelManager)

  // Auto-fetch models from CLI on startup so the picker is populated
  modelManager.refreshModels().catch(err => log.warn("Auto-fetch models failed", err))

  const cliDiagnostics = new CliDiagnostics()
  context.subscriptions.push(cliDiagnostics)

  // ---- Connection status bar ----
  const connectionStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
  connectionStatus.name = "OpenCode Connection"
  connectionStatus.text = "$(circle-slash) OpenCode: Disconnected"
  connectionStatus.tooltip = "OpenCode is not running. Click to start."
  connectionStatus.command = "opencode-harness.openChat"
  connectionStatus.show()
  context.subscriptions.push(connectionStatus)

  sessionManager.onEvent((event) => {
    switch (event.type) {
      case "server_connected":
        connectionStatus.text = "$(check-all) OpenCode: Connected"
        connectionStatus.tooltip = `OpenCode server running on port ${sessionManager.currentPort}`
        connectionStatus.command = "opencode-harness.openChat"
        void modelManager.refreshModels(sessionManager.currentPort)
        break
      case "server_disconnected":
        connectionStatus.text = "$(circle-slash) OpenCode: Disconnected"
        connectionStatus.tooltip = "OpenCode server is not running. Click to retry."
        connectionStatus.command = "opencode-harness.openChat"
        // Invalidate stale CLI session IDs so next prompt creates fresh server sessions
        sessionStore.invalidateAllCliSessionIds()
        break
      case "server_error":
        connectionStatus.text = "$(error) OpenCode: Error"
        connectionStatus.tooltip = "OpenCode encountered an error. Check output channel."
        connectionStatus.command = "opencode-harness.openChat"
        break
      case "sessions_recovered": {
        // Server restarted and reported its persisted sessions.
        // Try to re-attach local sessions to matching server sessions.
        const data = event.data as { sessions: Array<{ id: string; title?: string }> } | undefined
        if (data?.sessions) {
          const serverIds = new Set(data.sessions.map(s => s.id))
          for (const local of sessionStore.list()) {
            if (local.cliSessionId && serverIds.has(local.cliSessionId)) {
              log.info(`Re-attached local session "${local.name}" to server session ${local.cliSessionId}`)
            }
          }
          log.info(`Session recovery complete: ${data.sessions.length} server sessions found`)
        }
        break
      }
    }
  })

  // ---- Session store & tree ----
  const sessionStore = new SessionStore(context.globalState)
  if (sessionStore.count === 0) {
    sessionStore.create("Default")
  }

  // ---- Skill manager (available for future UI integration) ----
  const skillManager = new SkillManager()

  // ---- Rollback command ----
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.rollback", async () => {
      try {
        const allCheckpoints = await checkpointManager.listCheckpoints(sessionStore.getActive()?.cliSessionId || sessionStore.activeId)
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
        const selected = await vscode.window.showQuickPick(items, { placeHolder: "Select checkpoint to restore" })
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

  // ---- Terminal capture ----
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.captureTerminal", async () => {
      try {
        await terminalBridge.captureTerminalSelection()
      } catch (err) {
        log.error("Terminal capture command failed", err)
        vscode.window.showErrorMessage("Failed to capture terminal output.")
      }
    })
  )

  // ---- Inline code actions (CodeLens) ----
  const inlineProvider = new InlineActionProvider()
  const chatProvider = new ChatProvider(
    context, sessionManager, contextEngine, contextMonitor,
    themeManager, rateLimitMonitor, modelManager, sessionStore
  )

  for (const lang of ["typescript", "javascript", "python", "rust", "go", "typescriptreact", "javascriptreact"]) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file", language: lang }, inlineProvider)
    )
  }

  for (const action of ["explainCode", "refactorCode", "generateTests"]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`opencode-harness.${action}`, async (uri: vscode.Uri, range?: vscode.Range) => {
        const editor = vscode.window.activeTextEditor
        if (!editor) return
        let selection = range && !range.isEmpty ? range : editor.selection
        if (selection.isEmpty) {
          const docEnd = editor.document.lineAt(editor.document.lineCount - 1).range.end
          selection = new vscode.Range(new vscode.Position(0, 0), docEnd)
          vscode.window.showWarningMessage("No code range was selected; sending the current file instead.")
        }
        const text = editor.document.getText(selection)
        if (!text.trim()) {
          vscode.window.showWarningMessage("No code content was available to send to OpenCode.")
          return
        }
        const relativePath = vscode.workspace.asRelativePath(uri)

        const prompts: Record<string, string> = {
          explainCode: `Explain the following code from ${relativePath}:\n\n\`\`\`\n${text}\n\`\`\``,
          refactorCode: `Refactor the following code from ${relativePath}. Return only the refactored code in a code block:\n\n\`\`\`\n${text}\n\`\`\``,
          generateTests: `Generate unit tests for the following code from ${relativePath}. Return only the test code in a code block:\n\n\`\`\`\n${text}\n\`\`\``,
        }

        // Focus chat and send prompt
        await vscode.commands.executeCommand("opencode-harness.openChat")
        vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
        chatProvider.sendPromptToWebview(prompts[action])
        vscode.window.showInformationMessage(`${action.replace("Code", "")} requested for ${relativePath}`)
      })
    )
  }

  // ---- Core commands ----
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openChat", async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      } catch (err) {
        log.error("Failed to open chat", err)
      }
    })
  )

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

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.toggleFocus", async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      } catch (err) {
        log.error("Failed to toggle focus", err)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.insertMention", async () => {
      try {
        await vscode.commands.executeCommand("opencode-harness.chat.focus")
      } catch (err) {
        log.error("Failed to focus chat for mention", err)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.showRateLimits", async () => {
      try {
        await rateLimitMonitor.showDetail()
      } catch (err) {
        log.error("Failed to show rate limits", err)
      }
    })
  )

  // ---- Model selection ----
  // Model changes are per-request (no server restart needed).
  // The selected model is stored as the default for new prompts.
  // Users can also apply the model to the current session.
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.selectModel", async () => {
      try {
      // Always try to refresh models — use server if running, otherwise CLI
      await modelManager.refreshModels(sessionManager.isRunning ? sessionManager.currentPort : undefined)
      const currentModel = modelManager.model
      const model = await modelManager.pickModel()
      if (model && model !== currentModel) {
        // model is in "provider/modelId" format from pickModel()
        const slashIdx = model.indexOf("/")
        const providerID = slashIdx >= 0 ? model.substring(0, slashIdx) : "unknown"
        const modelID = slashIdx >= 0 ? model.substring(slashIdx + 1) : model

        // Update global default (used for new sessions/prompts)
        modelManager.setModel(model)
        sessionManager.setModel(providerID, modelID)
        log.info(`Model switched to ${providerID}/${modelID} (no server restart)`)

        // Ask if user wants to apply to current session too
        const activeSession = sessionStore.getActive()
        if (activeSession && activeSession.model !== model) {
          const choice = await vscode.window.showInformationMessage(
            `Apply ${modelID} to current session "${activeSession.name}"?`,
            "Apply to Current Session",
            "Just Set Default",
          )
          if (choice === "Apply to Current Session") {
            sessionStore.updateModel(activeSession.id, model)
            log.info(`Model for session ${activeSession.id} updated to ${model}`)
          }
        }
      }
      } catch (err) {
        log.error("Select model command failed", err)
        vscode.window.showErrorMessage("Failed to select model. Check the OpenCode output channel for details.")
      }
    })
  )

  // ---- CLI diagnostics ----
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.checkCli", async () => {
      try {
        const ok = await cliDiagnostics.check(sessionManager.isRunning ? sessionManager.currentPort : undefined)
        if (ok) {
          vscode.window.showInformationMessage("OpenCode CLI is working correctly.")
        } else {
          vscode.window.showErrorMessage("OpenCode CLI check failed. See 'OpenCode Harness' output channel for details.")
        }
      } catch (err) {
        log.error("CLI diagnostics command failed", err)
        vscode.window.showErrorMessage("Failed to run CLI diagnostics. Check the OpenCode output channel for details.")
      }
    })
  )

  // ---- List / switch sessions ----
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

  // ---- Delete session ----
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
        const confirm = await vscode.window.showWarningMessage(
          "Delete this session?", { modal: true }, "Delete"
        )
        if (confirm === "Delete") {
          sessionStore.delete(sessionId)
          log.info(`Session deleted: ${sessionId}`)
        }
      } catch (err) {
        log.error("Delete session command failed", err)
        vscode.window.showErrorMessage("Failed to delete session.")
      }
    })
  )

  // ---- Rename session ----
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.renameSession", async (sessionId?: string) => {
      try {
        if (!sessionId) {
          const active = sessionStore.getActive()
          if (!active) return
          sessionId = active.id
        }
        const newName = await vscode.window.showInputBox({
          prompt: "Enter new session name",
          value: sessionStore.get(sessionId)?.name,
        })
        if (newName) {
          sessionStore.rename(sessionId, newName)
          log.info(`Session renamed: ${sessionId} → ${newName}`)
        }
      } catch (err) {
        log.error("Rename session command failed", err)
        vscode.window.showErrorMessage("Failed to rename session.")
      }
    })
  )

  // ---- Chat webview provider ----
  context.subscriptions.push(
    chatProvider,
    vscode.window.registerWebviewViewProvider("opencode-harness.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  // ---- URI handler ----
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        try {
          const params = new URLSearchParams(uri.query)
          const prompt = params.get("prompt")
          vscode.commands.executeCommand("opencode-harness.chat.focus")
          if (prompt) {
            log.info(`URI handler: pre-fill prompt received`)
            chatProvider.sendPromptToWebview(prompt)
          }
        } catch (err) {
          log.error("URI handler failed", err)
        }
      },
    })
  )

  log.info("OpenCode Harness extension activated")
}

export function deactivate() {
  if (sessionManager) {
    sessionManager.dispose()
  }
  log.info("OpenCode Harness extension deactivated")
}
