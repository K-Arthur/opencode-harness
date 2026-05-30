import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { SessionStore } from "./session/SessionStore"
import { SessionExporter } from "./session/SessionExporter"
import { ContextEngine } from "./context/ContextEngine"
import { VSCodeWorkspaceAdapter } from "./context/VSCodeWorkspaceAdapter"
import { ContextFileProvider } from "./context/ContextFileProvider"
import { ContextMonitor } from "./monitor/ContextMonitor"
import { TerminalBridge } from "./terminal/TerminalBridge"
import { CheckpointManager } from "./checkpoint/CheckpointManager"
import { InlineActionProvider } from "./inline/InlineActionProvider"
import { InlineCompletionProvider } from "./inline/InlineCompletionProvider"
import { runQuickChat } from "./inline/QuickChatCommand"
import { AgentGazeService } from "./decorations/AgentGazeService"
import { ChatProvider } from "./chat/ChatProvider"
import { ThemeManager } from "./theme/ThemeManager"
import { RateLimitMonitor } from "./monitor/RateLimitMonitor"
import { ModelManager } from "./model/ModelManager"
import { CliDiagnostics } from "./diagnostics/CliDiagnostics"
import { McpServerManager } from "./mcp/McpServerManager"
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
  registerAddFileToSessionCommand,
  registerAddSelectionToSessionCommand,
  registerSelectModelCommand,
  registerSetContextWindowOverrideCommand,
  registerShowRateLimitsCommand,
  registerCheckCliCommand,
  registerExportCommand,
  registerStopCommand,
  registerSlashCommandShortcuts,
  registerGenerateAgentsMdCommand,
} from "./commands"
import { MethodologyOrchestrator, OutcomeTracker, type AdvisoryOrchestrationResult } from "./methodology"
import { resolveAuthToken } from "./migrations/authTokenMigration"

let sessionManager: SessionManager
let sessionStore: SessionStore
let chatProviderInstance: ChatProvider | undefined
let methodologyOrchestrator: MethodologyOrchestrator | undefined
let outcomeTracker: OutcomeTracker | undefined
let methodologyStatusItem: vscode.StatusBarItem | undefined
let unhandledRejectionCount = 0
let unhandledRejectionWindowStart = 0

const UNHANDLED_REJECTION_WINDOW_MS = 5 * 60 * 1000
const INLINE_CODE_LANGUAGES = ["typescript", "javascript", "python", "rust", "go", "typescriptreact", "javascriptreact"] as const

export async function activate(context: vscode.ExtensionContext) {
  try {
    log.info("OpenCode Harness extension activating…")

    installUnhandledRejectionDiagnostics(context)

    // Expose output channel for other modules
    context.subscriptions.push(log.outputChannel)

    // Create McpServerManager first - it's needed for SessionManager's conditional tool routing
    const mcpServerManager = new McpServerManager(context)
    context.subscriptions.push(mcpServerManager)

    sessionManager = new SessionManager(mcpServerManager)
    // Apply remote-attach config if set; otherwise restore stored port for local-spawn reuse
    const remoteUrl = vscode.workspace.getConfiguration("opencode").get<string>("serverUrl") || ""
    // Read auth token from SecretStorage; legacy plaintext settings are migrated and cleared once.
    const remoteToken = await resolveAuthToken(context)
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

    const rateLimitMonitor = new RateLimitMonitor(context.globalState)
    context.subscriptions.push(rateLimitMonitor)

    const terminalBridge = new TerminalBridge()
    context.subscriptions.push(terminalBridge)

    const checkpointManager = new CheckpointManager(context)
    context.subscriptions.push(checkpointManager)

    const modelManager = initModelManager(context, sessionManager)
    const cliDiagnostics = new CliDiagnostics()
    context.subscriptions.push(cliDiagnostics)

    // Context file provider for viewing session context files
    const contextFileProvider = new ContextFileProvider()
    context.subscriptions.push(contextFileProvider)

    // Session store — don't create a default session on start, let the welcome
    // page guide the user through their first interaction.
    sessionStore = new SessionStore(context.globalState)
    sessionStore.setServerTitleUpdater(async (cliSessionId, title) => {
      await sessionManager.updateSessionTitle(cliSessionId, title)
    })

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

    // Methodology system — orchestrator + outcome tracker + status bar
    const methStatus = initMethodology(context)

    // Auto-start server so user doesn't see disconnected state after reload
    void sessionManager.start().catch(err => log.warn("Auto-start server failed", err))

    // When workspace folders are added after the server already started in ~/,
    // offer one restart that covers the full batch.
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
        if (e.added.length === 0 || !sessionManager.isRunning) return
        const addedDirs = e.added.map((folder) => folder.uri.fsPath).filter(Boolean)
        if (addedDirs.length === 0) return
        const label = addedDirs.length === 1
          ? addedDirs[0]!.split(/[\\/]/).pop() ?? addedDirs[0]!
          : `${addedDirs.length} workspace folders`
        const choice = await vscode.window.showInformationMessage(
          `Workspace opened: ${label}. Restart OpenCode server to use the updated workspace set?`,
          "Restart Server",
          "Keep Current"
        )
        if (choice === "Restart Server") {
          await sessionManager.stop()
          await sessionManager.start()
        }
      })
    )

    // Chat provider
    chatProviderInstance = new ChatProvider(
      context, sessionManager, contextEngine, contextMonitor,
      themeManager, rateLimitMonitor, modelManager, sessionStore,
      checkpointManager, mcpServerManager
    )

    registerInlineProviders(context, chatProviderInstance)
    registerCoreCommands(context, sessionStore, sessionManager, modelManager, rateLimitMonitor, checkpointManager, cliDiagnostics, themeManager, terminalBridge, chatProviderInstance)
    registerChatProvider(context, chatProviderInstance)
    registerUriHandler(context, chatProviderInstance)

    const agentGaze = new AgentGazeService(sessionManager)
    context.subscriptions.push(agentGaze)

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

