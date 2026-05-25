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
import { sdkMessagesToChatMessages, reasoningEventToBlock } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { isLocalPlaceholderSessionId } from "../session/sessionUtils"
import { WebviewContent } from "./WebviewContent"
import { TabManager } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import { PromptManager } from "../prompts/PromptManager"
import { PromptStashManager } from "../prompts/PromptStashManager"
import { ProviderConfigManager } from "../model/ProviderConfigManager"
import { toUserErrorMessage as toUserErrorMessagePure, errorValueToMessage as errorValueToMessagePure, mapToolType as mapToolTypePure, isSessionInCurrentWorkspace as isSessionInCurrentWorkspacePure } from "./chatUtils"
import { ChatMessage } from "./types"
import { log } from "../utils/outputChannel"
import { MessageRouter } from "./handlers/MessageRouter"
import { ChatCommands } from "./ChatCommands"
import { AutoCompactor } from "./AutoCompactor"
import { ChatFileOps } from "./ChatFileOps"
import { HostMessageBatcher } from "./HostMessageBatcher"
import { PendingEventBuffer } from "./PendingEventBuffer"
import { McpServerManager } from "../mcp/McpServerManager"
import { ThemeController } from "./ThemeController"
import { StatePushService } from "./StatePushService"
import { SessionLifecycleService } from "./SessionLifecycleService"
import { CommandExecutionService } from "./CommandExecutionService"
import { WebviewEventRouter } from "./WebviewEventRouter"
import { SteerPromptHandler } from "./handlers/SteerPromptHandler"
import { SkillPreferencesStore } from "../skills/SkillPreferencesStore"
import { SkillTriggerEngine } from "../skills/SkillTriggerEngine"
import { MethodologyAdvisor } from "../methodology/MethodologyAdvisor"
import { BackfillService } from "./BackfillService"

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
  private backfillService: BackfillService
  private fileOps = new ChatFileOps()
  private themeController: ThemeController
  private statePush: StatePushService
  private sessionLifecycle: SessionLifecycleService
  private commandExec: CommandExecutionService
  private eventRouter: WebviewEventRouter
  private skillPreferences: SkillPreferencesStore
  private usageAnalytics: UsageAnalytics
  private steerPromptHandler: SteerPromptHandler
  private promptStashManager: PromptStashManager
  private providerConfigManager: ProviderConfigManager

  

  /** Buffers host updates and stream chunks behind one priority-aware protocol boundary. */
  private messageBatcher = this.createHostMessageBatcher()

  /**
   * Holds SSE events whose target tab has not yet registered its cliSessionId.
   * Drains and replays on TabManager.onCliSessionIdRegistered. Closes the race
   * window between `await session.create` and `setCliSessionId(...)`.
   */
  private pendingEventBuffer = new PendingEventBuffer({
    ttlMs: 5_000,
    maxPerSession: 200,
    log: { warn: (m) => log.warn(m), info: (m) => log.info(m) },
  })

  /** P2: Retry queue for critical messages with exponential backoff */
  private messageRetryQueue: Array<{ msg: Record<string, unknown>; attempts: number; lastAttempt: number }> = []
  /**
   * O3: Stream lifecycle messages must arrive in order. Adding the start/tool messages here means
   * a failed start no longer races ahead of a subsequent batched stream_chunk for the same session.
   */
  private static readonly CRITICAL_MESSAGE_TYPES = new Set([
    "stream_start", "stream_end", "stream_chunk", "stream_tool_start", "stream_tool_end",
    "stream_error", "streaming_state",
    "error", "webview_ready", "request_error",
  ])
  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_DELAYS_MS = [100, 500, 1000]
  private static readonly MAX_RETRY_QUEUE_SIZE = 50
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
    this.skillPreferences = new SkillPreferencesStore(context.globalState)

    // SkillTriggerEngine matches user prompts against trigger rules and
    // produces a list of skill IDs the methodology layer should surface to
    // the model. The advisor consults this hinter when composing its
    // prompt addendum; we filter by the user's enabled set so disabling a
    // skill in the modal also stops it from being suggested to the model.
    const skillTriggerEngine = new SkillTriggerEngine()
    const methodologyAdvisor = new MethodologyAdvisor({
      skillHinter: (text: string) => {
        const ids = skillTriggerEngine.getTriggeredSkills(text)
        return ids.filter((id) => this.skillPreferences.isEnabled(id))
      },
    })

    this.streamCoordinator = new StreamCoordinator(
      sessionManager, sessionStore, contextEngine, contextMonitor, modelManager, this.tabManager, rateLimitMonitor, this.diffApplier, methodologyAdvisor
    )
    this.promptManager = new PromptManager()
    this.promptManager.scanWorkspace()
    this.promptManager.watchPrompts()
    this.promptManager.onChanged(() => this.pushCommandListToWebview())
    this.messageRouter = new MessageRouter(sessionManager, modelManager)
    this.chatCommands = new ChatCommands(sessionStore, sessionManager, this.tabManager, this.streamCoordinator)
    this.autoCompactor = new AutoCompactor(sessionManager, sessionStore, contextMonitor, this.tabManager)
    this.backfillService = new BackfillService({
      sessionStore: this.sessionStore,
      tabManager: this.tabManager,
      getSessionMessages: (cliSessionId) => this.sessionManager.getSessionMessages(cliSessionId),
      pushInitState: () => this.pushInitStateToWebview(),
      postSessionListUpdate: (sessions) => this.postSessionListUpdate(sessions),
    })
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
      this.backfillService.backfillTabIfNeeded(tabId).catch(err => log.error(`Failed to backfill tab ${tabId} on creation`, err))
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
      stashPrompt: (name, content, isGlobal) => this.handleStashPrompt(name, content, isGlobal),
      listStashes: () => { this.handleListStashes() },
      deleteStash: (id) => { this.handleDeleteStash(id) },
      addProvider: (name, apiKey, baseUrl) => this.handleAddProvider(name, apiKey, baseUrl),
      listProviders: () => { this.handleListProviders() },
      updateProvider: (id, updates) => this.handleUpdateProvider(id, updates),
      deleteProvider: (id) => { this.handleDeleteProvider(id) },
      showOpenFolderDialog: (dir) => { void vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir)) },
      skillPreferences: this.skillPreferences,
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

  private createHostMessageBatcher(): HostMessageBatcher {
    return new HostMessageBatcher(
      (msg) => this.postRawMessage(msg),
      (msg) => log.info(msg),
    )
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

    // Clear pending message buffers and timers from the previous webview instance.
    this.messageBatcher.dispose()
    this.messageBatcher = this.createHostMessageBatcher()

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
        this.applyContextWindowFor(model)
      }),
      this.modelManager.onModelsRefreshed(() => {
        this.pushModelListToWebview()
        this.applyContextWindowFor()
      }),
      // React to live changes to opencode.contextWindowOverride — the user
      // may set it via the "Set Context Window Override" command without
      // restarting the extension. Without this listener the new value
      // would only take effect on the next model switch.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("opencode.contextWindowOverride")) {
          this.applyContextWindowFor()
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
      this.tabManager.onCliSessionIdRegistered(({ tabId, cliSessionId }) => {
        const buffered = this.pendingEventBuffer.drain(cliSessionId)
        if (buffered.length === 0) return
        log.info(`Replaying ${buffered.length} buffered event(s) for cliSessionId "${cliSessionId}" (tab ${tabId})`)
        for (const ev of buffered) this.handleServerEvent(ev)
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
        // Coarse pre-gate: any usage above the lowest sensible threshold
        // (10) gets handed to AutoCompactor, which does the model-aware
        // per-tab check against the actual configured threshold. We can't
        // hardcode 80 here because users may have set lower per-model
        // thresholds via `opencode.autoCompactPerModelThreshold`.
        if (usage.percent >= 10) {
          // Pass the firing sessionId so AutoCompactor can refuse to act
          // when a background tab triggers the threshold — without this,
          // a high-usage background tab would cause us to compact the
          // (possibly low-usage) active tab instead.
          this.autoCompactor.tryCompactIfNeeded(
            {
              postMessage: (m) => this.postMessage(m),
              postRequestError: (m) => this.postRequestError(m),
            },
            { sessionId: usage.sessionId },
          )
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
      try { this.messageBatcher.dispose() } catch (err) { log.warn("HostMessageBatcher dispose on view disposal failed", err) }
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
    const msgType = typeof msg?.type === "string" ? msg.type : "unknown"
    if (msgType === "send_prompt" || msgType === "create_tab" || msgType === "new_session") {
      log.info(`handleWebviewMessage: type=${msgType}, sessionId=${typeof msg?.sessionId === "string" ? msg.sessionId : "N/A"}`)
    }
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
    const tab = this.tabManager.getTab(sessionId)
    const nextModel = storeSession.model || model
    const nextMode = storeSession.mode || mode
    if (tab) {
      if (nextModel && tab.model !== nextModel) this.tabManager.setModel(sessionId, nextModel)
      if (nextMode && tab.mode !== nextMode) this.tabManager.setMode(sessionId, nextMode)
    } else {
      this.tabManager.createTab(sessionId, storeSession.cliSessionId, nextModel, nextMode)
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

  /**
   * Re-fetch the command list and push it to the webview WITHOUT
   * `showInChat`, so the inline @ dropdown + commands modal pick up the
   * fresh set silently (no system message dump, no modal pop-up).
   * Used when MCP server tools change mid-session.
   *
   * The user-initiated path (from /commands or the webview's list_commands
   * message) is handled by WebviewEventRouter.handleListCommands, which
   * sets showInChat: true so the modal opens. Both code paths share the
   * same data source (promptManager + sessionManager.listCommands()).
   */
  private async refreshCommandListQuietly(): Promise<void> {
    try {
      const customCommands = this.promptManager.getPromptCommands()
      if (!this.sessionManager.isRunning) {
        this.postMessage({ type: "command_list", commands: customCommands })
        return
      }
      const commands = await this.sessionManager.listCommands()
      this.postMessage({ type: "command_list", commands: [...customCommands, ...commands] })
    } catch (err) {
      log.warn("Failed to refresh command list after MCP change", err)
    }
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
    ["permission_request", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { id?: string; title?: string; type?: string; pattern?: string | string[]; metadata?: Record<string, unknown> } | undefined
      const currentTab = this.tabManager.getTab(tabId)
      if (data?.id && currentTab?.mode === "auto") {
        const cliSessionId = event.sessionId || currentTab.cliSessionId || tabId
        log.info(`Auto-approving permission ${data.id} in auto mode for session ${tabId}`)
        void this.sessionManager.respondToPermission(cliSessionId, data.id, "once")
          .catch(err => log.warn(`Failed to approve auto-mode permission ${data.id}`, err))
        return
      }
      if (data?.id && currentTab?.mode === "plan") {
        const cliSessionId = event.sessionId || currentTab.cliSessionId || tabId
        const response = this.shouldAutoRejectPlanPermission(data) ? "reject" : "once"
        log.info(`Auto-${response === "reject" ? "rejecting" : "approving"} permission ${data.id} in plan mode for session ${tabId}`)
        void this.sessionManager.respondToPermission(cliSessionId, data.id, response)
          .catch(err => log.warn(`Failed to ${response} plan-mode permission ${data.id}`, err))
        return
      }
      this.postMessage({
        type: "permission_request",
        sessionId: tabId,
        permissionId: data?.id,
        title: data?.title || `Allow ${data?.type || "action"}?`,
        permissionType: data?.type,
        pattern: data?.pattern,
        metadata: data?.metadata,
      })
    }],
    ["permission_replied", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => { log.info(`Permission response for ${tabId}`) }],
    ["todo_updated", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { todos?: unknown[] } | undefined
      this.postMessage({ type: "todos_update", sessionId: tabId, todos: data?.todos ?? [] })
    }],
    ["file_edited", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as {
        file?: string
        files?: string[]
        changes?: Array<{ path?: string; added?: number; removed?: number }>
      } | undefined
      const normalizeFilePath = (filePath: string) => filePath.trim().replace(/\\/g, "/")
      const changeStats = new Map<string, { added: number; removed: number }>()
      if (Array.isArray(data?.changes)) {
        for (const change of data.changes) {
          if (typeof change.path !== "string") continue
          const changedPath = normalizeFilePath(change.path)
          if (!changedPath) continue
          changeStats.set(changedPath, {
            added: Number.isFinite(change.added) ? Number(change.added) : 0,
            removed: Number.isFinite(change.removed) ? Number(change.removed) : 0,
          })
        }
      }
      const files = Array.from(new Set([
        ...(Array.isArray(data?.files) ? data.files.map(normalizeFilePath) : []),
        ...changeStats.keys(),
        ...(typeof data?.file === "string" ? [normalizeFilePath(data.file)] : []),
      ]))
        .filter(Boolean)
      if (files.length === 0) return

      // Persist stats so future tab-switches and get_changed_files requests
      // can report accurate additions/deletions for older files.
      const statsArray = Array.from(changeStats.entries()).map(([path, s]) => ({ path, ...s }))
      this.sessionStore.addChangedFiles(tabId, files, statsArray)
      for (const file of files) {
        this.postMessage({ type: "file_edited", sessionId: tabId, file })
      }
      // Merge stored cumulative stats with the current batch (current batch wins on conflict)
      const storedStats = this.sessionStore.getChangedFileStats(tabId)
      this.postMessage({
        type: "changed_files_update",
        sessionId: tabId,
        files: this.sessionStore.getChangedFiles(tabId).map((path) => {
          const current = changeStats.get(path)
          const stored = storedStats[path]
          return {
            path,
            added: current?.added ?? stored?.added ?? 0,
            removed: current?.removed ?? stored?.removed ?? 0,
          }
        }),
      })
    }],
    ["thinking", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { text?: string } | undefined
      // Route through the canonical converter so the live block has the
      // same shape as historical-load and reconnect-rebuilt reasoning
      // blocks. Spec: ADR-008 §5.2 (one converter, one switch).
      const block = reasoningEventToBlock({ text: data?.text })
      if (!block) return
      this.postMessage({ type: "message", sessionId: tabId, message: { role: "system", blocks: [block], timestamp: Date.now(), sessionId: tabId } })
    }],
    ["session_compacted", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => { log.info(`Session compacted for ${tabId}`); this.postMessage({ type: "session_compacted", sessionId: tabId }) }],
    ["mcp_tools_changed", (event: { type: string; sessionId?: string; data?: unknown }) => {
      // MCP server tools changed (connect / disconnect / reauth) means the
      // server's /command list may now include or exclude MCP-sourced
      // prompts. Refresh quietly so the inline @ dropdown and the commands
      // modal pick up the new entries without dumping into chat history.
      const data = event.data as { server?: string } | undefined
      log.info(`MCP tools changed${data?.server ? ` (server: ${data.server})` : ""} — refreshing command list`)
      void this.refreshCommandListQuietly()
    }],
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
      this.backfillService.setHydrated(false)
      const all = this.sessionStore.list()
      this.pushInitStateToWebview()
      this.postSessionListUpdate(all)

      if (await this.backfillRecoveredSessions(all)) {
        this.backfillService.setHydrated(false)
        this.pushInitStateToWebview()
        this.postSessionListUpdate(this.sessionStore.list())
      }
    }],
  ])

  private async backfillRecoveredSessions(sessions: import("../session/SessionStore").OpenCodeSession[], isRetry: boolean = false): Promise<boolean> {
    return this.backfillService.backfillRecoveredSessions(sessions, isRetry)
  }

  private scheduleBackfillRetry(attempt: number): void {
    this.backfillService.scheduleBackfillRetry(attempt)
  }

  private async backfillTabIfNeeded(tabId: string): Promise<void> {
    return this.backfillService.backfillTabIfNeeded(tabId)
  }

  private postSessionListUpdate(sessions: import("../session/SessionStore").OpenCodeSession[]): void {
    this.postMessage({
      type: "session_list_update",
      sessions: sessions.map((s) => ({
        id: s.id,
        cliSessionId: s.cliSessionId,
        title: SessionStore.displayName(s),
        time: s.lastActiveAt,
        messageCount: s.messages.filter((m) => m.role === "user").length,
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
    if (!tab && !event.sessionId && event.type === "file_edited") {
      const activeTab = this.tabManager.getActiveTab()
      const liveTabs = this.tabManager.getAllTabs().filter((t) => t.isStreaming || t.waitingForCompletion)
      if (liveTabs.length === 1) {
        tab = liveTabs[0]
      } else if (activeTab && (activeTab.isStreaming || activeTab.waitingForCompletion || liveTabs.length === 0)) {
        tab = activeTab
      }
      if (tab) {
        log.debug(`Attributed sessionless file_edited event to tab: ${tab.id}`)
      } else {
        log.warn("Dropping sessionless file_edited event: no active or streaming tab could be resolved")
        return
      }
    }
    let tabId = tab?.id

    // CRITICAL: Ensure we use the mapped tabId, not the raw CLI sessionId, when calling handlers
    // as handlers expect the local webview sessionId.
    const targetTabId = tabId || event.sessionId || ""

    if (!tab && event.sessionId && event.type !== "session_status" && event.type !== "server_connected") {
      // Race-tolerant routing: the tab→session mapping may not be registered
      // yet (the server can emit events between `session.create` resolving
      // and `setCliSessionId(...)` running). Buffer the event; it will be
      // replayed by the onCliSessionIdRegistered subscription, or dropped
      // once after the TTL if the mapping never arrives.
      this.pendingEventBuffer.add(event.sessionId, event)
      if (!isHighFrequency) {
        log.debug(`Buffered ${event.type} for cliSessionId "${event.sessionId}" (size=${this.pendingEventBuffer.size(event.sessionId)})`)
      }
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

  private shouldAutoRejectPlanPermission(data: { type?: string; pattern?: string | string[] }): boolean {
    if (data.pattern && this.isPlanDocumentPattern(data.pattern)) return false
    if (!data.type) return true

    const type = data.type.toLowerCase()
    return type === "edit" ||
      type === "write" ||
      type === "patch" ||
      type === "apply_patch" ||
      type === "multiedit" ||
      type === "bash" ||
      type === "external_directory"
  }

  private isPlanDocumentPattern(pattern: string | string[]): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some((p) => p.startsWith(".opencode/plans/") && p.endsWith(".md"))
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

  /**
   * Resolve the active model's context window and push it into the
   * monitor + webview. Resolution order (matches resolveContextWindow):
   *   1. opencode server's `limit.context` (via ModelManager)
   *   2. OpenRouter cross-provider catalogue
   *   3. `opencode.contextWindowOverride` user setting — applied even
   *      when both server and OpenRouter come up empty (the 0.2.13 bug
   *      was that the override was only consulted INSIDE an
   *      `if (ctxWindow)` block, so it never fired in the case it was
   *      designed for).
   *   4. Still nothing → tell the webview the window is unknown so it
   *      can render the "Set context window" affordance.
   */
  private applyContextWindowFor(model?: string): void {
    const resolvedWindow = this.modelManager.getContextWindow(model)
    const override = vscode.workspace.getConfiguration("opencode").get<number>("contextWindowOverride", 0)
    const effectiveWindow = override > 0 ? override : resolvedWindow
    if (effectiveWindow && effectiveWindow > 0) {
      this.contextMonitor.setTokenLimit(effectiveWindow)
      this.statePush.postMessage({
        type: "context_window_known",
        sessionId: this.sessionStore.activeId,
        maxTokens: effectiveWindow,
        source: override > 0 ? "override" : (resolvedWindow ? "server-or-openrouter" : "unknown"),
      })
    } else {
      // Window unknown: tell the webview so it can show the affordance.
      this.statePush.postMessage({
        type: "context_window_unknown",
        sessionId: this.sessionStore.activeId,
        modelId: model || this.modelManager.model,
      })
    }
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
    const shouldHydrateRestoredTabs = restoreOpenTabs && !this.backfillService.isHydrated
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
    this.backfillService.setHydrated(true)
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
    this.messageBatcher.flush()
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

    this.messageBatcher.post(msg)

    // F15: Notify when turn completes and webview is not visible
    if (msg.type === "stream_end") {
      this.notifyTurnComplete()
    }
  }

  private postRawMessage(msg: Record<string, unknown>): boolean | Thenable<boolean> | undefined {
    if (!this._view) return false
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
      return result
    } catch (err) {
      log.error("Failed to post message to webview", err)
      // P2: Retry critical messages
      if (ChatProvider.CRITICAL_MESSAGE_TYPES.has(msg.type as string)) {
        // O3: While a stream lifecycle message is being retried, pause chunk delivery for the same
        // session so a batched stream_chunk cannot overtake the not-yet-delivered stream_start.
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : undefined
        if (sid && (msg.type === "stream_start" || msg.type === "stream_tool_start")) {
          this.messageBatcher.pauseSession(sid)
        }
        this.scheduleRetry(msg)
      }
      return false
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
    if (this.messageRetryQueue.length >= ChatProvider.MAX_RETRY_QUEUE_SIZE) {
      const oldestNonCriticalIdx = this.messageRetryQueue.findIndex(
        item => !ChatProvider.CRITICAL_MESSAGE_TYPES.has(item.msg.type as string)
      )
      if (oldestNonCriticalIdx >= 0) {
        this.messageRetryQueue.splice(oldestNonCriticalIdx, 1)
        log.warn(`Retry queue at capacity (${ChatProvider.MAX_RETRY_QUEUE_SIZE}), dropped oldest non-critical retry`)
      } else {
        log.warn(`Retry queue at capacity with all critical messages — dropping oldest to enqueue ${String(msg.type)}`)
        this.messageRetryQueue.shift()
      }
    }
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
          this.messageBatcher.resumeSession(sid)
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
            this.messageBatcher.resumeSession(sid)
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
    await this.autoCompactor.handleBannerAction(sessionId, action, {
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

  /** Public façade: run a local slash command on the active tab (used by VS Code commands). */
  async runSlashCommandOnActiveTab(commandName: string): Promise<void> {
    const sid = this.tabManager.getActiveTab()?.id
    if (!sid) {
      vscode.window.showInformationMessage("Open a chat session before running this command.")
      return
    }
    await this.commandExec.handleLocalSlashCommand(sid, commandName)
  }

  /** Open the in-webview commands palette. */
  openCommandsPalette(): void {
    if (!this._view) return
    this.postMessage({ type: "open_commands_palette" })
  }

  async handleClearCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "clear")
  }

  async handleCostCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "cost")
  }

  async handleContinueCommand(sessionId: string): Promise<void> {
    await this.commandExec.handleLocalSlashCommand(sessionId, "continue")
  }

  async abortCurrentSession(): Promise<void> {
    return this.commandExec.abortCurrentSession()
  }

  handleHelpCommand(sessionId: string): void {
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
    this.backfillService.dispose()
    // P2: Clear retry timer and queue on disposal
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.messageRetryQueue = []
    this.messageBatcher.dispose()
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
