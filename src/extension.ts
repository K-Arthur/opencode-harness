import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { SessionStore } from "./session/SessionStore"
import { SessionExporter } from "./session/SessionExporter"
import { ContextEngine } from "./context/ContextEngine"
import { ContextMonitor } from "./monitor/ContextMonitor"
import { TerminalBridge } from "./terminal/TerminalBridge"
import { CheckpointManager } from "./checkpoint/CheckpointManager"
import { InlineActionProvider } from "./inline/InlineActionProvider"
import { InlineCompletionProvider } from "./inline/InlineCompletionProvider"
import { ChatProvider } from "./chat/ChatProvider"
import { ThemeManager } from "./theme/ThemeManager"
import { RateLimitMonitor } from "./monitor/RateLimitMonitor"
import { ModelManager } from "./model/ModelManager"
import { CliDiagnostics } from "./diagnostics/CliDiagnostics"
import { log } from "./utils/outputChannel"
import {
  registerRollbackCommand,
  registerThemePreviewCommand,
  registerCaptureTerminalCommand,
  registerOpenChatCommand,
  registerNewSessionCommand,
  registerOpenStoredSessionCommand,
  registerToggleFocusCommand,
  registerInsertMentionCommand,
  registerListSessionsCommand,
  registerDeleteSessionCommand,
  registerRenameSessionCommand,
  registerClearTestSessionsCommand,
  registerContinueLastSessionCommand,
  registerChooseHistorySessionCommand,
  registerAttachRemoteCommand,
  registerSelectModelCommand,
  registerShowRateLimitsCommand,
  registerCheckCliCommand,
  registerExportCommand,
} from "./commands"

let sessionManager: SessionManager
let sessionStore: SessionStore
let chatProviderInstance: ChatProvider | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    log.info("OpenCode Harness extension activating…")

    // Global unhandled promise rejection handler
    process.on("unhandledRejection", (reason) => {
      log.error("Unhandled promise rejection", reason)
    })

    // Expose output channel for other modules
    context.subscriptions.push(log.outputChannel)

    sessionManager = new SessionManager()
    // Apply remote-attach config if set; otherwise restore stored port for local-spawn reuse
    const remoteUrl = vscode.workspace.getConfiguration("opencode").get<string>("serverUrl") || ""
    const remoteToken = vscode.workspace.getConfiguration("opencode").get<string>("serverAuthToken") || ""
    if (remoteUrl.trim().length > 0) {
      sessionManager.setRemoteServer(remoteUrl, remoteToken)
      log.info(`Remote-attach mode enabled: ${remoteUrl.trim()}`)
    } else {
      const storedPort = context.globalState.get('opencode-server-port') as number | undefined
      if (storedPort) {
        sessionManager.setStoredPort(storedPort)
      }
    }

    const contextEngine = initContextEngine(context)
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

    const modelManager = initModelManager(context, sessionManager)
    const cliDiagnostics = new CliDiagnostics()
    context.subscriptions.push(cliDiagnostics)

    // Session store — don't create a default session on start, let the welcome
    // page guide the user through their first interaction.
    sessionStore = new SessionStore(context.globalState)

    // ADR-007: snapshot a git baseline whenever a fresh session is created so
    // "restore to session start" has a defined target. CheckpointManager
    // returns null when the working tree is clean (cheap no-op).
    context.subscriptions.push(
      sessionStore.onSessionCreated((sessionId) => {
        void checkpointManager.snapshot(sessionId, "baseline").catch((err) => {
          log.warn(`Baseline checkpoint failed for session ${sessionId}`, err)
        })
      })
    )

    // Connection status bar (must come after sessionStore is created)
    const connectionStatus = initConnectionStatusBar(context, sessionManager, sessionStore, modelManager)

    // Auto-start server so user doesn't see disconnected state after reload
    void sessionManager.start().catch(err => log.warn("Auto-start server failed", err))

    // Chat provider
    chatProviderInstance = new ChatProvider(
      context, sessionManager, contextEngine, contextMonitor,
      themeManager, rateLimitMonitor, modelManager, sessionStore,
      checkpointManager
    )

    registerInlineProviders(context, chatProviderInstance)
    registerCoreCommands(context, sessionStore, sessionManager, modelManager, rateLimitMonitor, checkpointManager, cliDiagnostics, themeManager, terminalBridge)
    registerChatProvider(context, chatProviderInstance)
    registerUriHandler(context, chatProviderInstance)

    log.info("OpenCode Harness extension activated")
  } catch (err) {
    log.error("Extension activation failed", err)
    vscode.window.showErrorMessage(
      "OpenCode Harness failed to activate. Please check the output channel for details.",
      "Reload Window"
    ).then((action) => {
      if (action === "Reload Window") {
        vscode.commands.executeCommand("workbench.action.reloadWindow")
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Initialization helpers
// ---------------------------------------------------------------------------

function initContextEngine(context: vscode.ExtensionContext): ContextEngine {
  const engine = new ContextEngine()
  context.subscriptions.push(engine)
  return engine
}

function initModelManager(context: vscode.ExtensionContext, sessionManager: SessionManager): ModelManager {
  const manager = new ModelManager()
  manager.setGlobalState(context.globalState)
  context.subscriptions.push(manager)
  // Auto-fetch models from CLI on startup (no port yet, no auth needed)
  manager.refreshModels().catch(err => log.warn("Auto-fetch models failed", err))
  return manager
}

function initConnectionStatusBar(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  sessionStore: SessionStore,
  modelManager: ModelManager
): vscode.StatusBarItem {
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
        void modelManager.refreshModels(sessionManager.currentPort, sessionManager.authHeader).catch(err => log.warn("Refresh models on connect failed", err))
        // Persist port for potential reuse after reload
        context.globalState.update('opencode-server-port', sessionManager.currentPort)
        break
      case "server_disconnected":
        connectionStatus.text = "$(circle-slash) OpenCode: Disconnected"
        connectionStatus.tooltip = "OpenCode server is not running. Click to retry."
        connectionStatus.command = "opencode-harness.openChat"
        // Invalidate stale CLI session IDs so next prompt creates fresh server sessions
        sessionStore.invalidateAllCliSessionIds()
        // Clear persisted port
        context.globalState.update('opencode-server-port', undefined)
        break
      case "server_error":
        connectionStatus.text = "$(error) OpenCode: Error"
        connectionStatus.tooltip = "OpenCode encountered an error. Check output channel."
        connectionStatus.command = "opencode-harness.openChat"
        break
      case "sessions_recovered": {
        // Server reported its persisted sessions on connect. Import any that
        // the extension does not yet know about so CLI-created sessions
        // surface in the picker (ADR-007).
        const data = event.data as { sessions: Array<{ id: string; title?: string; time?: { updated?: number; created?: number } }> } | undefined
        if (data?.sessions) {
          const result = sessionStore.importServerSessions(data.sessions)
          log.info(`Session recovery: ${result.imported} imported, ${result.skipped} already known (total server: ${data.sessions.length})`)
        }
        break
      }
    }
  })

  return connectionStatus
}

function registerInlineProviders(context: vscode.ExtensionContext, chatProvider: ChatProvider): void {
  const inlineProvider = new InlineActionProvider()
  const completionProvider = new InlineCompletionProvider()
  context.subscriptions.push(completionProvider)

  for (const lang of ["typescript", "javascript", "python", "rust", "go", "typescriptreact", "javascriptreact"]) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file", language: lang }, inlineProvider)
    )
  }

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      completionProvider,
    )
  )

  // Inline code actions (CodeLens)
  for (const action of ["explainCode", "refactorCode", "generateTests"]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`opencode-harness.${action}`, async (uri: vscode.Uri, range?: vscode.Range) => {
        try {
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
            explainCode: `Explain the following code from ${relativePath}:\n\`\`\`\n${text}\n\`\`\``,
            refactorCode: `Refactor the following code from ${relativePath}. Return only the refactored code in a code block:\n\`\`\`\n${text}\n\`\`\``,
            generateTests: `Generate unit tests for the following code from ${relativePath}. Return only the test code in a code block:\n\`\`\`\n${text}\n\`\`\``,
          }

          // Focus chat and send prompt
          await vscode.commands.executeCommand("opencode-harness.openChat")
          await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
          chatProvider.sendPromptToWebview(prompts[action] ?? "")
          vscode.window.showInformationMessage(`${action.replace("Code", "")} requested for ${relativePath}`)
        } catch (err) {
          log.error(`Inline action ${action} failed`, err)
          vscode.window.showErrorMessage(`Failed to ${action.replace("Code", "").toLowerCase()} code.`)
        }
      })
    )
  }
}

