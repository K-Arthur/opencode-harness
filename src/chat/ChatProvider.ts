import * as vscode from "vscode"
import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { ContextEngine } from "../context/ContextEngine"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { UsageAnalytics } from "../monitor/UsageAnalytics"
import { ThemeManager } from "../theme/ThemeManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { ModelManager } from "../model/ModelManager"
import { CheckpointManager } from "../checkpoint/CheckpointManager"
import { DiffApplier } from "../diff/DiffApplier"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { WebviewContent } from "./WebviewContent"
import { TabManager } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import { PromptManager, PromptCommand } from "../prompts/PromptManager"
import { PromptStashManager } from "../prompts/PromptStashManager"
import { ProviderConfigManager } from "../model/ProviderConfigManager"
import { toUserErrorMessage as toUserErrorMessagePure, errorValueToMessage as errorValueToMessagePure, mapToolType as mapToolTypePure, isSessionInCurrentWorkspace as isSessionInCurrentWorkspacePure } from "./chatUtils"
import { ChatMessage } from "./types"
import { log } from "../utils/outputChannel"
import { MessageRouter } from "./handlers/MessageRouter"
import { ChatCommands } from "./ChatCommands"
import { AutoCompactor } from "./AutoCompactor"
import { ChatFileOps } from "./ChatFileOps"
import { ChunkBatcher } from "./ChunkBatcher"
import { McpServerManager } from "../mcp/McpServerManager"
import { ThemeController } from "./ThemeController"
import { StatePushService } from "./StatePushService"
import { SessionLifecycleService } from "./SessionLifecycleService"
import { CommandExecutionService } from "./CommandExecutionService"
import { WebviewEventRouter } from "./WebviewEventRouter"
import { SteerPromptHandler } from "./handlers/SteerPromptHandler"

export class ChatProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view?: vscode.WebviewView
  private diffApplier = new DiffApplier()
  private disposables: vscode.Disposable[] = []
  private webviewContent: WebviewContent
  private tabManager: TabManager
  private streamCoordinator: StreamCoordinator
  private messageRouter: MessageRouter
  private promptManager: PromptManager
  private pendingPrompt?: { text: string; autoSend: boolean }
  private pendingOpenSessionId?: string
  private chatCommands: ChatCommands