function installUnhandledRejectionDiagnostics(context: vscode.ExtensionContext): void {
  const handler = (reason: unknown) => {
    const now = Date.now()
    if (now - unhandledRejectionWindowStart > UNHANDLED_REJECTION_WINDOW_MS) {
      unhandledRejectionWindowStart = now
      unhandledRejectionCount = 0
    }
    unhandledRejectionCount += 1
    log.error(`Unhandled promise rejection (${unhandledRejectionCount} in the last 5 minutes)`, reason)

    if (unhandledRejectionCount === 3) {
      void vscode.window.showWarningMessage(
        "OpenCode Harness observed repeated internal errors. Open the output channel for diagnostics.",
        "Show Logs"
      ).then((choice) => {
        if (choice === "Show Logs") log.outputChannel.show()
      })
    }
  }

  process.on("unhandledRejection", handler)
  context.subscriptions.push({ dispose: () => process.off("unhandledRejection", handler) })
}

function initContextEngine(context: vscode.ExtensionContext): ContextEngine {
  const adapter = new VSCodeWorkspaceAdapter()
  const engine = new ContextEngine(adapter)
  context.subscriptions.push(engine)
  return engine
}

function initModelManager(context: vscode.ExtensionContext, sessionManager: SessionManager): ModelManager {
  const manager = new ModelManager()
  manager.setGlobalState(context.globalState)
  context.subscriptions.push(manager)
  // Models are fetched from the server when it connects (ChatProvider.ts:487, commands/model.ts:18).
  // CLI auto-fetch is skipped because it cannot extract context windows, leaving the
  // context usage counter hidden. Wait for server connection to get full model metadata.
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
  connectionStatus.text = "$(circle-slash) OpenCode: Not connected"
  connectionStatus.tooltip = "OpenCode server is not running. Click to start."
  connectionStatus.command = "opencode-harness.openChat"
  connectionStatus.show()
  context.subscriptions.push(connectionStatus)

  sessionManager.subscribe("extension/connectionStatus", (event) => {
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
        connectionStatus.text = "$(circle-slash) OpenCode: Not connected"
        connectionStatus.tooltip = "OpenCode server is not running. Click to retry."
        connectionStatus.command = "opencode-harness.openChat"
        // Invalidate stale CLI session IDs so next prompt creates fresh server sessions
        sessionStore.invalidateAllCliSessionIds()
        // Clear persisted port
        context.globalState.update('opencode-server-port', undefined)
        break
      case "server_error":
        connectionStatus.text = "$(error) OpenCode: Connection error"
        connectionStatus.tooltip = "OpenCode encountered an error. Check output channel for details."
        connectionStatus.command = "opencode-harness.openChat"
        break
      case "sessions_recovered": {
        // Server reported its persisted sessions on connect. Import any that
        // the extension does not yet know about so CLI-created sessions
        // surface in the picker (ADR-007). The SessionManager has already
        // filtered out subagents and other-workspace sessions.
        const data = event.data as {
          sessions: Array<{
            id: string
            title?: string
            time?: { updated?: number; created?: number }
            parentID?: string
            directory?: string
          }>
        } | undefined
        if (data?.sessions) {
          const result = sessionStore.importServerSessions(data.sessions)
          log.info(`Session recovery: ${result.imported} imported, ${result.skipped} already known (total server: ${data.sessions.length})`)
        }
        break
      }
      case "session_updated": {
        const data = event.data as { title?: string } | undefined
        if (event.sessionId && data?.title) {
          sessionStore.applyServerTitle(event.sessionId, data.title)
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

  const codeDocumentSelectors: vscode.DocumentSelector = INLINE_CODE_LANGUAGES.map((language) => ({ scheme: "file", language }))

  for (const lang of INLINE_CODE_LANGUAGES) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file", language: lang }, inlineProvider)
    )
  }

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      codeDocumentSelectors,
      completionProvider,
    )
  )

  // Quick Chat — Ctrl+I captures a prompt with implicit file/selection context
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.quickChat", () => runQuickChat(chatProvider))
  )

  // Inline code actions (CodeLens)
  const inlinePrompts: Record<string, string> = {
    explainCode: `Explain the following code from {path}:\n\`\`\`\n{code}\n\`\`\``,
    refactorCode: `Refactor the following code from {path}. Return only the refactored code in a code block:\n\`\`\`\n{code}\n\`\`\``,
    generateTests: `Generate unit tests for the following code from {path}. Return only the test code in a code block:\n\`\`\`\n{code}\n\`\`\``,
  }

  for (const [action, template] of Object.entries(inlinePrompts)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`opencode-harness.${action}`, createInlineCommand(action, template, chatProvider))
    )
  }
}

