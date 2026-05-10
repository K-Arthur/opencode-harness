import * as vscode from "vscode"
import * as path from "path"
import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { ContextEngine } from "../context/ContextEngine"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { ThemeManager } from "../theme/ThemeManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { ModelManager } from "../model/ModelManager"
import { CheckpointManager } from "../checkpoint/CheckpointManager"
import { DiffApplier } from "../diff/DiffApplier"
import { WebviewContent } from "./WebviewContent"
import { TabManager } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import { PromptManager, PromptCommand } from "../prompts/PromptManager"
import { log } from "../utils/outputChannel"
import { parseModelRef } from "../utils/tokenCounter"
import { checkFileSecurity } from "../utils/security"
import { ChatMessage, Block } from "./types"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { MessageRouter } from "./handlers/MessageRouter"
import { ChatCommands } from "./ChatCommands"
import { AutoCompactor } from "./AutoCompactor"
import { ChatFileOps } from "./ChatFileOps"
import { ChunkBatcher } from "./ChunkBatcher"
import { McpServerManager } from "../mcp/McpServerManager"
import { ThemeController } from "./ThemeController"
import { StatePushService } from "./StatePushService"

export class ChatProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view?: vscode.WebviewView
  private diffApplier = new DiffApplier()
  private disposables: vscode.Disposable[] = []
  private webviewReady = false

  private webviewContent: WebviewContent
  private tabManager: TabManager
  private streamCoordinator: StreamCoordinator
  private messageRouter: MessageRouter
  private promptManager: PromptManager
  private pendingPrompt?: { text: string; autoSend: boolean }
  private pendingOpenSessionId?: string
  private chatCommands: ChatCommands
