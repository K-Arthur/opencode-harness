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
  registerSelectModelCommand,
  registerShowRateLimitsCommand,
  registerCheckCliCommand,
  registerExportCommand,
} from "./commands"

let sessionManager: SessionManager
let sessionStore: SessionStore
let chatProviderInstance: ChatProvider | undefined

export function activate(context: vscode.ExtensionContext) {
  log.info("OpenCode Harness extension activating…")

  // Expose output channel for other modules
  context.subscriptions.push(log.outputChannel)

  sessionManager = new SessionManager()
  // Restore stored port for potential reuse
  const storedPort = context.globalState.get('opencode-server-port') as number | undefined
  if (storedPort) {
    sessionManager.setStoredPort(storedPort)
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

  // Connection status bar
  const connectionStatus = initConnectionStatusBar(context, sessionManager, sessionStore, modelManager)

  // Session store
  sessionStore = new SessionStore(context.globalState)
  if (sessionStore.count === 0) {
    sessionStore.create("Default")
  }

  // Auto-start server so user doesn't see disconnected state after reload
  void sessionManager.start().catch(err => log.warn("Auto-start server failed", err))

  // Chat provider
  chatProviderInstance = new ChatProvider(
    context, sessionManager, contextEngine, contextMonitor,
    themeManager, rateLimitMonitor, modelManager, sessionStore
  )

  registerInlineProviders(context, chatProviderInstance)
  registerCoreCommands(context, sessionStore, sessionManager, modelManager, rateLimitMonitor, checkpointManager, cliDiagnostics, themeManager, terminalBridge)
  registerChatProvider(context, chatProviderInstance)
  registerUriHandler(context, chatProviderInstance)

  log.info("OpenCode Harness extension activated")
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
  // Auto-fetch models from CLI on startup so the picker is populated
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
        void modelManager.refreshModels(sessionManager.currentPort)
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
        vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
        chatProvider.sendPromptToWebview(prompts[action] ?? "")
        vscode.window.showInformationMessage(`${action.replace("Code", "")} requested for ${relativePath}`)
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