function buildInlinePrompt(template: string, relativePath: string, code: string): string {
  return template.replace("{path}", relativePath).replace("{code}", code)
}

function createInlineCommand(action: string, promptTemplate: string, chatProvider: ChatProvider): (uri: vscode.Uri, range?: vscode.Range) => Promise<void> {
  const verb = action.replace("Code", "").toLowerCase()
  return async (uri: vscode.Uri, range?: vscode.Range) => {
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

      // Focus chat and send prompt
      await vscode.commands.executeCommand("opencode-harness.openChat")
      await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
      chatProvider.sendPromptToWebview(buildInlinePrompt(promptTemplate, relativePath, text))
      vscode.window.showInformationMessage(`${verb} requested for ${relativePath}`)
    } catch (err) {
      log.error(`Inline action ${action} failed`, err)
      vscode.window.showErrorMessage(`Failed to ${verb} code.`)
    }
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
  terminalBridge: TerminalBridge,
  chatProvider: ChatProvider
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
  registerSetContextWindowOverrideCommand(context)
  registerCheckCliCommand(context, sessionManager, cliDiagnostics)
  registerListSessionsCommand(context, sessionStore)
  registerDeleteSessionCommand(context, sessionStore)
  registerRenameSessionCommand(context, sessionStore)
  registerClearTestSessionsCommand(context, sessionStore, sessionManager)
  registerContinueLastSessionCommand(context, sessionStore)
  registerChooseHistorySessionCommand(context, sessionStore, sessionManager)
  registerAttachRemoteCommand(context, sessionManager)
  registerExportCommand(context, sessionExporter, sessionStore)
  registerAddFileToSessionCommand(context, chatProvider)
  registerAddSelectionToSessionCommand(context, chatProvider)
  registerStopCommand(context, chatProvider)
  registerSlashCommandShortcuts(context, chatProvider)
  registerGenerateAgentsMdCommand(context)
}

function initMethodology(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const methConfig = vscode.workspace.getConfiguration('opencode.methodology')

  outcomeTracker = new OutcomeTracker(
    context.globalState.get('opencode-methodology-outcomes') as import('./methodology').OutcomeEvent[] | undefined
  )
  outcomeTracker.setPersistenceFn((events) => {
    void context.globalState.update('opencode-methodology-outcomes', events)
  })

  methodologyOrchestrator = new MethodologyOrchestrator({
    config: {
      enabled: methConfig.get<boolean>('enabled', true),
      cascade: {
        enabled: methConfig.get<boolean>('cascadeEnabled', true),
        maxEscalations: methConfig.get<number>('maxEscalations', 2),
        qualityThresholds: {},
      },
      prompting: {
        defaultStrategy: methConfig.get<string>('defaultStrategy', 'hierarchical-cot') as import('./methodology').PromptStrategy,
        maxRefinementPasses: 3,
        contextBudget: 8000,
      },
    },
  })

  methodologyOrchestrator.getCatalog().setOutcomeTracker(outcomeTracker)

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
  statusItem.name = 'OpenCode Methodology'
  statusItem.text = '$(lightbulb) —'
  statusItem.tooltip = 'OpenCode Methodology — click to configure'
  statusItem.command = {
    command: 'workbench.action.openSettings',
    title: 'Open Settings',
    arguments: ['opencode.methodology'],
  }
  statusItem.show()
  context.subscriptions.push(statusItem)
  methodologyStatusItem = statusItem

  return statusItem
}

export function updateMethodologyStatus(result: AdvisoryOrchestrationResult): void {
  if (!methodologyStatusItem) return
  const conf = result.methodology.confidence
  const label = `${result.methodology.methodology}`
  const tier = result.advisory.recommendedTier
  methodologyStatusItem.text = `$(lightbulb) ${label} · ${tier}`
  const confPct = (conf * 100).toFixed(0)
  methodologyStatusItem.tooltip = `Methodology: ${label}\nConfidence: ${confPct}%\nRecommended tier: ${tier}\n${result.advisory.reasoning}\n\nClick to configure`
}

export function getMethodologyOrchestrator(): MethodologyOrchestrator | undefined {
  return methodologyOrchestrator
}

export function getOutcomeTracker(): OutcomeTracker | undefined {
  return outcomeTracker
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
