import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { SessionStore } from "./session/SessionStore"
import { SessionExporter } from "./session/SessionExporter"
import { LocalSessionProcessManager } from "./session/LocalSessionProcessManager"
import { SessionManagerRegistry } from "./session/SessionManagerRegistry"
import { ContextEngine } from "./context/ContextEngine"
import { STATUS_BAR_TOOLTIPS } from "./statusBarTooltips"
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
import { OpenCodeConfigService, type ConfigLogger } from "./config/OpenCodeConfigService"
import { ConfigStatusBar } from "./config/ConfigStatusBar"
import { OpencodeInstaller, type AutoInstallMode } from "./install/OpencodeInstaller"
import { log } from "./utils/outputChannel"
import { createLazyStarter } from "./utils/lazyStarter"
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
  registerInstallCliCommand,
  registerExportCommand,
  registerImportCommand,
  registerStopCommand,
  registerSlashCommandShortcuts,
  registerGenerateAgentsMdCommand,
  registerJumpToRunningTaskCommand,
} from "./commands"
import { MethodologyOrchestrator, OutcomeTracker } from "./methodology"
import { setMethodologyOrchestrator, setMethodologyStatusUpdater, type MethodologyStatusInfo } from "./methodology/registry"
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

function extensionModeName(mode: vscode.ExtensionMode): string {
  switch (mode) {
    case vscode.ExtensionMode.Development: return "Development"
    case vscode.ExtensionMode.Production: return "Production"
    case vscode.ExtensionMode.Test: return "Test"
    default: return `Unknown(${mode})`
  }
}

function logExtensionRuntime(context: vscode.ExtensionContext): void {
  const pkg = context.extension.packageJSON as {
    name?: unknown
    publisher?: unknown
    version?: unknown
    main?: unknown
  }
  const extensionId = `${typeof pkg.publisher === "string" ? pkg.publisher : "unknown"}.${typeof pkg.name === "string" ? pkg.name : "unknown"}`
  const version = typeof pkg.version === "string" ? pkg.version : "unknown"
  const main = typeof pkg.main === "string" ? pkg.main : "unknown"
  log.info(`OpenCode Harness runtime: id=${extensionId} version=${version} mode=${extensionModeName(context.extensionMode)} path=${context.extensionPath} main=${main}`)
}