function registerCoreCommands(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  sessionManager: SessionManager,
  modelManager: ModelManager,
  rateLimitMonitor: RateLimitMonitor,
  checkpointManager: CheckpointManager,
  cliDiagnostics: CliDiagnostics,
  themeManager: ThemeManager,
  terminalBridge: TerminalBridge
): void {
  const sessionExporter = new SessionExporter()

  registerRollbackCommand(context, checkpointManager, sessionStore)
  registerThemePreviewCommand(context, themeManager)
  registerCaptureTerminalCommand(context, terminalBridge)
  registerOpenChatCommand(context)
  registerNewSessionCommand(context, sessionStore)
  registerOpenStoredSessionCommand(context, sessionStore)
  registerToggleFocusCommand(context)
  registerInsertMentionCommand(context)
  registerShowRateLimitsCommand(context, rateLimitMonitor)
  registerSelectModelCommand(context, modelManager, sessionManager, sessionStore)
  registerCheckCliCommand(context, sessionManager, cliDiagnostics)
  registerListSessionsCommand(context, sessionStore)
  registerDeleteSessionCommand(context, sessionStore)
  registerRenameSessionCommand(context, sessionStore)
  registerClearTestSessionsCommand(context, sessionStore, sessionManager)
  registerContinueLastSessionCommand(context, sessionStore)
  registerChooseHistorySessionCommand(context, sessionStore, sessionManager)
  registerAttachRemoteCommand(context, sessionManager)
  registerExportCommand(context, sessionExporter, sessionStore)
}

function registerChatProvider(context: vscode.ExtensionContext, chatProvider: ChatProvider): void {
  context.subscriptions.push(
    chatProvider,
    vscode.window.registerWebviewViewProvider("opencode-harness.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )
}

function registerUriHandler(context: vscode.ExtensionContext, chatProvider: ChatProvider): void {
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
}

export function deactivate() {
  if (sessionStore) {
    sessionStore.dispose()
  }
  if (sessionManager) {
    sessionManager.dispose()
  }
  log.info("OpenCode Harness extension deactivated")
}
