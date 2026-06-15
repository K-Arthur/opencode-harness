import * as vscode from "vscode"
import { spawnSync } from "child_process"
import { SessionManager } from "../session/SessionManager"
import { SessionStore, type SessionContextUsage } from "../session/SessionStore"
import { ContextEngine } from "../context/ContextEngine"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { UsageAnalytics } from "../monitor/UsageAnalytics"
import { ThemeManager } from "../theme/ThemeManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { ModelManager } from "../model/ModelManager"
import { CheckpointManager } from "../checkpoint/CheckpointManager"
import { parseModelRef } from "../utils/tokenCounter"
import { DiffApplier } from "../diff/DiffApplier"
import { sdkMessagesToChatMessages, reasoningEventToBlock } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { isLocalPlaceholderSessionId } from "../session/sessionUtils"
import { activitySignature } from "../session/activityCoalesce"
import { WebviewContent } from "./WebviewContent"
import { TabManager, type TabState } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { SubagentRunStatus } from "./handlers/runActivityTypes"
import { PromptManager } from "../prompts/PromptManager"
import { PromptStashManager } from "../prompts/PromptStashManager"
import { ProviderConfigManager } from "../model/ProviderConfigManager"
import { mapToolType as mapToolTypePure, isSessionInCurrentWorkspace as isSessionInCurrentWorkspacePure, looksLikeSdkError, isAbortErrorValue } from "./chatUtils"
import { shouldIncludeStoreActiveFallback } from "./restorablePolicy"
import { mapOpencodeError, type OpencodeError } from "./webview/opencodeErrorMapper"
import { computeMessageCounts } from "./webview/messageCounter"
import { RetryQueueService, CRITICAL_MESSAGE_TYPES } from "./RetryQueueService"
import { ChatMessage, Block } from "./types"
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
import { HostPromptQueue } from "./HostPromptQueue"
import { SkillPreferencesStore } from "../skills/SkillPreferencesStore"
import { SkillTriggerEngine } from "../skills/SkillTriggerEngine"
import { ConfidenceScorer } from "../skills/ConfidenceScorer"
import { MethodologyAdvisor } from "../methodology/MethodologyAdvisor"
import { BackfillService } from "./BackfillService"
import { MessagePostService } from "./MessagePostService"
import { StashService } from "./StashService"
import { ProviderManagementService } from "./ProviderManagementService"
import { DiffAcceptService } from "./DiffAcceptService"
import { normalizeSessionMode, resolvePermissionForMode } from "./modePolicy"
import { CodeInsertionService } from "./CodeInsertionService"
import { SlashCommandService } from "./SlashCommandService"
import { SessionSyncService } from "./SessionSyncService"
import { VoiceInputService } from "./VoiceInputService"
import {
  commandExists,
  createDefaultVoiceCapture,
  describeRecorderPlan,
  describeTranscriberPlan,
  invalidateExistsCache,
  selectRecorderPlan,
  selectTranscriberPlan,
  type VoiceCaptureConfig,
} from "./voiceCapture"
import { buildVoiceSetupPlan, pickPipCommand, recorderInstallCommand, uvBootstrapCommand } from "./voiceSetup"