export async function activate(context: vscode.ExtensionContext) {
  try {
    const activationStart = performance.now()
    log.info("OpenCode Harness extension activating…")
    logExtensionRuntime(context)

    installUnhandledRejectionDiagnostics(context)

    // Expose output channel for other modules
    context.subscriptions.push(log.outputChannel)

    // Create McpServerManager first - it's needed for SessionManager's conditional tool routing
    const mcpServerManager = new McpServerManager(context)
    context.subscriptions.push(mcpServerManager)
    const mcpCreatedAt = performance.now()

    // Workspace config service (opencode.jsonc discovery, parsing, watcher)
    const configLogger: ConfigLogger = {
      warn: (msg, err) => log.warn(msg, err),
      error: (msg, err) => log.error(msg, err),
      info: (msg) => log.info(msg),
    }
    const configService = new OpenCodeConfigService(vscode, configLogger)
    context.subscriptions.push(configService)
    configService.watch()
    void configService.refresh()

    // Status bar indicator for workspace config
    const configStatusBar = new ConfigStatusBar(vscode)
    configStatusBar.show()
    context.subscriptions.push(configStatusBar)
    context.subscriptions.push(
      configService.onConfigChanged((result) => {
        configStatusBar.update(result.status, result.path)
      })
    )

    // Command: open the workspace config file (clicked from status bar)
    context.subscriptions.push(
      vscode.commands.registerCommand("opencode-harness.openConfigFile", async () => {
        const configPath = configService.getConfigPath()
        if (configPath) {
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(configPath))
        } else {
          vscode.window.showInformationMessage("No opencode.jsonc config file found in this workspace.")
        }
      })
    )

    sessionManager = new SessionManager(mcpServerManager)
    const sessionMgrCreatedAt = performance.now()
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
    const ctxReadyAt = performance.now()

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

    // OpenCode CLI is a hard requirement. VS Code has no install-time hook, so
    // detect-and-install runs on activation (see ensureOpencodeAndStart below).
    const installer = new OpencodeInstaller(context.globalState)
    // Lazy server warm-up: spawn the opencode server on first engagement (chat
    // view resolve / explicit install) rather than in every window on activation.
    // Idempotent + de-duped; SessionManager.start() early-returns when connected.
    const ensureServerReady = createLazyStarter(() => ensureOpencodeAndStart(sessionManager, installer))
    registerInstallCliCommand(context, installer, () => {
      void ensureServerReady().catch((err) => log.warn("Start after install failed", err))
    })

    // B20: Pre-warm the server during activation so the first prompt doesn't
    // pay the 1-3s startup tax. Non-blocking — errors are logged, not thrown.
    // The lazy starter is idempotent, so this is safe alongside the chat-view
    // warmup hook and won't double-start.
    if (remoteUrl.trim().length === 0) {
      const warmStart = performance.now()
      void ensureServerReady()
        .then(() => log.info(`Server pre-warm completed in ${(performance.now() - warmStart).toFixed(0)}ms`))
        .catch((err) => log.warn("Server pre-warm failed (will retry on first engagement)", err))
    }

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
    initMethodology(context)

    // Server start is deferred to first engagement (see ensureServerReady wired to
    // the chat view below) so windows where OpenCode is never opened don't spawn a
    // server process. When the user does open the view it warms immediately, so they
    // still don't sit on a disconnected state while interacting.

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

    // ADR-010: Process pool + registry for per-session isolation.
    // In "shared" mode (default) the registry routes all tabs to the global sessionManager.
    // In "per-tab" mode each tab gets its own process + session manager.
    const processManager = new LocalSessionProcessManager()
    context.subscriptions.push(processManager)
    const sessionManagerRegistry = new SessionManagerRegistry(processManager)
    sessionManagerRegistry.setDefaultManager(sessionManager)
    // Provide cliSessionId lookup for crash restoration state
    sessionManagerRegistry.setTabCliSessionIdResolver((tabId) => sessionStore.get(tabId)?.cliSessionId)
    // Log process crashes — TabRestorationState is built by the host
    sessionManagerRegistry.onProcessCrash(({ processId, tabIds, timestamp }) => {
      log.warn(`Process ${processId} crashed at ${new Date(timestamp).toISOString()}, affected tabs: [${tabIds.join(", ")}]`)
      const states = sessionManagerRegistry.getCrashRestorationStates(processId)
      for (const state of states) {
        log.info(`Crash restoration queued for tab ${state.tabId} (session=${state.cliSessionId ?? "unknown"})`)
      }
      // G10: clean up the affected tabs' streaming state. Without this, a
      // crashed per-tab process leaves the webview showing "Stop" for up to
      // 45 minutes (STREAM_STUCK_MS). The chat provider's handler posts
      // streaming_state:false + stream_interrupted so the user gets an
      // immediate Resume/Dismiss affordance. No-op for tabs that weren't
      // streaming.
      if (chatProviderInstance) {
        try {
          chatProviderInstance.handleProcessCrash(processId, tabIds, timestamp)
        } catch (err) {
          log.error(`[G10] handleProcessCrash failed for process ${processId}`, err)
        }
      }
    })
    context.subscriptions.push(sessionManagerRegistry)

    // Chat provider
    chatProviderInstance = new ChatProvider(
      context, sessionManager, contextEngine, contextMonitor,
      themeManager, rateLimitMonitor, modelManager, sessionStore,
      checkpointManager, mcpServerManager, sessionManagerRegistry, configService
    )

    // Apply workspace config on initial load and on config file changes
    context.subscriptions.push(
      configService.onConfigChanged(() => {
        chatProviderInstance?.applyWorkspaceConfig()
      })
    )
    chatProviderInstance.applyWorkspaceConfig()

    // Warm the server the first time the chat view is resolved (user opened OpenCode).
    chatProviderInstance.setServerWarmup(() => {
      void ensureServerReady().catch((err) => log.warn("Lazy server start failed", err))
    })

    registerInlineProviders(context, chatProviderInstance)
    registerCoreCommands(context, sessionStore, sessionManager, modelManager, rateLimitMonitor, checkpointManager, cliDiagnostics, themeManager, terminalBridge, chatProviderInstance)
    registerChatProvider(context, chatProviderInstance)
    registerUriHandler(context, chatProviderInstance)
    wireRunningIndicator(context, connectionStatus, chatProviderInstance, sessionManager)

    const agentGaze = new AgentGazeService(sessionManager)
    context.subscriptions.push(agentGaze)

    const activationEnd = performance.now()
    log.info(
      `OpenCode Harness extension activated in ${(activationEnd - activationStart).toFixed(1)}ms` +
      ` (mcp=${(mcpCreatedAt - activationStart).toFixed(1)}ms,` +
      ` session=${(sessionMgrCreatedAt - mcpCreatedAt).toFixed(1)}ms,` +
      ` ctx=${(ctxReadyAt - sessionMgrCreatedAt!).toFixed(1)}ms,` +
      ` wiring=${(activationEnd - ctxReadyAt).toFixed(1)}ms)`,
    )
  } catch (err) {
    log.error("Extension activation failed", err)
    vscode.window.showErrorMessage(
      "OpenCode extension failed to activate. Check the OpenCode Harness output channel for details, then reload the window.",
      "Show Logs"
    ).then((action) => {
      if (action === "Show Logs") {
        log.outputChannel.show()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Initialization helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the opencode CLI is available, then start the server.
 *
 * Remote-attach mode talks to a server elsewhere and needs no local binary, so
 * we skip the install check there. Otherwise we honor the opencode.autoInstall
 * setting ("prompt" by default), and only start once a binary is available.
 */
async function ensureOpencodeAndStart(
  sessionManager: SessionManager,
  installer: OpencodeInstaller
): Promise<void> {
  const config = vscode.workspace.getConfiguration("opencode")
  const remoteUrl = (config.get<string>("serverUrl") || "").trim()
  if (remoteUrl.length === 0) {
    const mode = config.get<AutoInstallMode>("autoInstall", "prompt")
    const ready = await installer.ensureInstalled(mode)
    if (!ready) {
      log.warn("OpenCode CLI is not available; skipping server auto-start. Use 'OpenCode: Install CLI'.")
      return
    }
  }
  await sessionManager.start()
}

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
        "OpenCode is encountering repeated internal errors. Open the output channel to diagnose.",
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

function initModelManager(context: vscode.ExtensionContext, _sessionManager: SessionManager): ModelManager {
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
  connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.notConnected
  connectionStatus.command = "opencode-harness.openChat"
  connectionStatus.show()
  context.subscriptions.push(connectionStatus)

  sessionManager.subscribe("extension/connectionStatus", (event) => {
    switch (event.type) {
      case "server_connected":
        connectionStatus.text = "$(check-all) OpenCode: Connected"
        connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.connected(sessionManager.currentPort)
        connectionStatus.command = "opencode-harness.openChat"
        // Show a transient "Syncing..." state during the initial model
        // refresh so the user sees activity between connect and the model
        // list arriving. try/finally guarantees the indicator clears even
        // on refresh failure.
        connectionStatus.text = "$(sync~spin) OpenCode: Syncing..."
        connectionStatus.tooltip = "Synchronizing model list from opencode server..."
        void (async () => {
          try {
            await modelManager.refreshModels(sessionManager.currentPort, sessionManager.authHeader)
          } catch (err) {
            log.warn("Refresh models on connect failed", err)
          } finally {
            connectionStatus.text = "$(check-all) OpenCode: Connected"
            connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.connected(sessionManager.currentPort)
          }
        })()
        // Persist port for potential reuse after reload
        context.globalState.update('opencode-server-port', sessionManager.currentPort)
        break
      case "server_disconnected":
        connectionStatus.text = "$(circle-slash) OpenCode: Not connected"
        connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.disconnected
        connectionStatus.command = "opencode-harness.openChat"
        // Invalidate stale CLI session IDs so next prompt creates fresh server sessions
        sessionStore.invalidateAllCliSessionIds()
        // Clear persisted port
        context.globalState.update('opencode-server-port', undefined)
        break
      case "server_error":
        connectionStatus.text = "$(error) OpenCode: Connection error"
        connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.error
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

/**
 * Surface "what is running" on the connection status bar item: while any tab
 * streams, the item shows a spinner + count and clicking it jumps to the
 * running session (Quick Pick when several). When streaming stops, the item
 * reverts to the plain connection state. The connection-event subscription in
 * initConnectionStatusBar keeps owning connect/disconnect/error transitions.
 */
function wireRunningIndicator(
  context: vscode.ExtensionContext,
  connectionStatus: vscode.StatusBarItem,
  chatProvider: ChatProvider,
  sessionManager: SessionManager
): void {
  let wasRunning = false
  const update = () => {
    const count = chatProvider.getStreamingSessionIds().length
    if (count > 0) {
      wasRunning = true
      connectionStatus.text = `$(sync~spin) OpenCode: ${count} running`
      connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.running(count)
      connectionStatus.command = "opencode-harness.jumpToRunningTask"
      return
    }
    if (!wasRunning) return
    wasRunning = false
    if (sessionManager.isRunning) {
      connectionStatus.text = "$(check-all) OpenCode: Connected"
      connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.connected(sessionManager.currentPort)
    } else {
      connectionStatus.text = "$(circle-slash) OpenCode: Not connected"
      connectionStatus.tooltip = STATUS_BAR_TOOLTIPS.connection.disconnected
    }
    connectionStatus.command = "opencode-harness.openChat"
  }
  context.subscriptions.push(chatProvider.onStreamingStateChanged(() => update()))
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
        vscode.window.showWarningMessage("OpenCode: No code selected — sending the entire file instead.")
      }
      const text = editor.document.getText(selection)
      if (!text.trim()) {
        vscode.window.showWarningMessage("OpenCode: No code found to send — make sure the editor has content.")
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
      vscode.window.showErrorMessage(`OpenCode: Could not ${verb} the selected code. Check the output channel for details.`)
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
  registerNewSessionCommand(context, sessionStore, {
    openSessionInWebview: (sessionId) => chatProvider.openSessionInWebview(sessionId),
  })
  registerOpenStoredSessionCommand(context, sessionStore)
  registerToggleFocusCommand(context)
  registerInsertMentionCommand(context)
  registerShowRateLimitsCommand(context, rateLimitMonitor)
  registerSelectModelCommand(context, modelManager, sessionManager, sessionStore)
  registerSetContextWindowOverrideCommand(context)
  registerCheckCliCommand(context, sessionManager, cliDiagnostics)
  registerListSessionsCommand(context, sessionStore, {
    openSessionInWebview: (sessionId) => chatProvider.openSessionInWebview(sessionId),
    getStreamingSessionIds: () => chatProvider.getStreamingSessionIds(),
  })
  registerJumpToRunningTaskCommand(context, sessionStore, {
    getStreamingSessionIds: () => chatProvider.getStreamingSessionIds(),
    openSessionInWebview: (sessionId) => chatProvider.openSessionInWebview(sessionId),
  })
  registerDeleteSessionCommand(context, sessionStore)
  registerRenameSessionCommand(context, sessionStore)
  registerClearTestSessionsCommand(context, sessionStore, sessionManager)
  registerContinueLastSessionCommand(context, sessionStore)
  registerChooseHistorySessionCommand(context, sessionStore, sessionManager)
  registerAttachRemoteCommand(context, sessionManager)
  registerExportCommand(context, sessionExporter, sessionStore)
  registerImportCommand(context, sessionStore)
  registerAddFileToSessionCommand(context, chatProvider)
  registerAddSelectionToSessionCommand(context, chatProvider)
  registerStopCommand(context, chatProvider)
  registerSlashCommandShortcuts(context, chatProvider)
  registerGenerateAgentsMdCommand(context)
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setupVoiceInput", () => {
      void chatProvider.setupVoiceInput().catch((err) => log.error("setupVoiceInput command failed", err))
    })
  )

  // Mode switching commands
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.cycleMode", () => {
      try {
        chatProvider.cycleMode()
      } catch (err) {
        log.error("cycleMode command failed", err)
      }
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setBuildMode", () => {
      try {
        chatProvider.setModeForActiveSession("build")
      } catch (err) {
        log.error("setBuildMode command failed", err)
      }
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setPlanMode", () => {
      try {
        chatProvider.setModeForActiveSession("plan")
      } catch (err) {
        log.error("setPlanMode command failed", err)
      }
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setAutoMode", () => {
      try {
        chatProvider.setModeForActiveSession("auto")
      } catch (err) {
        log.error("setAutoMode command failed", err)
      }
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.setDefaultMode", () => {
      try {
        void vscode.commands.executeCommand("workbench.action.openSettings", "opencode.defaultMode")
      } catch (err) {
        log.error("setDefaultMode command failed", err)
      }
    })
  )
  // No-op "suppressor": claims a key so VS Code's default for it does NOT fire
  // while the chat webview is focused (gated by `opencodeHarness.chatFocused` in
  // package.json keybindings). The webview's own keydown handler performs the
  // real action; this only stops the workbench from ALSO acting on the forwarded
  // key (vscode#241801) — e.g. Alt+1 switching mode instead of opening editor 1.
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.suppressKey", () => {
      /* intentionally empty — see comment above */
    })
  )

  // Tab navigation commands
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.nextTab", () => {
      try {
        chatProvider.nextTab()
      } catch (err) {
        log.error("nextTab command failed", err)
      }
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.prevTab", () => {
      try {
        chatProvider.prevTab()
      } catch (err) {
        log.error("prevTab command failed", err)
      }
    })
  )

  // Retry last failed run
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.retryLast", () => {
      try {
        chatProvider.retryLast()
      } catch (err) {
        log.error("retryLast command failed", err)
      }
    })
  )

  // Open OpenCode settings
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openSettings", () => {
      try {
        chatProvider.openSettings()
      } catch (err) {
        log.error("openSettings command failed", err)
      }
    })
  )
}