private autoCompactor: AutoCompactor
  private fileOps = new ChatFileOps()
  private themeController: ThemeController
  private statePush: StatePushService
  private restoredTabsHydrated = false

  /** H3: Queue of messages buffered before webview was ready */
  private earlyMessageQueue: Record<string, unknown>[] = []

  /** H6: Guard against duplicate prompt submissions — per-tab lock */
  private promptsInFlight = new Set<string>()

  /** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
  private chunkBatcher = new ChunkBatcher(
    (msg) => { this._view?.webview.postMessage(msg) },
    (msg) => log.info(msg),
  )

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
    this.themeController = new ThemeController(themeManager, (msg) => this.postMessage(msg))
    this.statePush = new StatePushService({
      postMessage: (msg) => this.postMessage(msg),
      tabManager: this.tabManager,
      sessionStore: this.sessionStore,
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

    this._view = webviewView
    // H15: Reset ready state on re-solve to handle webview recreation
    this.webviewReady = false

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
        if (!webviewView.visible || !this.webviewReady) return
        this.pushVisibleStateToWebview()
      })
    )

    // Webview message handler
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
        try {
          await this.handleWebviewMessage(msg)
        } catch (err) {
          log.error("Error handling webview message", err)
        }
      })
    )

    webviewView.onDidDispose(() => {
      this._view = undefined
      this.webviewReady = false
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

  private static readonly VALID_WEBVIEW_TYPES = new Set([
    "create_tab", "send_prompt", "change_mode", "set_model", "set_variant", "abort",
    "close_tab", "switch_tab", "accept_diff", "reject_diff",
    "accept_permission", "mention_search", "list_sessions", "resume_session",
    "new_session", "get_models", "update_cost", "webview_ready", "rename_session", "webview_log",
    "open_settings", "connect_provider", "open_mcp_settings", "open_mcp_config", "attach_files", "export_chat",
    "compact_session", "execute_command", "list_commands",
    "insert_at_cursor", "create_file_from_code", "compact_banner_action",
    "edit_message", "attach_image",
    "delete_session", "archive_session", "revert_message",
    "list_server_sessions", "delete_server_session", "resume_server_session",
    "add_mcp_server", "update_mcp_server", "remove_mcp_server", "toggle_mcp_server", "get_mcp_servers",
    "show_diff", "list_checkpoints", "restore_checkpoint",
    "preview_theme", "get_theme_config", "update_theme_config", "list_cli_themes",
    "request_more_messages", "stream_ack", "retry_stream", "request_state_sync",
  ])

  // ---------------------------------------------------------------------------
  // Webview message handler map - for lower complexity in handleWebviewMessage
  // ---------------------------------------------------------------------------

  private readonly webviewHandlers: Map<string, (msg: Record<string, unknown>, sessionId?: string) => void | Promise<void>> = new Map([
    ["create_tab", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        this.ensureLocalTab(
          sessionId,
          typeof msg.name === "string" ? msg.name : undefined,
          typeof msg.model === "string" ? msg.model : undefined,
          typeof msg.mode === "string" ? msg.mode : undefined
        )
      }
    }],
    // ... other handlers ...
    ["show_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      const filePath = msg.filePath as string
      const proposed = msg.proposedContent as string
      const title = msg.title as string | undefined
      if (filePath && proposed) {
        await this.diffApplier.showSideBySideDiff(filePath, proposed, title)
      }
    }],
    ["send_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.text === "string" && msg.text.trim()) {
        if (this.promptsInFlight.has(sessionId)) return
        this.promptsInFlight.add(sessionId)
        try {
          const model = (msg.model as string | undefined) || this.modelManager.model
          if (!model) { throw new Error("No model selected. Please select a model and try again.") }
          this.ensureLocalTab(sessionId, msg.name as string | undefined, model, msg.mode as string | undefined)
          const variant = typeof msg.variant === "string" ? msg.variant : undefined
          await this.streamCoordinator.startPrompt(sessionId, msg.text as string || "[image]", {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          }, variant)
          // Persist user message only after model validation and stream start succeed
          const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
          const attachments = Array.isArray(msg.attachments) ? msg.attachments as Array<{ data: string; mimeType: string }> : []
          const textBlocks: Block[] = msg.text ? [{ type: "text", text: msg.text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId }
          this.sessionStore.appendMessage(sessionId, userMsg)
        } catch (err) {
          log.error("send_prompt failed", err)
          this.postRequestError(err instanceof Error ? err.message : "Failed to send prompt")
        } finally { this.promptsInFlight.delete(sessionId) }
      }
    }],
    ["change_mode", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const mode = msg.mode as string
        if (mode === "auto" && !this.hasAutoModeConfirmed()) {
          const confirmed = await this.showAutoModeConfirmation(sessionId)
          if (!confirmed) return
        }
        this.ensureLocalTab(sessionId)
        this.tabManager.setMode(sessionId, mode)
        this.sessionStore.updateMode(sessionId, mode)
      }
    }],
    ["set_model", (msg: Record<string, unknown>, sessionId?: string) => {
      if (msg.model) this.modelManager.setModel(msg.model as string)
      if (sessionId) {
        this.ensureLocalTab(sessionId)
        this.tabManager.setModel(sessionId, msg.model as string)
        const s = this.sessionStore.get(sessionId)
        if (s) this.sessionStore.updateModel(sessionId, msg.model as string)
      }
    }],
    ["set_variant", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && msg.variant) {
        this.ensureLocalTab(sessionId)
        this.sessionStore.updateVariant(sessionId, msg.variant as string)
      }
    }],
    ["abort", async (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) await this.streamCoordinator.abort(sessionId, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["webview_log", (msg: Record<string, unknown>) => {
      const lvl = msg.level === "warn" ? "warn" : msg.level === "error" ? "error" : "info"
      log[lvl](`[Webview] ${msg.message}`)
    }],
    ["retry_stream", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        void this.streamCoordinator.retryFromHere(sessionId, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m),
        }).catch(err => log.error("Retry stream failed", err))
      }
    }],
    ["close_tab", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const tab = this.tabManager.getTab(sessionId)
        if (tab?.isStreaming) void this.streamCoordinator.abort(sessionId, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }).catch(err => log.warn("Abort on close failed", err))
        this.tabManager.closeTab(sessionId)
        this.sessionStore.deleteIfEmpty(sessionId)
      }
    }],
    ["switch_tab", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) { this.ensureLocalTab(sessionId); this.tabManager.switchTab(sessionId); this.sessionStore.setActive(sessionId) }
    }],
    ["accept_diff", async (msg: Record<string, unknown>, sessionId?: string) => { const diffId = msg.diffId as string || msg.blockId as string; if (diffId) await this.handleAcceptDiff(diffId, sessionId) }],
    ["reject_diff", (msg: Record<string, unknown>) => { const diffId = msg.diffId as string || msg.blockId as string; if (diffId) this.streamCoordinator.getDiffHandler().reject(diffId) }],
    ["accept_permission", async (msg: Record<string, unknown>) => { await this.messageRouter.handleAcceptPermission(msg.sessionId as string, msg.permissionId as string, msg.response as string) }],
    ["mention_search", async (msg: Record<string, unknown>) => { await this.messageRouter.handleMentionSearch(msg.query as string || "", { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }) }],
    ["list_sessions", async () => { await this.messageRouter.handleListSessions(this.sessionStore, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }) }],
    ["resume_session", async (msg: Record<string, unknown>) => { if (msg.sessionId) await this.handleResumeSession(msg.sessionId as string) }],
    ["new_session", async () => {
      const session = this.sessionStore.create()
      await this.openSessionInWebview(session.id)
    }],
    ["get_models", () => { this.pushModelListToWebview() }],
    ["update_cost", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const cost = Number(msg.cost ?? 0)
        if (Number.isFinite(cost)) { this.sessionStore.updateCost(sessionId, cost); this.postMessage({ type: "cost_update", sessionId, cost }) }
      }
    }],
    ["rename_session", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && msg.name) { const ok = this.sessionStore.rename(sessionId, msg.name as string); if (ok) this.postMessage({ type: "session_renamed", sessionId, name: msg.name }) }
    }],
    ["webview_ready", async () => {
      this.webviewReady = true
      this.pushAllStateToWebview()
      for (const q of this.earlyMessageQueue) this.postMessage(q)
      this.earlyMessageQueue = []
      this.replayLiveStreamsToWebview()
      if (this.pendingOpenSessionId) {
        const sessionId = this.pendingOpenSessionId
        this.pendingOpenSessionId = undefined
        await this.handleResumeSession(sessionId)
      }
    }],
    ["request_state_sync", () => {
      this.pushVisibleStateToWebview()
    }],
    ["open_settings", async () => { await this.openOpenCodeConfigOrSettings() }],
    ["connect_provider", async () => { await this.handleConnectProvider() }],
    ["open_mcp_settings", async () => { await this.mcpServerManager.openPrimaryConfigFile() }],
    ["open_mcp_config", () => { this.pushMcpServersToWebview() }],
    ["get_mcp_servers", () => { this.pushMcpServersToWebview() }],
    ["add_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const config = msg.config as { command: string; args?: string[]; env?: Record<string, string> }
      if (name && config) {
        await this.mcpServerManager.addServer(name, config)
        this.pushMcpServersToWebview()
      }
    }],
    ["update_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const config = msg.config as Partial<{ command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }>
      if (name && config) {
        await this.mcpServerManager.updateServer(name, config)
        this.pushMcpServersToWebview()
      }
    }],
    ["remove_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      if (name) {
        await this.mcpServerManager.removeServer(name)
        this.pushMcpServersToWebview()
      }
    }],
    ["toggle_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const disabled = msg.disabled as boolean
      if (name !== undefined && disabled !== undefined) {
        await this.mcpServerManager.toggleServer(name, disabled)
        this.pushMcpServersToWebview()
      }
    }],
    ["attach_files", async () => { await this.handleAttachFiles() }],
    ["attach_image", (msg: Record<string, unknown>, sessionId?: string) => { if (sessionId && msg.data && msg.mimeType) this.handleAttachImage(sessionId, msg.data as string, msg.mimeType as string) }],
    ["export_chat", () => { vscode.commands.executeCommand("opencode-harness.exportConversation") }],
    ["compact_session", async (_: Record<string, unknown>, sessionId?: string) => { await this.handleCompactSession(sessionId) }],
    ["execute_command", async (msg: Record<string, unknown>, sessionId?: string) => { await this.handleExecuteCommand(sessionId, msg.command as string, msg.arguments as string) }],
    ["list_commands", async () => { await this.handleListCommands() }],
    ["insert_at_cursor", async (msg: Record<string, unknown>) => { await this.handleInsertAtCursor(msg.code as string, msg.language as string) }],
    ["create_file_from_code", async (msg: Record<string, unknown>) => { await this.handleCreateFileFromCode(msg.code as string, msg.language as string) }],
    ["compact_banner_action", async (msg: Record<string, unknown>, sessionId?: string) => { await this.handleCompactBannerAction(sessionId, msg.action as string) }],
    ["edit_message", (msg: Record<string, unknown>, sessionId?: string) => { if (sessionId && msg.messageId) this.handleEditMessage(sessionId, msg.messageId as string, msg.text as string) }],
    ["delete_session", async (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId) {
        const session = this.sessionStore.get(targetId)
        if (session && session.messages.length > 0) {
          const confirmed = await vscode.window.showWarningMessage(
            `Delete session "${session.name}"? This cannot be undone.`,
            { modal: true },
            "Delete"
          )
          if (confirmed !== "Delete") return
        }
        this.sessionStore.delete(targetId)
        log.info(`Session deleted via webview: ${targetId}`)
      }
    }],
    ["archive_session", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId) {
        this.sessionStore.archive(targetId)
        log.info(`Session archived: ${targetId}`)
      }
    }],
    ["revert_message", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.messageId === "string") {
        try {
          await this.sessionManager.revertMessage(sessionId, msg.messageId)
          this.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: true,
          })
          vscode.window.showInformationMessage("Reverted changes from the selected message.")
        } catch (err) {
          log.error("Revert message failed", err)
          this.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: false,
            error: (err as Error).message,
          })
          vscode.window.showErrorMessage(`Failed to revert: ${(err as Error).message}`)
        }
      }
    }],
    ["list_server_sessions", async () => {
      if (!this.sessionManager.isRunning) {
        this.postMessage({ type: "server_session_list", sessions: [] })
        return
      }
      try {
        const all = await this.sessionManager.listSessions()
        const currentDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        this.postMessage({
          type: "server_session_list",
          sessions: all
            // Only hide subagent (child) sessions — show sessions from ALL workspaces
            // so users can access their CLI sessions regardless of which project is open.
            .filter((s) => !s.parentID)
            .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
            .map((s) => ({
              id: s.id,
              title: s.title || "Untitled",
              directory: s.directory,
              parentId: s.parentID,
              created: s.time?.created,
              updated: s.time?.updated,
              files: s.summary?.files ?? 0,
              additions: s.summary?.additions ?? 0,
              deletions: s.summary?.deletions ?? 0,
              // isCurrentWorkspace lets the UI badge sessions from other projects
              isCurrentWorkspace: !currentDir || !s.directory || s.directory === currentDir,
            })),
        })
      } catch (err) {
        log.error("Failed to list server sessions", err)
        this.postMessage({ type: "server_session_list", sessions: [] })
      }
    }],
    ["resume_server_session", async (msg: Record<string, unknown>) => {
      const serverId = msg.serverSessionId as string | undefined
      const title   = msg.title as string | undefined
      const dir     = msg.directory as string | undefined
      if (!serverId) return

      // Find or create a local session entry linked to this server session.
      // importOneServerSession is idempotent — returns the existing entry when
      // the session was already opened before.
      const localSession = this.sessionStore.importOneServerSession(serverId, title, dir)
      await this.handleResumeSession(localSession.id)

      // Offer to open the workspace folder if this session lives in a different project.
      const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (dir && wsDir && dir !== wsDir) {
        const choice = await vscode.window.showInformationMessage(
          `This session was created in "${path.basename(dir)}". Open that folder in VS Code?`,
          "Open Folder",
          "Continue Here"
        )
        if (choice === "Open Folder") {
          await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir))
        }
      }
    }],
    ["list_checkpoints", async (_: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      try {
        const checkpoints = await this.checkpointManager.listCheckpoints(sessionId)
        this.postMessage({
          type: "checkpoint_list",
          sessionId,
          checkpoints: checkpoints.map((cp: import("../checkpoint/CheckpointManager").Checkpoint) => ({
            id: cp.id,
            sessionId: cp.sessionId,
            messageId: cp.messageId,
            filesChanged: cp.filesChanged,
            gitRef: cp.gitRef,
          })),
        })
      } catch (err) {
        log.error("Failed to list checkpoints", err)
        this.postMessage({ type: "checkpoint_list", sessionId, checkpoints: [] })
      }
    }],
    ["restore_checkpoint", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.checkpointId !== "string") return
      try {
        const ok = await this.checkpointManager.restore(msg.checkpointId as string)
        this.postMessage({ type: "checkpoint_restored", sessionId, ok })
        // CheckpointManager.restore() already shows its own VS Code info/error message
      } catch (err) {
        log.error("Failed to restore checkpoint", err)
        this.postMessage({ type: "checkpoint_restored", sessionId, ok: false, error: (err as Error).message })
        vscode.window.showErrorMessage(`Failed to restore checkpoint: ${(err as Error).message}`)
      }
    }],
    ["request_more_messages", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.sessionStore.get(sessionId)
      if (!session) return
      const beforeIndex = typeof msg.beforeIndex === "number" ? msg.beforeIndex : session.messages.length
      const limit = typeof msg.limit === "number" ? msg.limit : 50
      const start = Math.max(0, beforeIndex - limit)
      const slice = session.messages.slice(start, beforeIndex)
      this.postMessage({
        type: "more_messages",
        sessionId,
        messages: slice,
        hasMore: start > 0,
        newBeforeIndex: start,
        totalCount: session.messages.length,
      })
    }],
    ["delete_server_session", async (msg: Record<string, unknown>) => {
      const serverId = msg.serverSessionId as string | undefined
      if (!serverId || !this.sessionManager.isRunning) return

      const confirm = await vscode.window.showWarningMessage(
        `Delete server session "${serverId.slice(0, 20)}..."? This removes it from the server permanently.`,
        { modal: true },
        "Delete from Server",
        "Cancel"
      )
      if (confirm !== "Delete from Server") return

      try {
        await this.sessionManager.deleteSession(serverId)
        log.info(`Server session deleted: ${serverId}`)

        // Also clean up any extension session that references this server session
        for (const local of this.sessionStore.list(true)) {
          if (local.cliSessionId === serverId) {
            this.sessionStore.delete(local.id)
            log.info(`Cleaned up extension session ${local.id} matching deleted server session ${serverId}`)
            break
          }
        }

        this.postMessage({ type: "server_session_deleted", serverSessionId: serverId })
      } catch (err) {
        log.error(`Failed to delete server session ${serverId}`, err)
        vscode.window.showErrorMessage(`Failed to delete server session: ${(err as Error).message}`)
      }
    }],
    ["preview_theme", async (_msg: Record<string, unknown>, _sessionId?: string) => {
      try {
        await this.themeManager.previewTheme()
      } catch (err) {
        log.error("Theme preview failed", err)
        vscode.window.showErrorMessage(`Theme preview failed: ${(err as Error).message}`)
      }
    }],
    ["get_theme_config", () => {
      this.themeController.pushThemeConfigToWebview()
    }],
    ["update_theme_config", async (msg: Record<string, unknown>) => {
      await this.themeController.handleUpdateThemeConfig(msg.theme)
    }],
    ["list_cli_themes", () => {
      const themes = this.themeManager.discoverCliThemes()
      this.postMessage({ type: "cli_themes_list", themes })
    }],
  ])

  private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
    if (!msg || typeof msg.type !== "string") return

    const sessionId = msg.sessionId as string | undefined
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100)) return

    if (!ChatProvider.VALID_WEBVIEW_TYPES.has(msg.type)) {
      log.warn(`Unknown webview message type: ${msg.type}`)
      return
    }

    // H1: Validate specific message fields
    if (msg.type === "send_prompt") {
      const text = msg.text as string | undefined
      if (!text || typeof text !== "string" || text.length > 50000) {
        log.warn("Rejected oversized or invalid prompt")
        return
      }
    }
    if (msg.type === "mention_search") {
      const query = msg.query as string | undefined
      if (query && (typeof query !== "string" || query.length > 500)) {
        log.warn("Rejected oversized mention search query")
        return
      }
    }
    if (msg.type === "change_mode") {
      const mode = msg.mode as string | undefined
      if (mode && !["normal", "plan", "build", "auto"].includes(mode)) {
        log.warn(`Invalid mode: ${mode}`)
        return
      }
    }
    if (msg.type === "update_theme_config" && !this.themeController.isValidThemeConfigPayload(msg.theme)) {
      log.warn("Rejected invalid theme config payload")
      return
    }

    // Use handler map for cleaner dispatch
    const handler = this.webviewHandlers.get(msg.type)
    if (handler) {
      await handler(msg, sessionId)
    }
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
      this.pendingOpenSessionId = sessionId
      return
    }
    if (!this.webviewReady) {
      this.pendingOpenSessionId = sessionId
      return
    }
    await this.handleResumeSession(sessionId)
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
    const session = this.sessionStore.setActive(sessionId)
    if (!session) {
      vscode.window.showWarningMessage("That saved session could not be found.")
      return
    }
    // M5: Guard against duplicate tab creation on re-resume
    if (!this.tabManager.getTab(session.id)) {
      this.ensureLocalTab(session.id, session.name, session.model, session.mode)
    }
    this.tabManager.switchTab(session.id)

    // Re-attach to the server session so the next prompt uses the existing
    // server-side context instead of creating a brand-new server session.
    if (this.sessionManager.isRunning) {
      try {
        const cliSessionId = await this.sessionManager.ensureSession(
          session.cliSessionId,
          session.name || undefined
        )
        this.tabManager.setCliSessionId(sessionId, cliSessionId)
        this.sessionStore.updateCliSessionId(sessionId, cliSessionId)
      } catch (err) {
        log.warn(`Could not re-attach server session for resume (${sessionId})`, err)
      }
    }

    // Lazy backfill: a session imported from the server starts with no
    // messages (`needsBackfill`). On resume we fetch the full transcript so
    // the user sees the conversation instead of an empty pane.
    const needsBackfill =
      session.needsBackfill === true ||
      (session.messages.length === 0 && !!session.cliSessionId)
    if (needsBackfill && this.sessionManager.isRunning && session.cliSessionId) {
      try {
        const rows = await this.sessionManager.getSessionMessages(session.cliSessionId)
        const messages = sdkMessagesToChatMessages(rows)
        if (messages.length > 0) {
          this.sessionStore.applyBackfilledMessages(session.id, messages)
        } else {
          // No messages on server either — clear the flag so we don't refetch.
          this.sessionStore.applyBackfilledMessages(session.id, [])
        }
        // Server may not have titled this session yet (or we imported before
        // it was titled). Derive one from the first user prompt so the tab
        // shows something more useful than "Untitled session".
        this.sessionStore.autoTitleFromMessages(session.id)
      } catch (err) {
        log.warn(`Backfill on resume failed for ${session.id}`, err)
      }
    }

    // Re-read in case backfill mutated the messages array or the title.
    const fresh = this.sessionStore.get(session.id) || session

    // Only send the most-recent INITIAL_RESUME_COUNT messages to keep IPC payload
    // small and rendering fast.  The webview requests older pages via
    // request_more_messages when the user scrolls to the top.
    const INITIAL_RESUME_COUNT = 50
    const totalMessages = fresh.messages.length
    const initialMessages = fresh.messages.slice(-INITIAL_RESUME_COUNT)

    this.postMessage({
      type: "resume_session_data",
      session: {
        id: fresh.id,
        name: SessionStore.displayName(fresh),
        model: fresh.model,
        mode: fresh.mode,
        messages: initialMessages,
        isStreaming: false,
      },
      totalMessages,
      initialBeforeIndex: totalMessages - initialMessages.length,
    })
  }

  private async handleAttachFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Attach",
      title: "Attach files to OpenCode prompt",
    })

    if (!files?.length) return

    const checks = await Promise.all(files.map(async (uri) => ({ uri, check: await checkFileSecurity(uri) })))
    const risky = checks.filter(({ check }) => check.isSensitive || check.hasInjectionRisk)
    let filesToAttach = files

    if (risky.length > 0) {
      const fileNames = risky.map(({ uri }) => vscode.workspace.asRelativePath(uri)).join(", ")
      const proceed = await vscode.window.showWarningMessage(
        `Warning: ${risky.length} risky file(s) detected: ${fileNames}. They may contain secrets or prompt-injection text. Attach anyway?`,
        { modal: true },
        "Attach All",
        "Review Files",
        "Cancel"
      )

      if (!proceed || proceed === "Cancel") return
      if (proceed === "Review Files") {
        const picked = await vscode.window.showQuickPick(
          checks.map(({ uri, check }) => ({
            label: vscode.workspace.asRelativePath(uri),
            description: check.isSensitive ? "Sensitive filename" : check.hasInjectionRisk ? "Prompt-injection text" : "No warning",
            uri,
          })),
          { canPickMany: true, placeHolder: "Select files to attach" }
        )
        if (!picked?.length) return
        filesToAttach = picked.map((item) => item.uri)
      }
    }

    const mentions = filesToAttach
      .map((uri) => `@file:${vscode.workspace.asRelativePath(uri)}`)
      .join(" ")

    this.postMessage({
      type: "insert_text",
      text: `${mentions} `,
    })
  }

  private handleAttachImage(sessionId: string, data: string, mimeType: string): void {
    const sizeBytes = Buffer.from(data.includes(",") ? data.split(",").pop()! : data, "base64").length
    const sizeMB = sizeBytes / 1024 / 1024
    if (sizeBytes > 10 * 1024 * 1024) {
      this.postRequestError(`Image too large (${sizeMB.toFixed(1)}MB). Maximum 10MB.`, sessionId)
      return
    }

    const imageBlock: Block = { type: "image", data, mimeType }
    const imageMsg: ChatMessage = {
      role: "user",
      blocks: [imageBlock],
      timestamp: Date.now(),
      sessionId,
    }
    this.sessionStore.appendMessage(sessionId, imageMsg)
    this.postMessage({
      type: "message",
      sessionId,
      message: imageMsg,
    })
  }

  private async handleCompactSession(sessionId?: string): Promise<void> {
    if (!sessionId) return
    await this.autoCompactor.compactNow(sessionId, {
      postMessage: (m) => this.postMessage(m),
      postRequestError: (m) => this.postRequestError(m),
    })
  }

  private parseCommandResult(result: unknown, sessionId: string): Block[] {
    const blocks: Block[] = []
    const parts = (result as { parts?: unknown[] }).parts || []
    for (const part of parts) {
      const p = part as { type?: string; text?: string; tool?: string; state?: { output?: string; error?: string } }
      if (p.type === "text" && p.text) {
        blocks.push({ type: "text", text: p.text })
      } else if (p.type === "tool") {
        blocks.push({
          type: "tool_call",
          toolName: p.tool || "unknown",
          result: p.state?.output ?? p.state?.error ?? "",
          state: p.state?.error ? "error" : "completed",
        })
      }
    }
    return blocks
  }

  private async executeRemoteCommand(
    tab: NonNullable<ReturnType<TabManager["getTab"]>>,
    sessionId: string,
    commandName: string,
    args?: string
  ): Promise<void> {
    try {
      const modelRef = tab.model ? parseModelRef(tab.model) : undefined
      const result = await this.sessionManager.sendCommand(tab.cliSessionId!, commandName, args)

      const blocks = this.parseCommandResult(result, sessionId)

      if (blocks.length > 0) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          blocks,
          timestamp: Date.now(),
          sessionId,
        }
        this.sessionStore.appendMessage(sessionId, assistantMsg)
      }

      this.postMessage({
        type: "stream_end",
        sessionId,
        messageId: `cmd-${crypto.randomUUID()}`,
        blocks,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command execution failed"
      log.error("Command execution failed", err)
      this.postRequestError(message, sessionId)
    }
  }

  private async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
    if (!sessionId || !command) return

    const rawCommand = command.trim()
    const commandName = rawCommand.replace(/^\//, "").toLowerCase()

    if (await this.handleLocalSlashCommand(sessionId, commandName)) {
      return
    }

    const customPrompt = this.promptManager.getPrompt(commandName)
    if (customPrompt) {
      const resolved = await this.resolveCustomPromptVariables(commandName)
      if (resolved) {
        this.sendPromptToWebview(resolved, true)
      }
      return
    }

    const tab = this.tabManager.getTab(sessionId)
    if (!tab?.cliSessionId || !this.sessionManager.isRunning) {
      this.postRequestError("Cannot execute command: server not running or session not linked", sessionId)
      return
    }

    await this.executeRemoteCommand(tab, sessionId, commandName, args)
  }

  private async handleLocalSlashCommand(sessionId: string, commandName: string): Promise<boolean> {
    switch (commandName) {
      case "clear":
        await this.handleClearCommand(sessionId)
        return true
      case "cost":
        await this.handleCostCommand(sessionId)
        return true
      case "continue":
        await this.handleContinueCommand(sessionId)
        return true
      case "help":
        this.handleHelpCommand(sessionId)
        return true
      case "diagnose:generation":
        this.chatCommands.diagnoseGeneration()
        return true
      default:
        return false
    }
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

  private async resolveCustomPromptVariables(name: string): Promise<string | null> {
    const editor = vscode.window.activeTextEditor
    const variables: Record<string, string> = {
      selection: editor ? editor.document.getText(editor.selection) : "",
      file: editor ? vscode.workspace.asRelativePath(editor.document.uri) : "",
      language: editor ? editor.document.languageId : "",
    }

    try {
      variables.clipboard = await vscode.env.clipboard.readText()
    } catch {
      variables.clipboard = ""
    }

    return this.promptManager.resolvePrompt(name, variables)
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
      const data = event.data as { status?: { type?: string } } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status })

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
      const data = event.data as { status?: { type?: string } | undefined } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status })

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
        this.postMessage({
          type: "step_tokens",
          sessionId: tabId,
          tokens: { input: t.input ?? 0, output: t.output ?? 0, reasoning: t.reasoning ?? 0, cacheRead: t.cacheRead ?? 0, cacheWrite: t.cacheWrite ?? 0 },
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
  ])

  private handleServerEvent(event: { type: string; sessionId?: string; data?: unknown }): void {
    if (!this._view) {
      log.debug(`Ignoring server event ${event.type} — no webview active`)
      return
    }

    // text_chunk fires per-delta — too noisy to log every one. State events still log.
    const isHighFrequency = event.type === "text_chunk"
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
    try {
      let checkpointCreated = false
      if (sessionId) {
        const cp = await this.checkpointManager.snapshotBeforeAction(sessionId, "apply-diff", blockId)
        checkpointCreated = cp !== null
      }
      const result = await this.streamCoordinator.getDiffHandler().accept(blockId)
      this.postMessage({
        type: "diff_result",
        blockId,
        ok: result.ok,
        message: result.message,
        checkpointCreated,
      })
      if (!result.ok) {
        vscode.window.showErrorMessage(result.message || "Could not apply diff.")
      }
    } catch (err) {
      log.error("Failed to accept diff", err)
      this.postMessage({
        type: "diff_result",
        blockId,
        ok: false,
        message: "An unexpected error occurred while applying the diff.",
      })
      vscode.window.showErrorMessage("Failed to apply diff. Check the OpenCode output channel for details.")
    }
  }

  private syncActiveSession(): void {
    const session = this.sessionStore.getActive()
    if (session && this._view) {
      this.postMessage({ type: "active_session_changed", sessionId: session.id })
    }
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
    for (const id of restoredIds) {
      if (seen.has(id)) continue
      const s = this.sessionStore.get(id)
      // Skip tabs whose underlying session is gone, archived, or in a different
      // workspace — restoring those would render a blank pane the user can't act on.
      // Empty sessions (messages.length === 0) ARE included now: they may be a
      // freshly-created tab the user is about to use, and excluding them caused
      // the welcome screen to cover an active streaming session.
      if (!s || s.archived || !this.isSessionInCurrentWorkspace(s)) continue
      restorable.push(s)
      seen.add(id)
    }

    // Always include any tab currently open in TabManager (extension-side source
    // of truth) even if it's not in restoredIds — this can happen if a tab was
    // created after the last persist (e.g. during this session's bootstrap).
    for (const tab of this.tabManager.getAllTabs()) {
      if (seen.has(tab.id)) continue
      const s = this.sessionStore.get(tab.id) || (tab.cliSessionId ? this.sessionStore.get(tab.cliSessionId) : undefined)
      if (s && !s.archived && this.isSessionInCurrentWorkspace(s)) {
        restorable.push(s)
        seen.add(s.id)
      }
    }

    const storeActive = this.sessionStore.getActive()
    if (storeActive && !seen.has(storeActive.id) && !storeActive.archived && this.isSessionInCurrentWorkspace(storeActive)) {
      restorable.push(storeActive)
      seen.add(storeActive.id)
    }

    // Decide which tab should be focused: prefer the previously-active tab
    // if it survived the filter, otherwise the active session in the store
    // (e.g. one created since last shutdown), otherwise the first restored.
    let activeId: string | null = null
    if (restoredActiveId && seen.has(restoredActiveId)) {
      activeId = restoredActiveId
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
        return { isStreaming: tab?.isStreaming ?? false }
      })(),
      id: s.id,
      name: SessionStore.displayName(s),
      model: s.model,
      mode: s.mode || "build",
      messages: s.messages.slice(-MAX_MESSAGES_PER_TAB),
      cost: s.cost || 0,
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
    return !currentWorkspace || !session.workspacePath || session.workspacePath === currentWorkspace
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
    if (!this._view || !this.webviewReady) return
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
    const passthrough = ["init_state", "theme_vars", "theme_config", "rate_limit_state", "model_update", "model_list", "webview_ready"]
    if (!this.webviewReady && !passthrough.includes(msg.type as string)) {
      this.earlyMessageQueue.push(msg)
      return
    }

    // R2: Batch stream_chunk messages — accumulate text per session and flush every 50ms
    if (msg.type === "stream_chunk" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      const messageId = typeof msg.messageId === "string" ? msg.messageId : undefined
      this.chunkBatcher.add(msg.sessionId, msg.text, messageId)
      return
    }

    // For stream_end, flush any remaining chunks first so the webview has all text
    if (msg.type === "stream_end") {
      this.chunkBatcher.flush()
    }

    this._view.webview.postMessage(msg)

    // F15: Notify when turn completes and webview is not visible
    if (msg.type === "stream_end") {
      this.notifyTurnComplete()
    }
  }

  private postRequestError(message: string, sessionId?: string): void {
    this.statePush.postRequestError(this.toUserErrorMessage(message), sessionId)
  }

  private toUserErrorMessage(message: string): string {
    const commandFailedJson = message.match(/Command failed:\s*(\{.*\})/s)
    if (commandFailedJson?.[1]) {
      try {
        const parsed = JSON.parse(commandFailedJson[1]) as { data?: { message?: string }; message?: string }
        const nested = parsed.data?.message || parsed.message
        if (nested) return this.toUserErrorMessage(nested)
      } catch {
        // Fall through to pattern matching below.
      }
    }
    const commandError = message.match(/Command not found:\s*"\/?([^"]+)"/i)
    if (commandError?.[1]) {
      return `Slash command "/${commandError[1]}" is not available in this session. Type /help for local commands or /commands for server commands.`
    }
    if (/server not running/i.test(message)) return "OpenCode is not connected. Try again after the server starts."
    if (/not installed|not found/i.test(message)) return message
    if (/timeout|did not start/i.test(message)) return "OpenCode took too long to respond. Check the output logs and try again."
    return message || "The request failed. Check the OpenCode output logs for details."
  }

  private errorValueToMessage(value: unknown): string {
    if (value instanceof Error) return value.message
    if (typeof value === "string") return value
    if (value && typeof value === "object") {
      const data = value as { message?: unknown; name?: unknown; data?: { message?: unknown } }
      if (typeof data.data?.message === "string") return data.data.message
      if (typeof data.message === "string") return data.message
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value || "Server error")
  }

  private mapToolType(tool: string): string {
    if (!tool) return "read"
    const t = tool.toLowerCase()
    if (t.includes("edit") || t.includes("write") || t.includes("create") || t.includes("apply")) return "write"
    if (t.includes("bash") || t.includes("exec") || t.includes("run") || t.includes("command")) return "exec"
    return "read"
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
    await this.chatCommands.clear(sessionId,
      (m) => this.postMessage(m),
      (m) => this.postRequestError(m)
    )
  }

  private async handleCostCommand(sessionId: string): Promise<void> {
    await this.chatCommands.cost(sessionId, (m) => this.postMessage(m))
  }

  private async handleContinueCommand(sessionId: string): Promise<void> {
    this.chatCommands.continue(sessionId, (m) => this.postRequestError(m))
  }

  async abortCurrentSession(): Promise<void> {
    const activeTab = this.tabManager.getActiveTab()
    const activeId = activeTab?.id
    if (activeId) {
      await this.streamCoordinator.abort(activeId, {
        postMessage: (m) => this.postMessage(m),
        postRequestError: (m) => this.postRequestError(m),
      })
    }
  }

  private handleHelpCommand(sessionId: string): void {
    this.chatCommands.help(sessionId, (m) => this.postMessage(m))
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
    this.diffApplier?.dispose()
    this.webviewContent?.dispose()
  }
}