type ServerEvent = { type: string; sessionId?: string; data?: unknown }

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
  private hostQueue: HostPromptQueue
  private promptStashManager: PromptStashManager
  private providerConfigManager: ProviderConfigManager
  private stashService: StashService
  private providerManagementService: ProviderManagementService
  private slashCommands: SlashCommandService
  private sessionSync: SessionSyncService
  private diffAcceptService!: DiffAcceptService
  private codeInsertionService!: CodeInsertionService
  /**
   * Popout panels for subagent detail. One entry per open popout. The key is
   * a stable panel id (uuid) returned to the webview on creation so the
   * webview can correlate messages; the value holds the panel and the
   * subagent/parent ids it was created for (used to route subagent_detail
   * messages to the right panel).
   */
  private subagentDetailPanels: Map<string, {
    panel: vscode.WebviewPanel
    parentSessionId: string
    subagentId: string
  }> = new Map()
  private voiceInputService!: VoiceInputService

  private messagePostService = new MessagePostService({
    getWebview: () => this._view?.webview,
    log,
    onRejected: (msg) => this.recordPostMessageRejected(msg),
  })

  private retryQueueService = new RetryQueueService({
    postRawMessage: (msg) => this._view?.webview.postMessage(msg),
    resumeSession: (sid) => this.messageBatcher.resumeSession(sid),
    pauseSession: (sid) => this.messageBatcher.pauseSession(sid),
  })

  /** Buffers host updates and stream chunks behind one priority-aware protocol boundary. */
  private messageBatcher = this.createHostMessageBatcher()

  /**
   * Holds SSE events whose target tab has not yet registered its cliSessionId.
   * Drains and replays on TabManager.onCliSessionIdRegistered. Closes the race
   * window between `await session.create` and `setCliSessionId(...)`.
   */
  private pendingEventBuffer = new PendingEventBuffer({
    maxPerSession: 200,
    log: { warn: (m) => log.warn(m), info: (m) => log.info(m) },
    // Default TTL of 10s covers the ~5ms first-prompt race and ~5s heartbeat race window.
    // Child session events that expire here are safe to drop — they're internal to the
    // child (Akka Actor Model) and heartbeat + subagent_update provide all needed state.
  })
  /** Maps child session IDs → parent tab ID so child session events are routed
   *  directly without buffering. Populated by SubagentHeartbeat on discovery. */
  private childSessionToTab = new Map<string, string>()

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
    const confidenceScorer = new ConfidenceScorer()
    const methodologyAdvisor = new MethodologyAdvisor({
      skillHinter: (text: string) => {
        const ids = skillTriggerEngine.getTriggeredSkills(text)
        const enabled = ids.filter((id) => this.skillPreferences.isEnabled(id))
        for (const id of enabled) {
          confidenceScorer.recordSkillUsage(id)
        }
        return enabled
      },
    })

    this.streamCoordinator = new StreamCoordinator(
      sessionManager, sessionStore, contextEngine, contextMonitor, modelManager, this.tabManager, rateLimitMonitor, this.diffApplier, methodologyAdvisor
    )
    this.streamCoordinator.setChildSessionReplayer((tabId, childSessionId) => {
      // Register permanent mapping so future child session events route directly
      // to the correct parent tab via resolveServerEventTab.
      // Child session events (text_chunk, tool_start, etc.) carry the child's
      // cliSessionId — without this mapping they'd be buffered/left unresolvable.
      // Note: we do NOT drain/dispatch buffered child events here. The only
      // events buffered for child session IDs are events like text_chunk and
      // tool_start from the child's own event stream — these are NOT needed by
      // the parent tab (subagent info comes from subagent_update on the parent's
      // stream + heartbeat polling). Dispatching them would corrupt parent state.
      this.childSessionToTab.set(childSessionId, tabId)

      // However, question.asked events CAN be buffered for child sessions and
      // MUST be dispatched to the parent tab. Drain the buffer for this child
      // session and dispatch only question_asked events (Gap 4 fix).
      const buffered = this.pendingEventBuffer.drain(childSessionId)
      for (const ev of buffered) {
        if (ev.type === "question_asked" || ev.type === "question_replied" || ev.type === "question_rejected") {
          this.handleServerEvent(ev)
        }
      }
    })
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
    this.stashService = new StashService({
      promptStashManager: this.promptStashManager,
      tabManager: this.tabManager,
      postMessage: (msg) => this.postMessage(msg),
    })
    this.providerManagementService = new ProviderManagementService({
      providerConfigManager: this.providerConfigManager,
      postMessage: (msg) => this.postMessage(msg),
    })
    this.modelManager.setProviderConfigManager(this.providerConfigManager)
    this.hostQueue = new HostPromptQueue(this.context.globalState, false)
    this.steerPromptHandler = new SteerPromptHandler(
      this.streamCoordinator,
      this.sessionStore,
      this.hostQueue,
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

    this.slashCommands = new SlashCommandService({
      sessionManager,
      sessionStore: this.sessionStore,
      commandExec: this.commandExec,
      tabManager: this.tabManager,
      postMessage: (msg) => this.postMessage(msg),
      getActiveSessionId: () => this.tabManager.getActiveTab()?.id,
    })
    this.sessionSync = new SessionSyncService({
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      sessionManager,
      sessionLifecycle: this.sessionLifecycle,
      mcpServerManager: this.mcpServerManager,
      rateLimitMonitor: this.rateLimitMonitor,
      statePush: this.statePush,
      messageRouter: this.messageRouter,
      postMessage: (msg) => this.postMessage(msg),
      getActiveTabId: () => this.tabManager.getActiveTab()?.id,
    })

    this.diffAcceptService = new DiffAcceptService({
      sessionLifecycle: this.sessionLifecycle,
      autoCompactor: this.autoCompactor,
      postMessage: (msg) => this.postMessage(msg),
      postRequestError: (m) => this.postRequestError(m),
    })

    this.codeInsertionService = new CodeInsertionService(this.fileOps)
    const voiceLog = (level: "info" | "warn" | "error", message: string, err?: unknown) => {
      if (level === "error") log.error(message, err)
      else if (level === "warn") log.warn(message, err)
      else log.info(message)
    }
    const voiceCapture = createDefaultVoiceCapture(() => this.getVoiceCaptureConfig(), voiceLog)
    this.voiceInputService = new VoiceInputService({
      getRawConfig: () => this.getVoiceInputRawConfig(),
      recorder: voiceCapture.recorder,
      transcriber: voiceCapture.transcriber,
      createTempAudioPath: voiceCapture.createTempAudioPath,
      removeFile: voiceCapture.removeFile,
      postMessage: (msg) => this.postMessage(msg),
      log: voiceLog,
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
      hostQueue: this.hostQueue,
      voiceInputService: this.voiceInputService,
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
      pushAllStateToWebview: () => this.pushAllStateToWebview(),
      pushVisibleStateToWebview: () => this.pushVisibleStateToWebview(),
      openSubagentDetailPanel: (parentSessionId, subagentId) => this.openSubagentDetailPanel(parentSessionId, subagentId),
      postSubagentDetailToPopouts: (detail, subagentId) => this.postSubagentDetailToPopouts(detail, subagentId),
    })
    this.eventRouter.initialize()

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

  private getVoiceInputRawConfig(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration("opencode.voice")
    return {
      enabled: config.get("enabled"),
      autoSend: config.get("autoSend"),
      language: config.get("language"),
      insertMode: config.get("insertMode"),
      maxRecordingSeconds: config.get("maxRecordingSeconds"),
    }
  }

  /**
   * Override commands for the local capture pipeline. These are read from the
   * machine/global config scope only (see package.json `scope: "machine"`) so
   * a malicious workspace cannot inject a command for the host to spawn.
   */
  private getVoiceCaptureConfig(): VoiceCaptureConfig {
    const config = vscode.workspace.getConfiguration("opencode.voice")
    const asString = (key: string): string | undefined => {
      const value = config.get(key)
      return typeof value === "string" && value.trim() ? value.trim() : undefined
    }
    return {
      recordCommand: asString("recordCommand"),
      localCommand: asString("localCommand"),
      model: asString("model"),
    }
  }

  private detectPipViaPython(): boolean {
    try {
      const result = spawnSync("python3", ["-m", "pip", "--version"], {
        stdio: "ignore",
        timeout: 5000,
      })
      return result.status === 0
    } catch {
      return false
    }
  }

  /**
   * PEP 668: distros like Arch/CachyOS, Debian 12+ and Fedora 38+ mark the
   * system Python as externally managed — `pip install` fails outright. Probe
   * for the stdlib EXTERNALLY-MANAGED marker; default to false on any failure
   * so non-Python issues never block the setup flow.
   */
  private detectExternallyManagedPython(): boolean {
    try {
      const result = spawnSync(
        "python3",
        ["-c", "import sysconfig,os,sys;sys.exit(0 if os.path.exists(os.path.join(sysconfig.get_path('stdlib'),'EXTERNALLY-MANAGED')) else 1)"],
        { stdio: "ignore", timeout: 5000 },
      )
      return result.status === 0
    } catch {
      return false
    }
  }

  private createHostMessageBatcher(): HostMessageBatcher {
    return new HostMessageBatcher(
      (msg) => this.messagePostService.postRawMessage(msg),
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
    this.retryQueueService.clear()

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
        if (e.affectsConfiguration("opencode.toolOutput.renderAnsi")) {
          this.pushToolOutputConfigToWebview()
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
        const sessionId = typeof usage.sessionId === "string" && usage.sessionId.length > 0 ? usage.sessionId : undefined
        const contextUsage: SessionContextUsage = {
          percent: usage.percent,
          tokens: usage.tokens,
          maxTokens: usage.maxTokens,
          breakdown: usage.breakdown,
          projected: usage.projected,
          cost: usage.cost,
          source: usage.source,
          updatedAt: usage.updatedAt,
        }
        if (sessionId) {
          this.sessionStore.updateContextUsage(sessionId, contextUsage)
        }
        this.postMessage({
          type: "context_usage",
          percent: usage.percent,
          tokens: usage.tokens,
          maxTokens: usage.maxTokens,
          sessionId,
          breakdown: usage.breakdown,
          projected: usage.projected,
          cost: usage.cost,
          source: usage.source,
          updatedAt: usage.updatedAt,
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
        // Safety net for the chat-focus context key: a hidden view cannot be
        // focused, so force the key off (a missed iframe `blur` must never leave
        // suppressors active over the editor, e.g. blocking Ctrl+W).
        if (!webviewView.visible) {
          void vscode.commands.executeCommand("setContext", "opencodeHarness.chatFocused", false)
        }
        if (!webviewView.visible || !this.eventRouter.webviewReady) return
        log.debug("Webview became visible — running lightweight visible-state sync")
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
      this.retryQueueService.clear()
      this.eventRouter.clearReadyTimeout()
      this.eventRouter.earlyMessageQueue = []
      log.info("Chat webview disposed; active OpenCode runs remain attached for reload/replay")
    })

    log.info("Chat webview resolved")
  }

  private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
    const msgType = typeof msg?.type === "string" ? msg.type : "unknown"
    // Reliable webview-focus context key. `focusedView` is unreliable for webview
    // views (vscode#234683/#181667), so we track focus from inside the iframe and
    // mirror it to a context key. Keybindings gate on `opencodeHarness.chatFocused`
    // to override VS Code defaults (e.g. Alt+1/2/3 = openEditorAtIndex) ONLY while
    // the chat is focused — see package.json `keybindings`.
    if (msgType === "chat_focus") {
      void vscode.commands.executeCommand("setContext", "opencodeHarness.chatFocused", msg.focused === true)
      return
    }
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

  cycleMode(): void {
    const activeTab = this.tabManager.getActiveTab()
    if (activeTab) {
      this.postMessage({ type: "cycle_mode", sessionId: activeTab.id })
    }
  }

  setModeForActiveSession(mode: string): void {
    const activeTab = this.tabManager.getActiveTab()
    if (activeTab) {
      this.postMessage({ type: "set_mode", mode, sessionId: activeTab.id })
    }
  }

  async setupVoiceInput(): Promise<void> {
    invalidateExistsCache()
    const captureConfig = this.getVoiceCaptureConfig()
    const recorderPlan = selectRecorderPlan(captureConfig, process.platform, commandExists)
    const transcriberPlan = selectTranscriberPlan(captureConfig, commandExists)
    const pipViaPython = this.detectPipViaPython()
    const setupPlan = buildVoiceSetupPlan({
      hasRecorder: recorderPlan !== null,
      hasEngine: transcriberPlan !== null,
      pip: pickPipCommand(commandExists, pipViaPython),
      recorderInstall: recorderInstallCommand(process.platform, commandExists),
      hasUv: commandExists("uv"),
      hasPipx: commandExists("pipx"),
      externallyManaged: this.detectExternallyManagedPython(),
      uvBootstrap: uvBootstrapCommand(process.platform, commandExists),
    }, process.platform)

    this.voiceInputService.postSettings()

    if (setupPlan.ready) {
      const recorder = recorderPlan ? describeRecorderPlan(recorderPlan) : "recorder"
      const transcriber = transcriberPlan ? describeTranscriberPlan(transcriberPlan) : "speech-to-text engine"
      void vscode.window.showInformationMessage(`Voice input is ready: ${recorder} + ${transcriber}.`)
      return
    }

    const runnable = setupPlan.steps
      .map((step) => step.command)
      .filter((command): command is string => Boolean(command))
    const instructions = setupPlan.steps
      .map((step) => step.command ? `${step.label}\n${step.command}` : `${step.label}\n${step.manual ?? ""}`)
      .join("\n\n")
    const setupActions = runnable.length > 0
      ? ["Run Setup", "Copy Instructions", "Open Voice Settings"]
      : ["Copy Instructions", "Open Voice Settings"]
    const action = await vscode.window.showWarningMessage(
      "Local voice input needs a recorder and speech-to-text engine before the microphone button can transcribe.",
      ...setupActions,
    )

    if (action === "Run Setup" && runnable.length > 0) {
      const terminal = vscode.window.createTerminal("OpenCode Voice Setup")
      terminal.show()
      for (const command of runnable) {
        terminal.sendText(command)
      }
      void vscode.window.showInformationMessage(
        "Voice setup commands sent to the terminal. Once installation completes, reload the window (Developer: Reload Window) to activate voice input.",
      )
      return
    }
    if (action === "Copy Instructions") {
      await vscode.env.clipboard.writeText(instructions)
      void vscode.window.showInformationMessage("Voice setup instructions copied.")
      return
    }
    if (action === "Open Voice Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "opencode.voice")
    }
  }

  nextTab(): void {
    if (this._view) {
      this.postMessage({ type: "next_tab" })
    }
  }

  prevTab(): void {
    if (this._view) {
      this.postMessage({ type: "prev_tab" })
    }
  }

  retryLast(): void {
    const activeTab = this.tabManager.getActiveTab()
    if (activeTab) {
      this.postMessage({ type: "retry_last", sessionId: activeTab.id })
    }
  }

  /** Session ids of tabs that are currently streaming (navigation/status). */
  getStreamingSessionIds(): string[] {
    return this.tabManager
      .getAllTabs()
      .filter((tab) => tab.isStreaming)
      .map((tab) => tab.id)
  }

  /** Fires whenever a tab starts or stops streaming. */
  get onStreamingStateChanged(): vscode.Event<{ tabId: string; isStreaming: boolean }> {
    return this.tabManager.onStreamingStateChanged
  }

  openSettings(): void {
    if (this._view) {
      vscode.commands.executeCommand("workbench.action.openSettings", "opencode")
    }
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
    return this.diffAcceptService.handleCompactSession(sessionId)
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
        this.postMessage({ type: "command_list", commands: customCommands, partial: true })
        return
      }
      const commands = await this.sessionManager.listCommands()
      this.postMessage({ type: "command_list", commands: [...customCommands, ...commands] })
    } catch (err) {
      log.warn("Failed to refresh command list after MCP change", err)
      const customCommands = this.promptManager.getPromptCommands()
      this.postMessage({ type: "command_list", commands: customCommands, partial: true })
    }
  }

  // ---------------------------------------------------------------------------
  // Server event handler map - for lower complexity in handleServerEvent
  // ---------------------------------------------------------------------------

  private readonly serverEventHandlers: Map<string, (event: ServerEvent, tabId: string, tab?: { id: string; isStreaming: boolean }) => void | Promise<void>> = new Map([
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
    ["tool_partial", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as {
        id?: string
        tool?: string
        token?: number
        stdoutDelta?: string
        stderrDelta?: string
        stdout?: string
        stderr?: string
        stdoutLength?: number
        stderrLength?: number
        stdoutLineCount?: number
        stderrLineCount?: number
        replace?: boolean
        durationMs?: number
        exitCode?: number
      } | undefined
      const targetId = tab?.id || tabId
      if (!targetId || !data?.id || typeof data.token !== "number") return

      this.streamCoordinator.appendToolPartial(targetId, {
        id: data.id,
        tool: data.tool,
        token: data.token,
        stdoutDelta: data.stdoutDelta,
        stderrDelta: data.stderrDelta,
        stdout: data.stdout,
        stderr: data.stderr,
        stdoutLength: data.stdoutLength ?? 0,
        stderrLength: data.stderrLength ?? 0,
        stdoutLineCount: data.stdoutLineCount,
        stderrLineCount: data.stderrLineCount,
        replace: data.replace,
        durationMs: data.durationMs,
        exitCode: data.exitCode,
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["tool_end", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as {
        id?: string
        tool?: string
        ok?: boolean
        result?: unknown
        durationMs?: number
        exitCode?: number
        stderr?: string
        resultTruncated?: boolean
      } | undefined
      const targetId = tab?.id || tabId
      if (!targetId) return

      const toolCallId = data?.id || "unknown"
      const resultStr = typeof data?.result === "string" ? data.result : JSON.stringify(data?.result ?? "")

      this.streamCoordinator.appendToolEnd(targetId, {
        id: toolCallId,
        ok: typeof data?.ok === "boolean" ? data.ok : true,
        result: resultStr,
        durationMs: data?.durationMs,
        // M1: forward the defensively-extracted structured fields so the
        // bash card renderer's exit-code chip + stdout/stderr split panels
        // light up. No-op for tools that don't emit them.
        exitCode: typeof data?.exitCode === "number" ? data.exitCode : undefined,
        stderr: typeof data?.stderr === "string" ? data.stderr : undefined,
        resultTruncated: data?.resultTruncated === true ? true : undefined,
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
    // ──────────────────────────────────────────────────────────────────────
    // subagent_update: emitted by ActivityPartHandler when the SDK fires
    // `message.part.updated` with `part.type === "subtask"`. This is the
    // canonical live-status path for subagents (agentName/description/error).
    // Without this entry, the event was silently dropped by
    // dispatchServerEvent and the webview's subagent_update handler at
    // main.ts:3143 was unreachable. See docs/adrs/2026-06-06-subagent-as-first-class-entity.md.
    // ──────────────────────────────────────────────────────────────────────
    ["subagent_update", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as {
        id?: string
        agentName?: string
        status?: string
        currentActivity?: string
        inputPrompt?: string
        childSessionId?: string
        error?: string
      } | undefined
      const targetId = tab?.id || tabId
      if (!targetId || !data?.id) return

      this.streamCoordinator.recordSubagentActivity(targetId, {
        id: data.id,
        agentName: typeof data.agentName === "string" ? data.agentName : undefined,
        status: this.normalizeSubagentUpdateStatus(data.status),
        currentActivity: typeof data.currentActivity === "string" ? data.currentActivity : undefined,
        inputPrompt: typeof data.inputPrompt === "string" ? data.inputPrompt : undefined,
        childSessionId: typeof data.childSessionId === "string" ? data.childSessionId : undefined,
        error: typeof data.error === "string" ? data.error : undefined,
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
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
      const target = tab ?? this.tabManager.getActiveTab()
      if (target) {
        await this.streamCoordinator.maybeFinalizeStream(target.id, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m),
        }, "message_complete").catch(err => log.error("maybeFinalizeStream failed", err))
      } else {
        log.warn(`message_complete for unknown session ${event.sessionId || tabId} — no active tab, dropping`)
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
      const provider = this
      const currentTab = this.tabManager.getTab(tabId)
      // Plan mode: reject mutating permission requests before they ever reach the
      // webview, so the agent cannot apply changes while planning. Plan-document
      // writes (.opencode/plans/*.md) are exempted by shouldAutoRejectPlanPermission.
      if (data?.id && currentTab?.mode === "plan" && this.shouldAutoRejectPlanPermission({ type: data.type, pattern: data.pattern })) {
        const cliSessionId = event.sessionId || currentTab.cliSessionId || tabId
        log.info(`Auto-rejecting permission ${data.id} in plan mode for session ${tabId}`)
        void this.sessionManager.respondToPermission(cliSessionId, data.id, "reject")
          .catch(err => log.warn(`Failed to reject plan-mode permission ${data.id}`, err))
        recordPermissionActivity()
        return
      }
      // Auto mode: approve once without prompting the user.
      if (data?.id && currentTab?.mode === "auto") {
        const cliSessionId = event.sessionId || currentTab.cliSessionId || tabId
        log.info(`Auto-approving permission ${data.id} in auto mode for session ${tabId}`)
        void this.sessionManager.respondToPermission(cliSessionId, data.id, "once")
          .catch(err => log.warn(`Failed to auto-approve permission ${data.id}`, err))
        recordPermissionActivity()
        return
      }
      // Build mode (and any other): preserve the protected-path guard.
      if (data?.id && currentTab?.mode) {
        const cliSessionId = event.sessionId || currentTab.cliSessionId || tabId
        const decision = resolvePermissionForMode(
          normalizeSessionMode(currentTab.mode),
          { type: data.type, permissionType: data.type, pattern: data.pattern },
        )
        if (decision === "once" || decision === "reject") {
          log.info(`${decision === "once" ? "Auto-approving" : "Auto-rejecting"} permission ${data.id} in ${currentTab.mode} mode for session ${tabId}`)
          void this.sessionManager.respondToPermission(cliSessionId, data.id, decision)
            .catch(err => log.warn(`Failed to ${decision} mode permission ${data.id}`, err))
          recordPermissionActivity()
          return
        }
      }
      function recordPermissionActivity(): void {
        if (tab?.id || tabId) {
          provider.streamCoordinator.recordExternalActivity(tab?.id || tabId, {
            kind: "permission",
            label: data?.title || `Waiting for ${data?.type || "permission"}`,
          }, { postMessage: (m) => provider.postMessage(m), postRequestError: (m) => provider.postRequestError(m) })
        }
      }
      recordPermissionActivity()
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
    ["question_asked", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const targetId = tab?.id || tabId
      if (!targetId) return
      const data = event.data as { requestID?: string; toolCallId?: string; messageId?: string; block?: Block } | undefined
      const block = data?.block
      if (!block || block.type !== "question") return
      // Normalize the block's sessionId to the parent tab's ID so the
      // question bar renders it against the correct session. Subagent
      // (child session) questions carry the child sessionId but must
      // appear in the parent tab's question bar (Gap 4 fix).
      if (block.sessionId !== targetId) {
        block.sessionId = targetId
      }
      const questionId = this.stringValue(block.requestID) ?? this.stringValue(block.toolCallId) ?? this.stringValue(block.id) ?? data?.requestID
      if (!questionId) return

      this.ensureQuestionBlock(targetId, data?.messageId, questionId, block)
      this.streamCoordinator.recordExternalActivity(targetId, {
        kind: "agent",
        label: "Waiting for your answer",
      }, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["question_replied", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { requestID?: string; answers?: unknown } | undefined
      const questionId = data?.requestID
      if (!questionId) return
      const answer = this.questionAnswersToText(data.answers) || "Answered"
      this.sessionStore.markQuestionAnswered(tabId, questionId, answer, "response")
      this.postMessage({ type: "question_acknowledged", sessionId: tabId, toolCallId: questionId, requestID: questionId })
    }],
    ["question_rejected", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { requestID?: string } | undefined
      const questionId = data?.requestID
      if (!questionId) return
      this.sessionStore.markQuestionAnswered(tabId, questionId, "Skipped", "skip")
      this.postMessage({ type: "question_acknowledged", sessionId: tabId, toolCallId: questionId, requestID: questionId })
    }],
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
            isPlanDocument: this.isPlanDocumentPattern(path),
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
    ["activity", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      this.appendActivityBlock(tabId, event.data)
    }],
    ["agent_activity", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      this.appendActivityBlock(tabId, event.data, "Agent activity")
    }],
    ["retry_activity", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      this.appendActivityBlock(tabId, event.data, "Provider retry")
    }],
    ["compaction_activity", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      this.appendActivityBlock(tabId, event.data, "Compaction")
    }],
    ["unknown_server_event", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string) => {
      const data = event.data as { eventType?: string; classification?: "unclassified" | "safe_ignored"; preview?: string } | undefined
      const eventType = data?.eventType || "unknown"
      log.warn(`Unknown OpenCode server event: ${eventType}${data?.preview ? ` ${data.preview}` : ""}`)
      this.postMessage({
        type: "unknown_server_event",
        sessionId: tabId || event.sessionId,
        eventType,
        classification: data?.classification || "unclassified",
        preview: data?.preview,
      })
      if (tabId) this.appendActivityBlock(tabId, {
        eventType,
        title: "Unsupported OpenCode event",
        detail: data?.preview,
      })
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
        // The host SessionStore is the canonical token/cost ledger. Cumulative
        // totals let the webview SET its display state instead of accumulating
        // a parallel ledger — idempotent under SSE replay and consistent
        // across tab switches and webview reloads.
        const ledger = this.sessionStore.get(tabId)
        this.postMessage({
          type: "step_tokens",
          sessionId: tabId,
          tokens: { input: usage.prompt, output: usage.completion, reasoning: usage.reasoning, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
          cost: data.cost ?? 0,
          cumulative: ledger?.tokenUsage,
          cumulativeCost: ledger?.cost,
        })
      }
    }],
    ["server_error", (event: { type: string; sessionId?: string; data?: unknown }, tabId: string, tab?: { id: string; isStreaming: boolean }) => {
      const data = event.data as { error?: unknown } | undefined
      const raw = data?.error ?? event.data ?? "Server error"
      // Intentional-abort suppression: Stop / interrupt-and-send call abort(), which
      // makes the server emit MessageAbortedError on the SSE stream a beat later. That
      // is expected, not a failure — surfacing it would show a spurious "The request
      // was cancelled." card and (worse) tear down a replacement run started by an
      // interrupt. Swallow it for the specific tab that was just aborted.
      const abortTabId = tab?.id ?? tabId
      if (abortTabId && isAbortErrorValue(raw) && this.streamCoordinator.wasIntentionallyAborted(abortTabId)) {
        log.info(`Suppressing expected abort error for intentionally-aborted tab ${abortTabId}`)
        return
      }
      // Preserve structured fidelity for genuine SDK errors (ProviderAuthError,
      // ApiError, …): map once on the host and carry the full ErrorContext to the
      // webview. Non-SDK values (SSE connection strings, command failures) keep the
      // existing friendly string path.
      const errorContext = looksLikeSdkError(raw) ? mapOpencodeError(raw as OpencodeError) : undefined
      const errorMsg = errorContext?.userMessage ?? this.errorValueToMessage(raw)
      log.error("Server error during streaming", errorMsg)
      if (this.isEventStreamTransportError(raw)) {
        const targetId = tab?.id || this.tabManager.getActiveTab()?.id || tabId
        log.warn(`Transport-level OpenCode event stream error for ${targetId || "unknown"}; preserving active run state`)
        if (targetId) this.postRequestError(errorMsg, targetId, errorContext)
        return
      }
      // CRITICAL: clean up StreamCoordinator state alongside TabManager.
      // Without this, the coordinator's per-tab maps (activeRuns, ttfbTimeouts,
      // subagentHeartbeat, deferredChunks) keep stale entries, causing the next
      // prompt send in the same tab to hit polluted state.
      if (tab) {
        this.postRequestError(errorMsg, tab.id, errorContext)
        this.streamCoordinator.cleanupTab(tab.id)
        this.tabManager.setStreaming(tab.id, false)
        this.tabManager.setWaitingForCompletion(tab.id, false)
        this.tabManager.clearCompletionTimeout(tab.id)
      } else {
        // Route to active tab only if it's actually streaming
        const activeTab = this.tabManager.getActiveTab()
        if (activeTab && activeTab.isStreaming) {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — routing to active tab ${activeTab.id}`)
          this.postRequestError(errorMsg, activeTab.id, errorContext)
          this.streamCoordinator.cleanupTab(activeTab.id)
          this.tabManager.setStreaming(activeTab.id, false)
          this.tabManager.setWaitingForCompletion(activeTab.id, false)
          this.tabManager.clearCompletionTimeout(activeTab.id)
        } else if (activeTab) {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — active tab ${activeTab.id} is not streaming, skipping state reset`)
          this.postRequestError(errorMsg, activeTab.id, errorContext)
        } else {
          log.warn(`server_error for unknown session ${event.sessionId || tabId} — no active tab, dropping`)
        }
      }
    }],
    ["server_disconnected", () => {
      log.info("Server disconnected — capturing streaming snapshot and resetting states")
      this.tabManager.captureStreamingSnapshot()
      for (const t of this.tabManager.getAllTabs()) {
        if (t.isStreaming) {
          this.streamCoordinator.cleanupTab(t.id)
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
      log.info("Event stream reconnected — reconciling active streaming sessions and checking for interrupted tabs")
      for (const t of this.tabManager.getAllTabs()) {
        if (t.isStreaming) {
          this.streamCoordinator.reconcileAfterReconnect(t.id, {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          }).catch(err => log.error("Reconcile after reconnect failed", err))
        }
      }
      const interrupted = this.tabManager.getInterruptedTabs()
      if (interrupted.length > 0) {
        log.info(`Found ${interrupted.length} interrupted tab(s) — offering resume`)
        for (const state of interrupted) {
          this.postMessage({
            type: "stream_interrupted",
            sessionId: state.tabId,
            cliSessionId: state.cliSessionId,
            interruptedAt: state.interruptedAt,
          })
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
        messageCount: computeMessageCounts(s.messages).userTurns,
        cost: s.cost || 0,
        workspacePath: s.workspacePath,
        pinned: s.pinned === true,
        tags: Array.isArray(s.tags) ? s.tags : [],
      })),
    })
  }

  private handleServerEvent(event: ServerEvent): void {
    if (!this._view) {
      log.debug(`Handling server event ${event.type} with no active webview; state will be replayed on reload`)
    }

    const isHighFrequency = this.isHighFrequencyServerEvent(event)
    this.logIncomingServerEvent(event, isHighFrequency)

    const { tab, drop } = this.resolveServerEventTab(event)
    if (drop) return

    if (this.bufferServerEventIfNeeded(event, tab, isHighFrequency)) {
      return
    }
    if (tab && !isHighFrequency) log.debug(`Routed server event ${event.type} to tab: ${tab.id}`)

    this.dispatchServerEvent(event, tab?.id || event.sessionId || "", tab)
  }

  private isHighFrequencyServerEvent(event: ServerEvent): boolean {
    return event.type === "text_chunk" || event.type === "tool_update" || event.type === "tool_partial" || event.type === "tool_end" || event.type === "tool_start"
  }

  private logIncomingServerEvent(event: ServerEvent, isHighFrequency: boolean): void {
    if (!isHighFrequency) log.debug(`Incoming server event: ${event.type} (sessionId: ${event.sessionId})`)
  }

  private resolveServerEventTab(event: ServerEvent): { tab?: TabState; drop: boolean } {
    let tab: TabState | undefined
    if (event.sessionId) {
      tab = this.tabManager.getTabByCliSessionId(event.sessionId) ?? this.tabManager.getTab(event.sessionId)
      if (!tab) {
        // Check if this is a child session ID mapped to a parent tab
        const parentTabId = this.childSessionToTab.get(event.sessionId)
        if (parentTabId) {
          tab = this.tabManager.getTab(parentTabId)
        }
      }
    } else {
      tab = this.resolveSessionlessFileEditTab(event)
    }
    return { tab, drop: event.type === "file_edited" && !event.sessionId && !tab }
  }

  private resolveSessionlessFileEditTab(event: ServerEvent): TabState | undefined {
    if (event.sessionId || event.type !== "file_edited") return undefined

    // A file.edited event with no sessionID cannot be attributed by the server.
    // Credit it ONLY to a session whose agent is actively streaming right now —
    // a live edit produced by that running session. We deliberately do NOT fall
    // back to a merely-active (idle) tab: that fallback is how edits made outside
    // opencode (another tool/model writing files on disk) leaked into whichever
    // session happened to be open, polluting its changed-files dropdown. If zero
    // or several sessions are streaming, attribution is ambiguous — drop it
    // rather than guess, so the dropdown only ever shows this session's edits.
    const liveTabs = this.tabManager.getAllTabs().filter((t) => t.isStreaming || t.waitingForCompletion)
    const tab = liveTabs.length === 1 ? liveTabs[0] : undefined

    if (tab) {
      log.debug(`Attributed sessionless file_edited event to streaming tab: ${tab.id}`)
    } else {
      log.warn(`Dropping sessionless file_edited event: ${liveTabs.length === 0 ? "no streaming session" : "ambiguous (multiple streaming sessions)"}`)
    }
    return tab
  }

  private bufferServerEventIfNeeded(event: ServerEvent, tab: TabState | undefined, isHighFrequency: boolean): boolean {
    if (tab || !event.sessionId || event.type === "session_status" || event.type === "server_connected") {
      return false
    }

    // Buffer events for the race window before the tab mapping is registered.
    // This covers:
    //   1. First-prompt race (~5ms between session.create and setCliSessionId)
    //   2. Child session events arriving before heartbeat discovery (~5s max)
    //   Both windows are short; the 10s TTL handles both. Child session events
    //   that expire here are safe to drop (not needed by parent — heartbeat +
    //   subagent_update on parent stream provide all required subagent state).
    this.pendingEventBuffer.add(event.sessionId, event)
    if (!isHighFrequency) {
      log.debug(`Buffered ${event.type} for cliSessionId "${event.sessionId}" (size=${this.pendingEventBuffer.size(event.sessionId)})`)
    }
    return true
  }

  private dispatchServerEvent(event: ServerEvent, targetTabId: string, tab: TabState | undefined): void {
    const handler = this.serverEventHandlers.get(event.type)
    if (handler) {
      handler(event, targetTabId, tab ?? undefined)
    } else {
      log.warn(`No handler for server event type: ${event.type}`)
    }
  }

  private ensureQuestionBlock(sessionId: string, messageId: string | undefined, questionId: string, block: Block): void {
    const session = this.sessionStore.get(sessionId)
    const alreadyStored = session?.messages.some((message) =>
      message.blocks.some((candidate) => {
        const rec = candidate as Record<string, unknown>
        return rec.type === "question" &&
          (rec.requestID === questionId || rec.toolCallId === questionId || rec.id === questionId)
      })
    )
    const msgId = messageId || `question-${questionId}`
    const message: ChatMessage = {
      role: "assistant",
      id: msgId,
      blocks: [block],
      timestamp: Date.now(),
      sessionId,
    }
    if (!alreadyStored) {
      this.sessionStore.appendMessage(sessionId, message)
    }
    // 1) Render the inline transcript pointer card so users see context above.
    this.postMessage({ type: "message", sessionId, message })
    // 2) Populate the question bar (B1 fix). Without this second post, a
    //    question.asked event arriving WITHOUT a matching tool part (the
    //    common case for question.v2.asked with tool: undefined) renders the
    //    pointer but never reaches questionBar.addQuestion — the user sees
    //    the question but has no way to answer. The webview's question_asked
    //    handler is dead code without this post.
    this.postMessage({ type: "question_asked", sessionId, block, messageId: msgId })
  }

  private appendActivityBlock(sessionId: string, data: unknown, fallbackTitle = "OpenCode activity"): void {
    if (!sessionId) return
    const rec = this.isRecord(data) ? data : {}
    const title = this.stringValue(rec.title) || fallbackTitle
    const detail = this.stringValue(rec.detail) || this.stringValue(rec.text) || this.stringValue(rec.error)
    const eventType = this.stringValue(rec.eventType)
    // Content signature drives deduplication: the same activity re-delivered
    // (reconnect, pending-event replay) collapses into the previous card with a
    // repeat count instead of stacking a duplicate. The id stays unique per
    // *new* card so genuinely separate, non-adjacent repeats still surface.
    const signature = activitySignature(eventType, title, detail)
    const id = this.stringValue(rec.id) || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const block: Block = {
      type: "activity",
      id,
      title,
      detail,
      eventType,
      signature,
      repeatCount: 1,
    }
    const message: ChatMessage = {
      role: "system",
      id,
      blocks: [block],
      timestamp: Date.now(),
      sessionId,
    }
    const stored = this.sessionStore.appendOrCoalesceActivity(sessionId, message, signature)
    if (stored) this.postMessage({ type: "message", sessionId, message: stored })
  }

  private questionAnswersToText(value: unknown): string {
    if (!Array.isArray(value)) return ""
    return value
      .map((group) => Array.isArray(group) ? group.filter((entry): entry is string => typeof entry === "string").join(", ") : "")
      .filter(Boolean)
      .join("; ")
  }

  private isEventStreamTransportError(raw: unknown): boolean {
    const message = this.errorValueToMessage(raw).toLowerCase()
    return message.includes("event stream") ||
      message.includes("sse") ||
      message.includes("global/event") ||
      message.includes("communication is connected")
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
  }

  private shouldAutoRejectPlanPermission(data: { type?: string; pattern?: string | string[] }): boolean {
    return this.diffAcceptService.shouldAutoRejectPlanPermission(data)
  }

  private isPlanDocumentPattern(pattern: string | string[]): boolean {
    return this.diffAcceptService.isPlanDocumentPattern(pattern)
  }

  private async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
    return this.diffAcceptService.handleAcceptDiff(blockId, sessionId)
  }

  private syncActiveSession(): void {
    return this.sessionSync.syncActiveSession()
  }

  private pushModelToWebview(model?: string): void {
    return this.sessionSync.pushModelToWebview(model)
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
    const activeSessionId = this.sessionStore.activeId || this.tabManager.getActiveId() || ""

    // Keep ContextMonitor in sync with the active model/provider so cost
    // calculations and usage history get accurate stamps.
    const activeModel = model ?? this.modelManager.model
    if (activeModel) {
      const { providerID, modelID } = parseModelRef(activeModel)
      this.contextMonitor.setModelAndProvider(modelID || activeModel, providerID || "anthropic")
    }

    const outputLimit = this.modelManager.getOutputLimit(model)

    if (effectiveWindow && effectiveWindow > 0) {
      this.contextMonitor.setTokenLimit(effectiveWindow, activeSessionId)
      this.updateStoredContextWindow(activeSessionId, effectiveWindow)
      this.statePush.postMessage({
        type: "context_window_known",
        sessionId: activeSessionId,
        maxTokens: effectiveWindow,
        outputLimit,
        source: override > 0 ? "override" : (resolvedWindow ? "server-or-openrouter" : "unknown"),
      })
    } else {
      // Window unknown: tell the webview so it can hide the chip and show
      // a "Set limit" affordance in the dropdown instead.
      this.statePush.postMessage({
        type: "context_window_unknown",
        sessionId: activeSessionId,
        modelId: model || this.modelManager.model,
        suppressStatusChip: true,
      })
    }
  }

  private pushModelListToWebview(): void {
    return this.sessionSync.pushModelListToWebview()
  }

  private pushMcpServersToWebview(): void {
    return this.sessionSync.pushMcpServersToWebview()
  }

  private pushRateLimitStateToWebview(): void {
    return this.sessionSync.pushRateLimitStateToWebview()
  }

  private updateStoredContextWindow(sessionId: string, maxTokens: number): void {
    if (!sessionId || maxTokens <= 0) return
    const existing = this.sessionStore.getContextUsage(sessionId)
    if (!existing || existing.tokens <= 0) return
    const percent = Math.min(100, Math.max(0, (existing.tokens / maxTokens) * 100))
    this.sessionStore.updateContextUsage(sessionId, {
      ...existing,
      maxTokens,
      percent,
      updatedAt: Date.now(),
    })
  }

  private pushContextUsageForSession(sessionId?: string): void {
    if (!sessionId) return
    const usage = this.contextMonitor.getCurrentUsage(sessionId) ?? this.sessionStore.getContextUsage(sessionId)
    if (!usage) return
    const outputLimit = this.modelManager.getOutputLimit()
    log.debug(`Pushing context usage for ${sessionId}: ${usage.tokens}/${usage.maxTokens} (${usage.percent}%, ${usage.source ?? "estimated"})`)
    this.postMessage({
      type: "context_usage",
      ...usage,
      outputLimit,
      sessionId,
    })
  }

  private pushInitStateToWebview(): void {
    const MAX_MESSAGES_PER_TAB = 50
    const restoreOpenTabs = vscode.workspace.getConfiguration("opencode").get<boolean>("sessions.restoreOpenTabs", true)

    // Restore the exact set of tabs the user had open, in their original
    // order. The persisted list lives in globalState (TabManager.persist).
    // Treat it as a startup import only. Runtime state syncs must not revive a
    // tab the user already closed in this extension session.
    const isFirstHydration = !this.backfillService.isHydrated
    const shouldHydrateRestoredTabs = restoreOpenTabs && isFirstHydration
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

    const explicitActiveId = this.sessionStore.activeId
    const storeActive = explicitActiveId ? this.sessionStore.get(explicitActiveId) : undefined
    // Force-include the store's active session so it always has a tab — but on
    // a live refresh only if it still has an open tab. Otherwise a session
    // whose tab the user already closed (yet still lingers as the store's
    // active id) would be resurrected on the next visibility refresh.
    const includeStoreActive =
      !!storeActive &&
      shouldIncludeStoreActiveFallback({
        hydrating: isFirstHydration,
        activeHasOpenTab: !!storeActive && !!this.tabManager.getTab(storeActive.id),
      })
    if (includeStoreActive && storeActive && !hasSeenRestorableSession(storeActive) && !storeActive.archived && this.isSessionInCurrentWorkspace(storeActive)) {
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
      contextUsage: this.sessionStore.getContextUsage(s.id),
      totalMessages: s.messages.length,
    }))

    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? ""
    const maxConcurrentStreams = vscode.workspace.getConfiguration("opencode").get<number>("sessions.maxConcurrentStreams", 5)
    this.postMessage({
      type: "init_state",
      sessions: sessionsToSend,
      activeSessionId: activeId,
      globalModel: this.modelManager.model || "",
      workspaceName,
      maxConcurrentStreams,
    })
    this.pushToolOutputConfigToWebview()
    this.backfillService.setHydrated(true)
  }

  private pushToolOutputConfigToWebview(): void {
    const renderAnsi = vscode.workspace.getConfiguration("opencode").get<boolean>("toolOutput.renderAnsi", false)
    this.postMessage({ type: "tool_output_config", renderAnsi })
  }

private isSessionInCurrentWorkspace(session: import("../session/SessionStore").OpenCodeSession): boolean {
    const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return isSessionInCurrentWorkspacePure(session.workspacePath, currentWorkspace)
  }

  private async pushAllStateToWebview(): Promise<void> {
    // Defer init_state until after the model list attempt so the webview
    // receives a populated globalModel (avoiding a "No model selected" flash
    // on the welcome screen). If the model list fetch takes >2s, proceed
    // with whatever we have — the model_list event will update the webview
    // when it arrives.
    if (!this.modelManager.model) {
      try {
        await Promise.race([
          this.modelManager.refreshModels(this.sessionManager.currentPort, this.sessionManager.authHeader),
          new Promise<void>((_, reject) => {
            const id = setTimeout(() => reject(new Error("timeout")), 2_000)
            if (typeof id === "object" && typeof id.unref === "function") id.unref()
          }),
        ])
      } catch {
        log.warn("Init-state model refresh timed out — proceeding without a model; model_list will follow")
      }
    }
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
    log.debug("pushVisibleStateToWebview: lightweight sync")
    this.pushModelToWebview()
    this.pushRateLimitStateToWebview()
    const activeSessionId = this.sessionStore.activeId || this.tabManager.getActiveId()
    this.applyContextWindowFor()
    this.pushContextUsageForSession(activeSessionId)
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
    const passthrough = ["init_state", "theme_vars", "theme_config", "tool_output_config", "rate_limit_state", "model_update", "model_list", "webview_ready", "session_list_update"]
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
    return this.messagePostService.postRawMessage(msg)
  }

  private postRequestError(message: string, sessionId?: string, errorContext?: unknown): void {
    this.messagePostService.postRequestError(message, sessionId, errorContext)
  }

  /** O5: Called when webview.postMessage resolves to false (saturation / refused). */
  private recordPostMessageRejected(msg: Record<string, unknown>): void {
    this.retryQueueService.recordPostMessageRejected(msg)
  }

  /** P2: Schedule a retry for a failed critical message with exponential backoff */
  private scheduleRetry(msg: Record<string, unknown>): void {
    this.retryQueueService.scheduleRetry(msg)
  }

  /** P2: Process retry queue with exponential backoff */
  private processRetryQueue(): void {
    this.retryQueueService.processRetryQueue()
  }

  private toUserErrorMessage(message: string): string {
    return this.retryQueueService.toUserErrorMessage(message)
  }

  private errorValueToMessage(value: unknown): string {
    return this.retryQueueService.errorValueToMessage(value)
  }

  private mapToolType(tool: string): string {
    return this.messagePostService.mapToolType(tool)
  }

  /**
   * Map a free-form status string from a `subagent_update` event payload to
   * the typed {@link SubagentRunStatus} set expected by RunActivityTracker.
   * Unknown / non-canonical values default to `"unknown"` (NOT `"running"`).
   * Returning `"running"` for unknown values caused subagents to be stuck
   * "Running" forever when the server sent a status string the host did not
   * recognize (e.g. a new status type from a future opencode version). The
   * legacy comment claimed "a terminated subagent would arrive via tool_end",
   * but that is not reliable — tool_end can be delayed, dropped, or never
   * emitted for some subagent types. With "unknown" the reconciler in the
   * webview can finalize dropped subagents correctly.
   */
  private normalizeSubagentUpdateStatus(raw: string | undefined): SubagentRunStatus {
    switch (raw) {
      case "queued":
      case "running":
      case "waiting":
      case "completed":
      case "failed":
      case "cancelled":
      case "unknown":
      case "pending":
        return raw === "pending" ? "queued" : (raw as SubagentRunStatus)
      default:
        return "unknown"
    }
  }

  private async handleInsertAtCursor(code: string, language: string): Promise<void> {
    await this.codeInsertionService.handleInsertAtCursor(code, language)
  }

  private async handleCreateFileFromCode(code: string, language: string): Promise<void> {
    await this.codeInsertionService.handleCreateFileFromCode(code, language)
  }

  private languageExtension(language: string): string {
    return this.codeInsertionService.languageExtension(language)
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
    return this.stashService.handleStashPrompt(name, content, isGlobal)
  }

  private handleListStashes(): void {
    return this.stashService.handleListStashes()
  }

  private async handleDeleteStash(id: string): Promise<void> {
    return this.stashService.handleDeleteStash(id)
  }

  private async handleAddProvider(name: string, apiKey: string, baseUrl?: string): Promise<void> {
    return this.providerManagementService.handleAddProvider(name, apiKey, baseUrl)
  }

  private handleListProviders(): void {
    return this.providerManagementService.handleListProviders()
  }

  private async handleUpdateProvider(id: string, updates: Record<string, unknown>): Promise<void> {
    return this.providerManagementService.handleUpdateProvider(id, updates)
  }

  private async handleDeleteProvider(id: string): Promise<void> {
    return this.providerManagementService.handleDeleteProvider(id)
  }

  private async handleCompactBannerAction(sessionId: string | undefined, action: string): Promise<void> {
    await this.diffAcceptService.handleCompactBannerAction(sessionId, action)
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
    return this.slashCommands.runSlashCommandOnActiveTab(commandName)
  }

  /** Open the in-webview commands palette. */
  openCommandsPalette(): void {
    return this.slashCommands.openCommandsPalette()
  }

  async handleClearCommand(sessionId: string): Promise<void> {
    return this.slashCommands.handleClearCommand(sessionId)
  }

  async handleCostCommand(sessionId: string): Promise<void> {
    return this.slashCommands.handleCostCommand(sessionId)
  }

  async handleContinueCommand(sessionId: string): Promise<void> {
    return this.slashCommands.handleContinueCommand(sessionId)
  }

  async abortCurrentSession(): Promise<void> {
    return this.slashCommands.abortCurrentSession()
  }

  handleHelpCommand(sessionId: string): void {
    return this.slashCommands.handleHelpCommand(sessionId)
  }

  /**
   * Open a new VS Code editor webview panel dedicated to a single subagent
   * detail. Returns a popout id (stable across the panel's lifetime) so the
   * webview can correlate init_state / subagent_detail messages. Returns
   * undefined if the host failed to create the panel (e.g. user cancelled
   * the open of multiple editors).
   *
   * The panel uses a minimal message channel: we forward any
   * `subagent_detail` message to all open popout panels, and the popout
   * filters by subagentId. This keeps the implementation simple while
   * supporting N concurrent popouts.
   */
  openSubagentDetailPanel(parentSessionId: string, subagentId: string): string | undefined {
    if (!this._view) {
      log.warn("openSubagentDetailPanel: main webview is not resolved yet")
      return undefined
    }
    const popoutId = crypto.randomUUID()
    const panel = vscode.window.createWebviewPanel(
      "opencode-harness.subagentDetail",
      `Subagent ${subagentId.slice(0, 8)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "chat", "webview"),
          vscode.Uri.joinPath(this.context.extensionUri, "src", "chat", "webview"),
        ],
        retainContextWhenHidden: true,
      },
    )
    panel.webview.html = this.webviewContent.buildForPopout(
      panel.webview,
      this.themeManager,
      parentSessionId,
      subagentId,
    )

    const entry = { panel, parentSessionId, subagentId }
    this.subagentDetailPanels.set(popoutId, entry)

    panel.onDidDispose(() => {
      this.subagentDetailPanels.delete(popoutId)
    }, null, this.disposables)

    // Handle messages from the popout webview. The popout can request its
    // detail and post subagent updates back. Other message types are
    // ignored — the popout is read-only.
    panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      const t = typeof msg?.type === "string" ? msg.type : ""
      if (t === "popout_get_subagent_detail") {
        try {
          const synthetic = { type: "get_subagent_detail", subagentId, sessionId: parentSessionId }
          await this.eventRouter.route(synthetic)
        } catch (err) {
          log.error(`popout_get_subagent_detail failed for ${subagentId}`, err)
        }
      } else if (t === "popout_cancel_subagent") {
        try {
          await this.eventRouter.route({ type: "cancel_subagent", subagentId })
        } catch (err) {
          log.error(`popout_cancel_subagent failed for ${subagentId}`, err)
        }
      } else if (t === "webview_log") {
        log.info(`[popout ${popoutId.slice(0, 8)}] ${String(msg.message ?? "")}`)
      } else {
        log.warn(`popout ${popoutId.slice(0, 8)}: unhandled message type ${t}`)
      }
    }, null, this.disposables)

    return popoutId
  }

  /**
   * Forward a `subagent_detail` message to all open popout panels whose
   * subagentId matches. Called by the event router after a
   * get_subagent_detail fetch completes. Returns true if any popout was
   * targeted (caller can use this to skip posting to the main webview if
   * only the popout wanted this detail).
   */
  postSubagentDetailToPopouts(detail: Record<string, unknown>, subagentId: string): boolean {
    if (this.subagentDetailPanels.size === 0) return false
    let anySent = false
    for (const [popoutId, entry] of this.subagentDetailPanels) {
      if (entry.subagentId !== subagentId) continue
      try {
        entry.panel.webview.postMessage({ type: "subagent_detail", sessionId: entry.parentSessionId, subagentId, detail })
        anySent = true
      } catch (err) {
        log.error(`Failed to post subagent_detail to popout ${popoutId.slice(0, 8)}`, err)
      }
    }
    return anySent
  }

  dispose(): void {
    this.backfillService.dispose()
    this.retryQueueService.dispose()
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
    this.voiceInputService?.dispose()
    this.eventRouter.clearReadyTimeout()
    this.webviewContent?.dispose()
  }
}