function initMethodology(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const methConfig = vscode.workspace.getConfiguration('opencode.methodology')

  outcomeTracker = new OutcomeTracker(
    context.globalState.get('opencode-methodology-outcomes') as import('./methodology').OutcomeEvent[] | undefined
  )
  outcomeTracker.setPersistenceFn((events) => {
    void context.globalState.update('opencode-methodology-outcomes', events)
  })

  // Only `enabled` remains user-configurable. The cascade/validation settings
  // that used to be read here were removed from package.json — they fed a
  // pipeline (CascadeRouter/QualityGate/SchemaValidator) that never runs
  // against real prompts; exposing knobs that do nothing misleads users.
  methodologyOrchestrator = new MethodologyOrchestrator({
    config: {
      enabled: methConfig.get<boolean>('enabled', true),
    },
  })

  setMethodologyOrchestrator(methodologyOrchestrator)

  methodologyOrchestrator.getCatalog().setOutcomeTracker(outcomeTracker)

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
  statusItem.name = 'OpenCode Methodology'
  statusItem.text = '$(lightbulb) —'
  statusItem.tooltip = STATUS_BAR_TOOLTIPS.methodology.idle
  statusItem.command = {
    command: 'workbench.action.openSettings',
    title: 'Open Settings',
    arguments: ['opencode.methodology'],
  }
  statusItem.show()
  context.subscriptions.push(statusItem)
  methodologyStatusItem = statusItem
  setMethodologyStatusUpdater(updateMethodologyStatusImpl)

  return statusItem
}

function updateMethodologyStatusImpl(info: MethodologyStatusInfo): void {
  if (!methodologyStatusItem) return
  methodologyStatusItem.text = `$(lightbulb) ${info.label} · ${info.recommendedTier}`
  const confPct = (info.confidence * 100).toFixed(0)
  methodologyStatusItem.tooltip = STATUS_BAR_TOOLTIPS.methodology.active(
    info.label,
    info.recommendedTier,
    confPct,
    `Task type: ${info.taskType} · Strategy: ${info.strategy}`,
  )
}

export function updateMethodologyStatus(info: MethodologyStatusInfo): void {
  updateMethodologyStatusImpl(info)
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