private autoCompactor: AutoCompactor
  // EC7: Track in-progress backfills to prevent concurrent requests
  private backfillInProgress = new Set<string>()
  private backfillRetryTimer?: NodeJS.Timeout
  private readonly BACKFILL_RETRY_DELAYS_MS = [1500, 4000]
  private fileOps = new ChatFileOps()
  private themeController: ThemeController
  private statePush: StatePushService
  private sessionLifecycle: SessionLifecycleService
  private commandExec: CommandExecutionService
  private eventRouter: WebviewEventRouter
  private restoredTabsHydrated = false
  private usageAnalytics: UsageAnalytics
  private steerPromptHandler: SteerPromptHandler
  private promptStashManager: PromptStashManager
  private providerConfigManager: ProviderConfigManager

  

  /** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
  private chunkBatcher = new ChunkBatcher(
    (msg) => { this._view?.webview.postMessage(msg) },
    (msg) => log.info(msg),
  )

  /** P2: Retry queue for critical messages with exponential backoff */
  private messageRetryQueue: Array<{ msg: Record<string, unknown>; attempts: number; lastAttempt: number }> = []
  /**
   * O3: Stream lifecycle messages must arrive in order. Adding the start/tool messages here means
   * a failed start no longer races ahead of a subsequent batched stream_chunk for the same session.
   */
  private static readonly CRITICAL_MESSAGE_TYPES = new Set([
    "stream_start", "stream_end", "stream_chunk", "stream_tool_start", "stream_tool_end", "stream_tool_update",
    "stream_error", "streaming_state",
    "error", "webview_ready", "request_error",
  ])
  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_DELAYS_MS = [100, 500, 1000] // Exponential backoff
  private retryTimer?: NodeJS.Timeout

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly themeManager: ThemeManager,
    private readonly rateLimitMonitor: RateLimitMonitor,
    private readonly modelManager: ModelManager,
    private readonly sessionStore: SessionStore,
    private readonly checkpointManager: CheckpointManager,
    private readonly mcpServerManager: McpServerManager,
  ) {
    this.webviewContent = new WebviewContent(context.extensionUri)
    this.tabManager = new TabManager(context.globalState)
    this.streamCoordinator = new StreamCoordinator(
      sessionManager, sessionStore, contextEngine, contextMonitor, modelManager, this.tabManager, rateLimitMonitor, this.diffApplier
    )
    this.promptManager = new PromptManager()
    this.promptManager.scanWorkspace()
    this.promptManager.watchPrompts()
    this.promptManager.onChanged(() => this.pushCommandListToWebview())
    this.messageRouter = new MessageRouter(sessionManager, modelManager)
    this.chatCommands = new ChatCommands(sessionStore, sessionManager, this.tabManager, this.streamCoordinator)
    this.autoCompactor = new AutoCompactor(sessionManager, sessionStore, contextMonitor, this.tabManager)
    this.usageAnalytics = new UsageAnalytics()
    this.usageAnalytics.setHistory(contextMonitor.getHistory())
    this.promptStashManager = new PromptStashManager({ context })
    this.providerConfigManager = new ProviderConfigManager({ context })
    this.modelManager.setProviderConfigManager(this.providerConfigManager)
    this.steerPromptHandler = new SteerPromptHandler(
      this.streamCoordinator,
      this.sessionStore,
    )
    this.themeController = new ThemeController(themeManager, (msg) => this.postMessage(msg))
    this.statePush = new StatePushService({
      postMessage: (msg) => this.postMessage(msg),
      tabManager: this.tabManager,
      sessionStore: this.sessionStore,
    })
    this.sessionLifecycle = new SessionLifecycleService({
      tabManager: this.tabManager,
      sessionStore: this.sessionStore,
      sessionManager,
      diffApplier: this.diffApplier,
      statePush: this.statePush,
      streamCoordinator: this.streamCoordinator,
      autoCompactor: this.autoCompactor,
      checkpointManager: this.checkpointManager,
      showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
      showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
      showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
    })

    this.commandExec = new CommandExecutionService({
      tabManager: this.tabManager,
      streamCoordinator: this.streamCoordinator,
      statePush: this.statePush,
      sessionManager,
      sessionStore: this.sessionStore,
      promptManager: this.promptManager,
      chatCommands: this.chatCommands,
      showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
      postMessage: (msg) => this.postMessage(msg),
      postRequestError: (message, sessionId) => this.postRequestError(message, sessionId),
      sendPromptToWebview: (text, autoSend) => this.sendPromptToWebview(text, autoSend),
    })

    // Hook into tab creation to backfill tabs that need it
    this.tabManager.onTabCreated((tabId) => {
      log.info(`[tab_created] Tab created: ${tabId}, checking if backfill needed`)
      this.backfillTabIfNeeded(tabId).catch(err => log.error(`Failed to backfill tab ${tabId} on creation`, err))
    })

    this.eventRouter = new WebviewEventRouter({
      tabManager: this.tabManager,
      statePush: this.statePush,
      sessionLifecycle: this.sessionLifecycle,
      commandExec: this.commandExec,
      sessionStore: this.sessionStore,
      sessionManager: this.sessionManager,
      modelManager: this.modelManager,
      diffApplier: this.diffApplier,
      streamCoordinator: this.streamCoordinator,
      messageRouter: this.messageRouter,
      autoCompactor: this.autoCompactor,
      checkpointManager: this.checkpointManager,
      mcpServerManager: this.mcpServerManager,
      themeManager: this.themeManager,
      themeController: this.themeController,
      promptManager: this.promptManager,
      fileOps: this.fileOps,
      contextMonitor: this.contextMonitor,
      usageAnalytics: this.usageAnalytics,
      steerPromptHandler: this.steerPromptHandler,
      postMessage: (msg) => this.postMessage(msg),
      postRequestError: (message, sessionId) => this.postRequestError(message, sessionId),
      showWarningMessage: (message, options, ...items) => vscode.window.showWarningMessage(message, options, ...items),
      showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
      showErrorMessage: (message) => vscode.window.showErrorMessage(message),
      openExternal: (uri) => vscode.env.openExternal(uri),
      handleEditMessage: (s, mId, text) => this.handleEditMessage(s, mId, text),
      handleInsertAtCursor: (code, lang) => this.handleInsertAtCursor(code, lang),
      handleCreateFileFromCode: (code, lang) => this.handleCreateFileFromCode(code, lang),
      handleServerEvent: (e) => this.handleServerEvent(e),
      ensureLocalTab: (sId, name, model, mode) => this.ensureLocalTab(sId, name, model, mode),
      handleConnectProvider: () => this.handleConnectProvider(),
      openOpenCodeConfigOrSettings: () => this.openOpenCodeConfigOrSettings(),
      hasAutoModeConfirmed: () => this.hasAutoModeConfirmed(),
      showAutoModeConfirmation: (sid) => this.showAutoModeConfirmation(sid),
      replayLiveStreamsToWebview: () => this.replayLiveStreamsToWebview(),
      exportChat: () => { void vscode.commands.executeCommand("opencode-harness.exportConversation") },
      exportChatJson: () => { void vscode.commands.executeCommand("opencode-harness.exportConversationJson") },
      exportChatText: () => { void vscode.commands.executeCommand("opencode-harness.exportConversationText") },
      copyChat: () => { void vscode.commands.executeCommand("opencode-harness.copyConversation") },
      stashPrompt: (name, content, isGlobal) => { this.handleStashPrompt(name, content, isGlobal) },
      listStashes: () => { this.handleListStashes() },
      deleteStash: (id) => { this.handleDeleteStash(id) },
      addProvider: (name, apiKey, baseUrl) => { this.handleAddProvider(name, apiKey, baseUrl) },
      listProviders: () => { this.handleListProviders() },
      updateProvider: (id, updates) => { this.handleUpdateProvider(id, updates) },
      deleteProvider: (id) => { this.handleDeleteProvider(id) },
      showOpenFolderDialog: (dir) => { void vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir)) },
    })

    // Subscribe to session store changes to keep webview and server in sync
    this.sessionStore.onDidChangeSession((change) => {
      switch (change.kind) {
        case "deleted":
          this.tabManager.closeTab(change.sessionId)
          this.postMessage({ type: "session_deleted", sessionId: change.sessionId })
          // Also delete from server if there's a cliSessionId
          const s = this.sessionStore.get(change.sessionId)
          const cliId = this.tabManager.getTab(change.sessionId)?.cliSessionId || s?.cliSessionId
          if (cliId && this.sessionManager.isRunning) {
            void this.sessionManager.deleteSession(cliId).catch(err =>
              log.warn(`Server-side session delete failed for ${cliId}`, err)
            )
          }
          break
        case "renamed":
          this.postMessage({ type: "session_renamed", sessionId: change.sessionId, name: change.name })
          break
      }
    })
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // H16: Dispose old disposables from previous webview resolve to prevent memory leak
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* individual dispose failure should not block others */ }
    }
    this.disposables = []

    // Clear any pending chunk buffer and timer from previous webview instance
    this.chunkBatcher.dispose()

    // P2: Clear retry queue on webview recreation
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.messageRetryQueue = []

    this._view = webviewView
    // H15: Reset ready state on re-solve to handle webview recreation
    this.eventRouter.webviewReady = false
    this.eventRouter.startReadyTimeout()

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "chat", "webview"),
        vscode.Uri.joinPath(this.context.extensionUri, "src", "chat", "webview"),
      ],
    }

    webviewView.webview.html = this.webviewContent.build(webviewView.webview, this.themeManager)

    // State will be pushed when webview sends 'webview_ready' message

    // Subscriptions
    this.disposables.push(
      this.modelManager.onModelChanged((model) => {
        this.pushModelToWebview(model)
        const ctxWindow = this.modelManager.getContextWindow(model)
        if (ctxWindow) {
          const override = vscode.workspace.getConfiguration("opencode").get<number>("contextWindowOverride", 0)
          this.contextMonitor.setTokenLimit(override > 0 ? override : ctxWindow)
        }
      }),
      this.modelManager.onModelsRefreshed(() => {
        this.pushModelListToWebview()
        const ctxWindow = this.modelManager.getContextWindow()
        if (ctxWindow) {
          const override = vscode.workspace.getConfiguration("opencode").get<number>("contextWindowOverride", 0)
          this.contextMonitor.setTokenLimit(override > 0 ? override : ctxWindow)
        }
      }),
      this.themeManager.onThemeChanged(() => this.themeController.pushThemeToWebview()),
      this.rateLimitMonitor.onStateChanged(() => this.pushRateLimitStateToWebview()),
      this.rateLimitMonitor.onReset(() => this.pushRateLimitStateToWebview()),
      this.rateLimitMonitor.onWarning((msg) => vscode.window.showWarningMessage(msg)),
      this.sessionStore.onActiveSessionChanged(() => this.syncActiveSession()),
      this.sessionManager.subscribe("ChatProvider/handleServerEvent", (event) => this.handleServerEvent(event)),
this.tabManager.onStreamingStateChanged(({ tabId, isStreaming }) => {
        this.postMessage({ type: "streaming_state", sessionId: tabId, isStreaming })
      }),
      this.tabManager.onInstructionsChanged(({ tabId, instructions }) => {
        this.postMessage({ type: "instructions_changed", sessionId: tabId, instructions })
      }),
      this.contextMonitor.onContextChanged?.((usage) => {
        this.postMessage({
          type: "context_usage",
          percent: usage.percent,
          tokens: usage.tokens,
          maxTokens: usage.maxTokens,
          sessionId: usage.sessionId,
          breakdown: usage.breakdown,
        })
        if (usage.percent >= 80) {
          this.autoCompactor.tryCompactIfNeeded({
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        }
      })
    )

    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (!webviewView.visible || !this.eventRouter.webviewReady) return
        this.pushVisibleStateToWebview()
      })
    )

    // Webview message handler
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
        // I8: rule #20 — origin guard. If the bound view has been replaced (re-resolve) or
        // disposed, ignore stale messages from the old listener instead of mutating fresh state.
        if (this._view !== webviewView) {
          log.warn(`Discarding webview message from stale view; type=${typeof msg?.type === "string" ? msg.type : "?"}`)
          return
        }
        try {
          await this.handleWebviewMessage(msg)
        } catch (err) {
          // I1: handler exceptions used to be swallowed silently — the webview would spin
          // forever waiting for a response. Echo a webview_request_error envelope back so
          // the UI can surface the failure and unblock the affected control.
          log.error("Error handling webview message", err)
          const requestType = typeof msg?.type === "string" ? msg.type : "unknown"
          const requestId = typeof msg?.requestId === "string" ? msg.requestId : undefined
          const sessionId = typeof msg?.sessionId === "string" ? msg.sessionId : undefined
          try {
            this.postMessage({
              type: "webview_request_error",
              requestType,
              requestId,
              sessionId,
              error: err instanceof Error ? err.message : String(err),
            })
          } catch (postErr) {
            log.warn("Failed to post webview_request_error", postErr)
          }
        }
      })
    )

    webviewView.onDidDispose(() => {
      this._view = undefined
      this.eventRouter.webviewReady = false
      // O4: Dispose the batcher and clear retry/early state so nothing fires on the dead view.
      try { this.chunkBatcher.dispose() } catch (err) { log.warn("ChunkBatcher dispose on view disposal failed", err) }
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = undefined
      }
      this.messageRetryQueue = []
      this.eventRouter.clearReadyTimeout()
      this.eventRouter.earlyMessageQueue = []
      // Abort any active streams when the panel is closed
      for (const t of this.tabManager.getAllTabs()) {
        if (t.isStreaming) {
          void this.streamCoordinator.abort(t.id, {
            postMessage: () => {},
            postRequestError: () => {},
          }).catch(err => log.warn("Abort on panel dispose failed", err))
        }
      }
      log.info("Chat webview disposed")
    })

    log.info("Chat webview resolved")
  }

  private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
    await this.eventRouter.route(msg)
  }

  private async openOpenCodeConfigOrSettings(): Promise<void> {
    try {
      await this.mcpServerManager.openPrimaryConfigFile()
    } catch (err) {
      log.warn("Failed to open OpenCode config, falling back to extension settings", err)
      await vscode.commands.executeCommand("workbench.action.openSettings", "opencode")
    }
  }

  private async handleConnectProvider(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      "Configure OpenCode providers in your OpenCode config, then refresh the model list.",
      "Open Config",
      "Refresh Models",
      "Provider Docs"
    )
    if (action === "Open Config") {
      await this.openOpenCodeConfigOrSettings()
    } else if (action === "Refresh Models") {
      await this.modelManager.refreshModels(this.sessionManager.currentPort, this.sessionManager.authHeader)
      this.pushModelListToWebview()
    } else if (action === "Provider Docs") {
      await vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/docs/providers/"))
    }
  }

  sendPromptToWebview(text: string, autoSend = true): void {
    if (!this._view) {
      this.pendingPrompt = { text, autoSend }
      return
    }
    this.postMessage({ type: "prefill_prompt", text, autoSend })
  }

  async openSessionInWebview(sessionId: string): Promise<void> {
    if (!this._view) {
      this.eventRouter.pendingOpenSessionId = sessionId
      return
    }
    if (!this.eventRouter.webviewReady) {
      this.eventRouter.pendingOpenSessionId = sessionId
      return
    }
    return this.sessionLifecycle.openSessionInWebview(sessionId)
  }

  private ensureLocalTab(sessionId: string, name?: string, model?: string, mode?: string): void {
    // Pass an empty name when the caller didn't supply one — the display
    // layer renders "Untitled session" until the first prompt produces a
    // real title (matches opencode CLI behaviour).
    const storeSession = this.sessionStore.ensure(
      sessionId,
      name?.trim() || "",
      model,
      mode || "normal"
    )
    if (!this.tabManager.getTab(sessionId)) {
      this.tabManager.createTab(sessionId, storeSession.cliSessionId, storeSession.model || model, storeSession.mode || mode)
    }
  }

  private async handleResumeSession(sessionId: string): Promise<void> {
    return this.sessionLifecycle.handleResumeSession(sessionId)
  }

  private async handleAttachFiles(): Promise<void> {
    return this.sessionLifecycle.handleAttachFiles()
  }

  private handleAttachImage(sessionId: string, data: string, mimeType: string): void {
    return this.sessionLifecycle.handleAttachImage(sessionId, data, mimeType)
  }

  private async handleCompactSession(sessionId?: string): Promise<void> {
    return this.sessionLifecycle.handleCompactSession(sessionId)
  }

  private async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
    return this.commandExec.handleExecuteCommand(sessionId, command, args)
  }

  private async handleLocalSlashCommand(sessionId: string, commandName: string): Promise<boolean> {
    return this.commandExec.handleLocalSlashCommand(sessionId, commandName)
  }

  private async handleListCommands(): Promise<void> {
    try {
      const customCommands = this.promptManager.getPromptCommands()
      if (!this.sessionManager.isRunning) {
        this.postMessage({ type: "command_list", commands: customCommands, showInChat: true })
        return
      }
      const commands = await this.sessionManager.listCommands()
      this.postMessage({ type: "command_list", commands: [...customCommands, ...commands], showInChat: true })
    } catch (err) {
      log.warn("Failed to list commands", err)
      const customCommands = this.promptManager.getPromptCommands()
      this.postMessage({ type: "command_list", commands: customCommands, showInChat: true })
    }
  }

  private autoCompactIfIdle(): void {
    this.autoCompactor.tryCompactIfNeeded({
      postMessage: (m) => this.postMessage(m),
      postRequestError: (m) => this.postRequestError(m),
    })
  }

  // ---------------------------------------------------------------------------
  // Server event handler map - for lower complexity in handleServerEvent
  // ---------------------------------------------------------------------------

  private readonly serverEventHandlers: Map<string, (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => void | Promise<void>> = new Map([
    ["tool_start", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { id?: string; tool?: string; input?: unknown; status?: string } | undefined
      const targetId = tab?.id || tabId
      if (!targetId) return
      
      this.streamCoordinator.appendToolStart(targetId, {
        id: data?.id,
        name: data?.tool || "unknown",
        class: this.mapToolType(data?.tool || ""),
        args: data?.input,
        state: data?.status,
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["tool_update", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { id?: string; tool?: string; input?: unknown; status?: string } | undefined
      const targetId = tab?.id || tabId
      if (!targetId) return

      this.streamCoordinator.appendToolUpdate(targetId, {
        id: data?.id,
        name: data?.tool || "unknown",
        class: this.mapToolType(data?.tool || ""),
        args: data?.input,
        state: data?.status,
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["tool_end", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { id?: string; tool?: string; ok?: boolean; result?: unknown; durationMs?: number } | undefined
      const targetId = tab?.id || tabId
      if (!targetId) return

      const toolCallId = data?.id || "unknown"
      const resultStr = typeof data?.result === "string" ? data.result : JSON.stringify(data?.result ?? "")

      this.streamCoordinator.appendToolEnd(targetId, {
        id: toolCallId,
        ok: typeof data?.ok === "boolean" ? data.ok : true,
        result: resultStr,
        durationMs: data?.durationMs
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["skill_load", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { skill?: string; name?: string; id?: string } | undefined
      const targetId = tabId
      this.streamCoordinator.appendSkill(targetId, data?.skill || data?.name || data?.id || "skill", {
        postMessage: (m) => this.postMessage(m),
        postRequestError: (m) => this.postRequestError(m)
      })
    }],
    ["text_chunk", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { text?: string; messageId?: string } | undefined
      if (data?.text) {
        const targetId = tab?.id || tabId
        if (!targetId) {
          log.warn(`text_chunk for unknown session ${event.sessionId} — dropping chunk`)
          return
        }
        try { this.streamCoordinator.appendChunk(targetId, data.text, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }, data.messageId) } catch (err) { log.error("Error appending text chunk", err) }
      }
    }],
    ["message_complete", async (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      if (tab) {
        await this.streamCoordinator.maybeFinalizeStream(tab.id, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m),
        }, "message_complete").catch(err => log.error("maybeFinalizeStream failed", err))
      }
    }],
    ["session_status", async (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean; waitingForCompletion?: boolean }) => {
      const data = event.data as { status?: { type?: string } | undefined; errorContext?: unknown } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status, errorContext: data?.errorContext })

      // Fallback finalization. If the server reports any non-busy terminal status
      // ("idle", "ready", "completed", "done") while we're still waiting for completion,
      // finalize. This catches cases where message_complete is missed AND the server
      // emits a status name we didn't anticipate.
      if (rawStatus !== "busy" && rawStatus !== "thinking" && rawStatus !== "unknown" && tab?.waitingForCompletion) {
        log.info(`session_status: terminal status "${rawStatus}" while tab ${tabId} is waiting — triggering fallback finalization`)
        await this.streamCoordinator.maybeFinalizeStream(tab.id, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m)
        }, "status").catch(err => log.error("Fallback maybeFinalizeStream failed", err))
      }
    }],
    ["server_status", async (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean; waitingForCompletion?: boolean }) => {
      const data = event.data as { status?: { type?: string } | undefined; errorContext?: unknown } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status, errorContext: data?.errorContext })

      if (rawStatus !== "busy" && rawStatus !== "thinking" && rawStatus !== "unknown" && tab?.waitingForCompletion) {
        log.info(`server_status: terminal status "${rawStatus}" while tab ${tabId} is waiting — triggering fallback finalization`)
        await this.streamCoordinator.maybeFinalizeStream(tab.id, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m)
        }, "status").catch(err => log.error("Fallback maybeFinalizeStream failed", err))
      }
    }],
    ["permission_request", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { id?: string; title?: string; type?: string } | undefined
      this.postMessage({ type: "permission_request", sessionId: tabId, permissionId: data?.id, title: data?.title || `Allow ${data?.type || "action"}?` })
    }],
    ["permission_replied", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => { log.info(`Permission response for ${tabId}`) }],
    ["todo_updated", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { todos?: unknown[] } | undefined
      this.postMessage({ type: "todos_update", sessionId: tabId, todos: data?.todos ?? [] })
    }],
    ["file_edited", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      if (!tab?.isStreaming) return
      const data = event.data as { file?: string; files?: string[] } | undefined
      const file = data?.file || (Array.isArray(data?.files) && data.files[0])
      if (file) this.postMessage({ type: "file_edited", sessionId: tabId, file })
    }],
    ["thinking", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { text?: string } | undefined
      this.postMessage({ type: "message", sessionId: tabId, message: { role: "system", blocks: [{ type: "thinking", text: data?.text || "" }], timestamp: Date.now(), sessionId: tabId } })
    }],
    ["session_compacted", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => { log.info(`Session compacted for ${tabId}`); this.postMessage({ type: "session_compacted", sessionId: tabId }) }],
    ["step_finish", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }; cost?: number } | undefined
      if (data?.tokens) {
        const t = data.tokens
        const usage = {
          prompt: t.input ?? 0,
          completion: t.output ?? 0,
          reasoning: t.reasoning ?? 0,
          cacheRead: t.cacheRead ?? 0,
          cacheWrite: t.cacheWrite ?? 0,
          total: (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
        }
        this.sessionStore.accumulateTokenUsage(tabId, usage)
        if (typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost > 0) {
          this.sessionStore.accumulateCost(tabId, data.cost)
        }
        this.postMessage({
          type: "step_tokens",
          sessionId: tabId,
          tokens: { input: usage.prompt, output: usage.completion, reasoning: usage.reasoning, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
          cost: data.cost ?? 0,
        })
      }
    }],
    ["server_error", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { error?: unknown } | undefined
      const errorMsg = this.errorValueToMessage(data?.error ?? event.data ?? "Server error")
      log.error("Server error during streaming", errorMsg)
      if (tab) {
        this.postRequestError(errorMsg, tab.id)
        this.tabManager.setStreaming(tab.id, false)
        this.tabManager.setWaitingForCompletion(tab.id, false)
        this.tabManager.clearCompletionTimeout(tab.id)
      } else {
        // Route to active tab only if it's actually streaming
        const activeTab = this.tabManager.getActiveTab()
        if (activeTab && activeTab.isStreaming) {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — routing to active tab ${activeTab.id}`)
          this.postRequestError(errorMsg, activeTab.id)
          this.tabManager.setStreaming(activeTab.id, false)
          this.tabManager.setWaitingForCompletion(activeTab.id, false)
          this.tabManager.clearCompletionTimeout(activeTab.id)
        } else if (activeTab) {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — active tab ${activeTab.id} is not streaming, skipping state reset`)
          this.postRequestError(errorMsg, activeTab.id)
        } else {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — no active tab, dropping`)
        }
      }
    }],
    ["server_disconnected", () => {
      log.info("Server disconnected — resetting all streaming states")
      for (const t of this.tabManager.getAllTabs()) {
        if (t.isStreaming) {
          this.tabManager.setStreaming(t.id, false)
          this.tabManager.setWaitingForCompletion(t.id, false)
          this.tabManager.clearCompletionTimeout(t.id)
          this.postMessage({ type: "streaming_state", sessionId: t.id, isStreaming: false })
        }
      }
      this.postRequestError("OpenCode server connection lost. Attempting to reconnect...")
    }],
    ["server_connected", () => { this.pushModelListToWebview() }],
    ["event_stream_reconnected", () => {
      log.info("Event stream reconnected — reconciling active streaming sessions")
      for (const t of this.tabManager.getAllTabs()) {
        if (t.isStreaming) {
          this.streamCoordinator.reconcileAfterReconnect(t.id, {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          }).catch(err => log.error("Reconcile after reconnect failed", err))
        }
      }
    }],
    ["sessions_recovered", async () => {
      log.info("sessions_recovered: re-pushing init state with recovered sessions")
      this.restoredTabsHydrated = false
      const all = this.sessionStore.list()
      this.pushInitStateToWebview()
      this.postSessionListUpdate(all)

      if (await this.backfillRecoveredSessions(all)) {
        this.restoredTabsHydrated = false
        this.pushInitStateToWebview()
        this.postSessionListUpdate(this.sessionStore.list())
      }
    }],
  ])

  private async backfillRecoveredSessions(sessions: import("../session/SessionStore").OpenCodeSession[], isRetry: boolean = false): Promise<boolean> {
    const sessionsNeedingBackfill = sessions
      .filter((s) => s.needsBackfill === true && s.cliSessionId && s.messages.length === 0)
      .slice(0, 10)

    // Log why other tabs weren't backfilled
    const tabs = this.tabManager.getAllTabs()
    for (const tab of tabs) {
      const s = this.sessionStore.get(tab.id)
      if (s && s.cliSessionId && !sessionsNeedingBackfill.some((sb) => sb.id === s.id)) {
        log.info(`[sessions_recovered] Tab ${tab.id} not backfilled: needsBackfill=${s.needsBackfill}, messages.length=${s.messages.length}`)
      } else if (s && !s.cliSessionId) {
        log.info(`[sessions_recovered] Tab ${tab.id} has no cliSessionId`)
      }
    }

    let didBackfill = false
    if (sessionsNeedingBackfill.length > 0) {
      log.info(`[sessions_recovered] Auto-backfilling ${sessionsNeedingBackfill.length} recent sessions`)
    }

    for (const session of sessionsNeedingBackfill) {
      // EC7: Skip if backfill is already in progress for this session
      if (this.backfillInProgress.has(session.id)) {
        log.info(`[sessions_recovered] Skipping backfill for ${session.id} because backfill is already in progress`)
        continue
      }

      this.backfillInProgress.add(session.id)
      try {
        if (!session.cliSessionId) continue
        const rows = await this.sessionManager.getSessionMessages(session.cliSessionId)
        const messages = sdkMessagesToChatMessages(rows)
        if (messages.length > 0) {
          this.sessionStore.applyBackfilledMessages(session.id, messages, summarizeOpencodeMessageUsage(rows))
          this.sessionStore.autoTitleFromMessages(session.id)
          log.info(`[sessions_recovered] Backfilled ${messages.length} messages for session ${session.id}`)
          didBackfill = true
        } else {
          // Empty response at startup is almost always the opencode server
          // still lazy-loading messages from disk, not a truly empty session.
          // Leave needsBackfill=true so the bounded retry (or a later
          // tab_created) can try again. Do NOT close the tab.
          log.info(`[sessions_recovered] Empty response for ${session.id}; leaving needsBackfill set for retry`)
        }
      } catch (err) {
        log.warn(`[sessions_recovered] Backfill failed for ${session.id}`, err)
      } finally {
        this.backfillInProgress.delete(session.id)
      }
    }

    const stillPending = this.sessionStore
      .list()
      .filter((s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0)
    if (stillPending.length > 0 && !isRetry) {
      this.scheduleBackfillRetry(0)
    }

    return didBackfill
  }

  private scheduleBackfillRetry(attempt: number): void {
    if (attempt >= this.BACKFILL_RETRY_DELAYS_MS.length) return
    if (this.backfillRetryTimer) clearTimeout(this.backfillRetryTimer)

    const delay = this.BACKFILL_RETRY_DELAYS_MS[attempt]!
    this.backfillRetryTimer = setTimeout(async () => {
      this.backfillRetryTimer = undefined
      const all = this.sessionStore.list()
      const stillPending = all.filter(
        (s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0
      )
      if (stillPending.length === 0) return

      log.info(`[sessions_recovered] Retry attempt ${attempt + 1} for ${stillPending.length} session(s)`)
      try {
        const changed = await this.backfillRecoveredSessions(all, true)
        if (changed) {
          this.restoredTabsHydrated = false
          this.pushInitStateToWebview()
          this.postSessionListUpdate(this.sessionStore.list())
        }
      } catch (err) {
        log.warn(`[sessions_recovered] Retry attempt ${attempt + 1} failed`, err)
      }

      const stillStillPending = this.sessionStore
        .list()
        .filter((s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0)
      if (stillStillPending.length > 0) this.scheduleBackfillRetry(attempt + 1)
    }, delay)
  }

  private async backfillTabIfNeeded(tabId: string): Promise<void> {
    const session = this.sessionStore.get(tabId)
    // Backfill if: has cliSessionId, has no local messages, and server is running
    // Note: We don't check needsBackfill flag here because a session might have
    // empty messages with needsBackfill=false (e.g., imported session that
    // was never backfilled). We should still attempt backfill for empty sessions.
    if (!session || !session.cliSessionId || session.messages.length > 0) {
      return
    }

    // EC7: Prevent concurrent backfill requests for the same session
    if (this.backfillInProgress.has(tabId)) {
      log.info(`[tab_created] Skipping backfill for ${tabId} because backfill is already in progress`)
      return
    }

    // EC4: Avoid backfill if session is currently streaming
    const tab = this.tabManager.getTab(tabId)
    if (tab?.isStreaming) {
      log.info(`[tab_created] Skipping backfill for ${tabId} because it is currently streaming`)
      return
    }

    this.backfillInProgress.add(tabId)
    try {
      const rows = await this.sessionManager.getSessionMessages(session.cliSessionId)
      const messages = sdkMessagesToChatMessages(rows)
        if (messages.length > 0) {
          this.sessionStore.applyBackfilledMessages(session.id, messages, summarizeOpencodeMessageUsage(rows))
          this.sessionStore.autoTitleFromMessages(session.id)
          log.info(`[tab_created] Backfilled ${messages.length} messages for session ${session.id}`)
          const tabAfter = this.tabManager.getTab(tabId)
          if (tabAfter?.isStreaming) {
            log.info(`[tab_created] Skipping pushInitState for ${session.id} because streaming started during backfill`)
          } else {
            this.restoredTabsHydrated = false
            this.pushInitStateToWebview()
          }
      } else {
        // Empty response — most likely the server has not finished loading
        // messages from disk. Preserve needsBackfill so the retry timer (or a
        // later user interaction) can try again. Do NOT close the tab.
        log.info(`[tab_created] Empty response for ${session.id}; leaving needsBackfill set for retry`)
      }
    } catch (err) {
      // EC5: Handle session deletion or other errors gracefully
      log.warn(`[tab_created] Backfill failed for ${session.id}`, err)
    } finally {
      this.backfillInProgress.delete(tabId)
    }
  }

  private postSessionListUpdate(sessions: import("../session/SessionStore").OpenCodeSession[]): void {
    this.postMessage({
      type: "session_list_update",
      sessions: sessions.map((s) => ({
        id: s.id,
        cliSessionId: s.cliSessionId,
        title: SessionStore.displayName(s),
        time: s.lastActiveAt,
        messageCount: s.messages.length,
        cost: s.cost || 0,
        workspacePath: s.workspacePath,
      })),
    })
  }

  private handleServerEvent(event: { type: string; sessionId?: string; data?: unknown }): void {
    if (!this._view) {
      log.debug(`Ignoring server event ${event.type} — no webview active`)
      return
    }

    // text_chunk, tool_end, and other high-frequency events are too noisy to log every one.
    // State events still log.
    const isHighFrequency = event.type === "text_chunk" || event.type === "tool_end" || event.type === "tool_start"
    if (!isHighFrequency) {
      log.debug(`Incoming server event: ${event.type} (sessionId: ${event.sessionId})`)
    }

    // Resolve tab by cliSessionId first (O(1) via index), then by local tab id.
    let tab = event.sessionId ? this.tabManager.getTabByCliSessionId(event.sessionId) : undefined
    if (!tab && event.sessionId) {
      tab = this.tabManager.getTab(event.sessionId)
    }
    let tabId = tab?.id

    // CRITICAL: Ensure we use the mapped tabId, not the raw CLI sessionId, when calling handlers
    // as handlers expect the local webview sessionId.
    const targetTabId = tabId || event.sessionId || ""

    if (!tab && event.sessionId && event.type !== "session_status" && event.type !== "server_connected") {
      log.warn(`Dropping server event ${event.type} for unknown cliSessionId "${event.sessionId}" to avoid routing it to the wrong tab`)
      return
    } else if (tab && !isHighFrequency) {
      log.debug(`Routed server event ${event.type} to tab: ${tab.id}`)
    }

    const handler = this.serverEventHandlers.get(event.type)
    if (handler) { 
      handler(event, targetTabId, tab ?? undefined) 
    } else {
      log.warn(`No handler for server event type: ${event.type}`)
    }
  }

  private async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
    return this.sessionLifecycle.handleAcceptDiff(blockId, sessionId)
  }

  private syncActiveSession(): void {
    return this.sessionLifecycle.syncActiveSession()
  }

  private pushModelToWebview(model?: string): void {
    this.statePush.pushModelToWebview(model || this.modelManager.model)
  }

  private pushModelListToWebview(): void {
    this.messageRouter.getModelList({
      postMessage: (m) => this.statePush.postMessage(m),
      postRequestError: (m) => this.statePush.postRequestError(m),
    })
  }

  private pushMcpServersToWebview(): void {
    this.mcpServerManager.refresh()
    const servers = this.mcpServerManager.getServers()
    this.statePush.pushMcpServersToWebview(servers)
  }

  private pushRateLimitStateToWebview(): void {
    this.statePush.pushRateLimitStateToWebview(this.rateLimitMonitor.getSerializableState())
  }

  private pushInitStateToWebview(): void {
    const MAX_MESSAGES_PER_TAB = 50
    const restoreOpenTabs = vscode.workspace.getConfiguration("opencode").get<boolean>("sessions.restoreOpenTabs", true)

    // Restore the exact set of tabs the user had open, in their original
    // order. The persisted list lives in globalState (TabManager.persist).
    // Treat it as a startup import only. Runtime state syncs must not revive a
    // tab the user already closed in this extension session.
    const shouldHydrateRestoredTabs = restoreOpenTabs && !this.restoredTabsHydrated
    const restoredIds = shouldHydrateRestoredTabs ? this.tabManager.getRestoredTabIds() : []
    const restoredActiveId = shouldHydrateRestoredTabs ? this.tabManager.getRestoredActiveId() : ""

    const restorable: import("../session/SessionStore").OpenCodeSession[] = []
    const seen = new Set<string>()
    const aliasToSessionId = new Map<string, string>()
    const markRestorableSession = (
      session: import("../session/SessionStore").OpenCodeSession,
      ...aliases: Array<string | undefined>
    ): void => {
      const canonicalId = session.id
      const ids = [canonicalId, session.cliSessionId, ...aliases].filter((id): id is string => Boolean(id))
      for (const id of ids) {
        seen.add(id)
        aliasToSessionId.set(id, canonicalId)
      }
    }
    const hasSeenRestorableSession = (
      session: import("../session/SessionStore").OpenCodeSession,
      ...aliases: Array<string | undefined>
    ): boolean => {
      const ids = [session.id, session.cliSessionId, ...aliases].filter((id): id is string => Boolean(id))
      return ids.some((id) => seen.has(id))
    }

    for (const id of restoredIds) {
      if (seen.has(id)) continue
      const s = this.sessionStore.get(id)
      // Skip tabs whose underlying session is gone, archived, or in a different
      // workspace — restoring those would render a blank pane the user can't act on.
      // Empty sessions (messages.length === 0) ARE included now: they may be a
      // freshly-created tab the user is about to use, and excluding them caused
      // the welcome screen to cover an active streaming session.
      if (!s || s.archived || !this.isSessionInCurrentWorkspace(s)) continue
      if (hasSeenRestorableSession(s, id)) continue
      restorable.push(s)
      markRestorableSession(s, id)
    }

    // Always include any tab currently open in TabManager (extension-side source
    // of truth) even if it's not in restoredIds — this can happen if a tab was
    // created after the last persist (e.g. during this session's bootstrap).
    for (const tab of this.tabManager.getAllTabs()) {
      if (seen.has(tab.id)) continue
      const s = this.sessionStore.get(tab.id) || (tab.cliSessionId ? this.sessionStore.get(tab.cliSessionId) : undefined)
      if (s && !s.archived && this.isSessionInCurrentWorkspace(s)) {
        if (hasSeenRestorableSession(s, tab.id, tab.cliSessionId)) continue
        restorable.push(s)
        markRestorableSession(s, tab.id, tab.cliSessionId)
      }
    }

    const storeActive = this.sessionStore.getActive()
    if (storeActive && !hasSeenRestorableSession(storeActive) && !storeActive.archived && this.isSessionInCurrentWorkspace(storeActive)) {
      restorable.push(storeActive)
      markRestorableSession(storeActive)
    }

    // Decide which tab should be focused: prefer the previously-active tab
    // if it survived the filter, otherwise the active session in the store
    // (e.g. one created since last shutdown), otherwise the first restored.
    let activeId: string | null = null
    if (restoredActiveId && seen.has(restoredActiveId)) {
      activeId = aliasToSessionId.get(restoredActiveId) ?? restoredActiveId
    } else {
      if (storeActive && seen.has(storeActive.id)) {
        activeId = storeActive.id
      } else if (restorable.length > 0) {
        activeId = restorable[0]!.id
      }
    }

    const sessionsToSend = restorable.map((s) => ({
      ...(() => {
        const tab = this.tabManager.getTab(s.id)
        return { isStreaming: tab?.isStreaming ?? false, instructions: tab?.instructions }
      })(),
      id: s.id,
      name: SessionStore.displayName(s),
      model: s.model,
      mode: s.mode || "build",
      messages: s.messages.slice(-MAX_MESSAGES_PER_TAB),
      cost: s.cost || 0,
      tokenUsage: s.tokenUsage,
      totalMessages: s.messages.length,
    }))

    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? ""
    this.postMessage({
      type: "init_state",
      sessions: sessionsToSend,
      activeSessionId: activeId,
      globalModel: this.modelManager.model || "",
      workspaceName,
    })
    this.restoredTabsHydrated = true
  }

private isSessionInCurrentWorkspace(session: import("../session/SessionStore").OpenCodeSession): boolean {
    const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return isSessionInCurrentWorkspacePure(session.workspacePath, currentWorkspace)
  }

  private pushAllStateToWebview(): void {
    this.pushInitStateToWebview()
    this.pushModelToWebview()
    this.pushModelListToWebview()
    this.themeController.pushThemeToWebview()
    this.themeController.pushThemeConfigToWebview()
    this.pushRateLimitStateToWebview()
    this.pushCommandListToWebview()
    if (this.pendingPrompt) {
      this.postMessage({ type: "prefill_prompt", ...this.pendingPrompt })
      this.pendingPrompt = undefined
    }
  }

  private pushVisibleStateToWebview(): void {
    this.chunkBatcher.flush()
    this.pushAllStateToWebview()
    this.replayLiveStreamsToWebview()
  }

  private replayLiveStreamsToWebview(): void {
    if (!this._view || !this.eventRouter.webviewReady) return
    for (const tab of this.tabManager.getAllTabs()) {
      if (!tab.isStreaming) continue
      this.streamCoordinator.replayLiveStreamToWebview(tab.id, {
        postMessage: (m) => this.postMessage(m),
        postRequestError: (m) => this.postRequestError(m, tab.id),
      })
    }
  }

  private pushCommandListToWebview(): void {
    const customCommands = this.promptManager.getPromptCommands()
    if (!this.sessionManager.isRunning) {
      this.statePush.pushCommandListToWebview(customCommands)
      return
    }
    this.sessionManager.listCommands().then((commands) => {
      this.statePush.pushCommandListToWebview([...customCommands, ...commands])
    }).catch(() => {
      this.statePush.pushCommandListToWebview(customCommands)
    })
  }

  private postMessage(msg: Record<string, unknown>): void {
    if (!this._view) return

    // H3: Buffer messages if webview isn't ready yet.
    // Allow init_state, theme_vars, model_update, and model_list through
    // so the webview is fully initialized on first load.
    const passthrough = ["init_state", "theme_vars", "theme_config", "rate_limit_state", "model_update", "model_list", "webview_ready", "session_list_update"]
    if (!this.eventRouter.webviewReady && !passthrough.includes(msg.type as string)) {
      // Use centralized queue enforcement in WebviewEventRouter
      this.eventRouter.enqueueMessage(msg)
      return
    }

    // R2: Batch stream_chunk messages — accumulate text per session and flush every 75ms
    if (msg.type === "stream_chunk" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      const messageId = typeof msg.messageId === "string" ? msg.messageId : undefined
      this.chunkBatcher.add(msg.sessionId, msg.text, messageId)
      return
    }

    // For stream_end, flush any remaining chunks first so the webview has all text.
    // O2: A throw inside flush must not strand stream_end — the batcher already logs per-chunk failures.
    if (msg.type === "stream_end") {
      try { this.chunkBatcher.flush() } catch (err) { log.error("chunkBatcher.flush before stream_end failed", err) }
    }

    try {
      // O5: VS Code's postMessage returns Thenable<boolean> — false signals the webview's
      // internal queue refused the message (saturation, disposed, hidden). We previously
      // discarded this signal entirely. Observe it and surface sustained backpressure.
      const result = this._view.webview.postMessage(msg) as boolean | Thenable<boolean> | undefined
      if (result && typeof (result as Thenable<boolean>).then === "function") {
        ;(result as Thenable<boolean>).then(ok => { if (ok === false) this.recordPostMessageRejected(msg) }, () => { /* ignore */ })
      } else if (result === false) {
        this.recordPostMessageRejected(msg)
      }
    } catch (err) {
      log.error("Failed to post message to webview", err)
      // P2: Retry critical messages
      if (ChatProvider.CRITICAL_MESSAGE_TYPES.has(msg.type as string)) {
        // O3: While a stream lifecycle message is being retried, pause chunk delivery for the same
        // session so a batched stream_chunk cannot overtake the not-yet-delivered stream_start.
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : undefined
        if (sid && (msg.type === "stream_start" || msg.type === "stream_tool_start")) {
          this.chunkBatcher.pauseSession(sid)
        }
        this.scheduleRetry(msg)
      }
    }

    // F15: Notify when turn completes and webview is not visible
    if (msg.type === "stream_end") {
      this.notifyTurnComplete()
    }
  }

  private postRequestError(message: string, sessionId?: string): void {
    this.statePush.postRequestError(this.toUserErrorMessage(message), sessionId)
  }

  /** O5: Backpressure observability — counters for consecutive rejected postMessage results. */
  private postMessageRejectedConsecutive = 0
  private postMessageRejectedTotal = 0
  private lastBackpressureLogAt = 0

  /** O5: Called when webview.postMessage resolves to false (saturation / refused). */
  private recordPostMessageRejected(msg: Record<string, unknown>): void {
    this.postMessageRejectedConsecutive++
    this.postMessageRejectedTotal++
    const now = Date.now()
    // Throttle to once per second to avoid log spam under sustained pressure.
    if (now - this.lastBackpressureLogAt > 1000) {
      this.lastBackpressureLogAt = now
      log.warn(`Webview postMessage refused ${this.postMessageRejectedConsecutive} message(s) (total ${this.postMessageRejectedTotal}); latest type=${String(msg.type)}`)
    }
    // Re-route critical messages through retry so they aren't lost to a silent false.
    if (ChatProvider.CRITICAL_MESSAGE_TYPES.has(msg.type as string)) {
      this.scheduleRetry(msg)
    }
  }

  /** P2: Schedule a retry for a failed critical message with exponential backoff */
  private scheduleRetry(msg: Record<string, unknown>): void {
    const retryItem = { msg, attempts: 0, lastAttempt: Date.now() }
    this.messageRetryQueue.push(retryItem)
    this.processRetryQueue()
  }

  /** P2: Process retry queue with exponential backoff */
  private processRetryQueue(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }

    while (this.messageRetryQueue.length > 0) {
      const now = Date.now()
      const nextRetry = this.messageRetryQueue.find(item => {
        const delayIndex = Math.min(item.attempts, ChatProvider.RETRY_DELAYS_MS.length - 1)
        const delayMs = ChatProvider.RETRY_DELAYS_MS[delayIndex] ?? 1000
        return now - item.lastAttempt >= delayMs
      })

      if (!nextRetry) {
        const firstItem = this.messageRetryQueue[0]
        if (firstItem) {
          const delayIndex = Math.min(firstItem.attempts, ChatProvider.RETRY_DELAYS_MS.length - 1)
          const delayMs = ChatProvider.RETRY_DELAYS_MS[delayIndex] ?? 1000
          const timeUntilNext = delayMs - (now - firstItem.lastAttempt)
          this.retryTimer = setTimeout(() => this.processRetryQueue(), timeUntilNext)
        }
        return
      }

      // O6: posting to a disposed view used to silently no-op via optional chaining.
      // Treat absent _view as a failure so a hide/show cycle can recover, then bail.
      if (!this._view) {
        log.warn(`Retry skipped — webview disposed; type=${String(nextRetry.msg.type)}`)
        nextRetry.attempts++
        nextRetry.lastAttempt = Date.now()
        if (nextRetry.attempts >= ChatProvider.MAX_RETRIES) {
          log.error(`Max retries exceeded (no view) for message type: ${nextRetry.msg.type}`)
          const index = this.messageRetryQueue.indexOf(nextRetry)
          if (index > -1) this.messageRetryQueue.splice(index, 1)
        }
        // Reschedule and break — the disposed view will not flip mid-tick.
        const firstItem = this.messageRetryQueue[0]
        if (firstItem) {
          const delayIndex = Math.min(firstItem.attempts, ChatProvider.RETRY_DELAYS_MS.length - 1)
          const delayMs = ChatProvider.RETRY_DELAYS_MS[delayIndex] ?? 1000
          this.retryTimer = setTimeout(() => this.processRetryQueue(), delayMs)
        }
        return
      }

      try {
        this._view.webview.postMessage(nextRetry.msg)
        const index = this.messageRetryQueue.indexOf(nextRetry)
        if (index > -1) {
          this.messageRetryQueue.splice(index, 1)
        }
        // O3: a successful stream_start / stream_tool_start retry releases the paused chunk buffer.
        const sid = typeof nextRetry.msg.sessionId === "string" ? nextRetry.msg.sessionId : undefined
        if (sid && (nextRetry.msg.type === "stream_start" || nextRetry.msg.type === "stream_tool_start")) {
          this.chunkBatcher.resumeSession(sid)
        }
        log.info(`Successfully retried message of type: ${nextRetry.msg.type}`)
      } catch (err) {
        log.warn(`Retry post failed for ${String(nextRetry.msg.type)}: ${err instanceof Error ? err.message : String(err)}`)
        nextRetry.attempts++
        nextRetry.lastAttempt = Date.now()
        if (nextRetry.attempts >= ChatProvider.MAX_RETRIES) {
          log.error(`Max retries exceeded for message type: ${nextRetry.msg.type}`)
          const index = this.messageRetryQueue.indexOf(nextRetry)
          if (index > -1) {
            this.messageRetryQueue.splice(index, 1)
          }
          // O3: give up gracefully — unblock the batcher so subsequent chunks for the session
          // are not orphaned in memory. The webview will simply miss the start; better than a leak.
          const sid = typeof nextRetry.msg.sessionId === "string" ? nextRetry.msg.sessionId : undefined
          if (sid && (nextRetry.msg.type === "stream_start" || nextRetry.msg.type === "stream_tool_start")) {
            this.chunkBatcher.resumeSession(sid)
          }
        }
      }
    }
  }

private toUserErrorMessage(message: string): string {
    return toUserErrorMessagePure(message)
  }

  private errorValueToMessage(value: unknown): string {
    return errorValueToMessagePure(value)
  }

  private mapToolType(tool: string): string {
    return mapToolTypePure(tool)
  }

  private async handleInsertAtCursor(code: string, _language: string): Promise<void> {
    await this.fileOps.insertAtCursor(code)
  }

  private async handleCreateFileFromCode(code: string, language: string): Promise<void> {
    await this.fileOps.createFromCode(code, language)
  }

  private languageExtension(language: string): string {
    return ChatFileOps.extensionForLanguage(language)
  }

  private handleEditMessage(sessionId: string, messageId: string, text: string): void {
    const session = this.sessionStore.get(sessionId)
    if (!session) return

    const msgIdx = session.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return

    // Clear downstream messages (all messages after the edited one)
    const removed = this.sessionStore.truncateMessages(sessionId, msgIdx + 1)
    log.info(`Editing message ${messageId}: removed ${removed} downstream messages`)

    // Send the original text back to the webview to prefill the input
    this.postMessage({
      type: "edit_message_prefill",
      sessionId,
      messageId,
      text,
    })
  }

  private async handleStashPrompt(name: string, content: string, isGlobal: boolean): Promise<void> {
    try {
      const active = this.tabManager.getActiveTab()
      if (isGlobal) {
        await this.promptStashManager.stashGlobal(name, content)
      } else if (active) {
        await this.promptStashManager.stashForSession(name, content, active.cliSessionId || active.id)
      }
      this.postMessage({ type: "stash_success", name })
    } catch (err) {
      log.error("Stash prompt failed", err)
      this.postMessage({ type: "stash_error", error: "Failed to stash prompt" })
    }
  }

  private handleListStashes(): void {
    try {
      const active = this.tabManager.getActiveTab()
      const stashes = active
        ? this.promptStashManager.getSessionStashes(active.cliSessionId || active.id)
        : this.promptStashManager.getGlobalStashes()
      this.postMessage({ type: "stash_list", stashes })
    } catch (err) {
      log.error("List stashes failed", err)
      this.postMessage({ type: "stash_error", error: "Failed to list stashes" })
    }
  }

  private async handleDeleteStash(id: string): Promise<void> {
    try {
      await this.promptStashManager.deleteStash(id)
      this.postMessage({ type: "stash_deleted", id })
    } catch (err) {
      log.error("Delete stash failed", err)
      this.postMessage({ type: "stash_error", error: "Failed to delete stash" })
    }
  }

  private async handleAddProvider(name: string, apiKey: string, baseUrl?: string): Promise<void> {
    try {
      const id = await this.providerConfigManager.upsertConfig({
        name,
        apiKey,
        baseUrl,
        enabled: true,
        models: [],
      })
      this.postMessage({ type: "provider_added", id, name })
    } catch (err) {
      log.error("Add provider failed", err)
      this.postMessage({ type: "provider_error", error: "Failed to add provider" })
    }
  }

  private handleListProviders(): void {
    try {
      const providers = this.providerConfigManager.getAllConfigs()
      this.postMessage({ type: "provider_list", providers })
    } catch (err) {
      log.error("List providers failed", err)
      this.postMessage({ type: "provider_error", error: "Failed to list providers" })
    }
  }

  private async handleUpdateProvider(id: string, updates: Record<string, unknown>): Promise<void> {
    try {
      const config = this.providerConfigManager.getConfig(id)
      if (!config) {
        this.postMessage({ type: "provider_error", error: "Provider not found" })
        return
      }
      await this.providerConfigManager.upsertConfig({
        ...config,
        ...updates,
      } as unknown as Omit<import("../model/ProviderConfigManager").ProviderConfig, "id">)
      this.postMessage({ type: "provider_updated", id })
    } catch (err) {
      log.error("Update provider failed", err)
      this.postMessage({ type: "provider_error", error: "Failed to update provider" })
    }
  }

  private async handleDeleteProvider(id: string): Promise<void> {
    try {
      await this.providerConfigManager.deleteConfig(id)
      this.postMessage({ type: "provider_deleted", id })
    } catch (err) {
      log.error("Delete provider failed", err)
      this.postMessage({ type: "provider_error", error: "Failed to delete provider" })
    }
  }

  private async handleCompactBannerAction(sessionId: string | undefined, action: string): Promise<void> {
    this.autoCompactor.handleBannerAction(sessionId, action, {
      postMessage: (m) => this.postMessage(m),
      postRequestError: (m) => this.postRequestError(m),
    })
  }

  // F15: Notification when stream completes and webview is not focused
  private notifyTurnComplete(): void {
    if (!this._view?.visible) {
      vscode.window.showInformationMessage("OpenCode turn complete", "Open Chat").then(selection => {
        if (selection === "Open Chat") {
          this._view?.show?.(true)
        }
      })
    }
  }

  // ─── Built-in Slash Command Handlers ───

  private async handleClearCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "clear")
  }

  private async handleCostCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "cost")
  }

  private async handleContinueCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "continue")
  }

  async abortCurrentSession(): Promise<void> {
    return this.commandExec.abortCurrentSession()
  }

  private handleHelpCommand(sessionId: string): void {
    void this.commandExec.handleLocalSlashCommand(sessionId, "help")
  }

  private readonly AUTO_MODE_CONFIRMED_KEY = "opencode.autoModeConfirmed"

  private hasAutoModeConfirmed(): boolean {
    return this.context.globalState.get<boolean>(this.AUTO_MODE_CONFIRMED_KEY, false)
  }

  /** H6: One-time auto mode confirmation with "Don't show again" option */
  private async showAutoModeConfirmation(sessionId: string): Promise<boolean> {
    const DONT_SHOW = "Don't show again"
    const PROCEED = "Proceed"
    const CANCEL = "Cancel"

    const result = await vscode.window.showWarningMessage(
      "Auto mode will apply all changes without asking.",
      { modal: true },
      PROCEED,
      DONT_SHOW,
      CANCEL
    )

    if (result === DONT_SHOW) {
      await this.context.globalState.update(this.AUTO_MODE_CONFIRMED_KEY, true)
      return true
    }
    return result === PROCEED
  }

  dispose(): void {
    if (this.backfillRetryTimer) {
      clearTimeout(this.backfillRetryTimer)
      this.backfillRetryTimer = undefined
    }
    // P2: Clear retry timer and queue on disposal
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.messageRetryQueue = []
    this.chunkBatcher.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.streamCoordinator.dispose()
    this.tabManager.dispose()
    this.promptManager.dispose()
    this.messageRouter?.dispose()
    this.chatCommands?.dispose()
    this.autoCompactor?.dispose()
    this.fileOps?.dispose()
    this.eventRouter.clearReadyTimeout()
    this.webviewContent?.dispose()
  }
}
