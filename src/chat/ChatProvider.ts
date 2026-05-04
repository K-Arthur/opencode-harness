import * as vscode from "vscode"
import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { ContextEngine } from "../context/ContextEngine"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { ThemeManager } from "../theme/ThemeManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { ModelManager } from "../model/ModelManager"
import { DiffApplier } from "../diff/DiffApplier"
import { WebviewContent } from "./WebviewContent"
import { TabManager } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import { MessageRouter } from "./handlers/MessageRouter"
import { log } from "../utils/outputChannel"

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  blocks: Block[]
  timestamp: number
  sessionId: string
  id?: string
}

export interface Block {
  type: string
  [key: string]: unknown
}

export class ChatProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view?: vscode.WebviewView
  private diffApplier = new DiffApplier()
  private disposables: vscode.Disposable[] = []
  private webviewReady = false

  private webviewContent: WebviewContent
  private tabManager: TabManager
  private streamCoordinator: StreamCoordinator
  private messageRouter: MessageRouter
  private pendingPrompt?: { text: string; autoSend: boolean }

  /** H3: Queue of messages buffered before webview was ready */
  private earlyMessageQueue: Record<string, unknown>[] = []

  /** H6: Guard against duplicate prompt submissions */
  private promptInFlight = false

  /** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
  private chunkBuffer: Map<string, string> = new Map()
  private chunkFlushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly CHUNK_FLUSH_MS = 50

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor,
    private readonly themeManager: ThemeManager,
    private readonly rateLimitMonitor: RateLimitMonitor,
    private readonly modelManager: ModelManager,
    private readonly sessionStore: SessionStore
  ) {
    this.webviewContent = new WebviewContent(context.extensionUri)
    this.tabManager = new TabManager()
    this.streamCoordinator = new StreamCoordinator(
      sessionManager, sessionStore, contextEngine, contextMonitor, modelManager, this.tabManager, this.diffApplier
    )
    this.messageRouter = new MessageRouter(sessionManager, modelManager)
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // H16: Dispose old disposables from previous webview resolve to prevent memory leak
    for (const d of this.disposables) d.dispose()
    this.disposables = []

    // Clear any pending chunk buffer and timer from previous webview instance
    this.flushChunkBuffer()
    this.chunkBuffer.clear()

    this._view = webviewView
    // H15: Reset ready state on re-resolve to handle webview recreation
    this.webviewReady = false
    this.promptInFlight = false

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "chat", "webview"),
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "chat", "webview"),
      ],
    }

    webviewView.webview.html = this.webviewContent.build(webviewView.webview, this.themeManager)

    // State will be pushed when webview sends 'webview_ready' message

    // Subscriptions
    this.disposables.push(
      this.modelManager.onModelChanged((model) => this.pushModelToWebview(model)),
      this.modelManager.onModelsRefreshed(() => this.pushModelListToWebview()),
      this.themeManager.onThemeChanged(() => this.pushThemeToWebview()),
      this.rateLimitMonitor.onWarning((msg) => vscode.window.showWarningMessage(msg)),
      this.sessionStore.onActiveSessionChanged(() => this.syncActiveSession()),
      this.sessionManager.onEvent((event) => this.handleServerEvent(event)),
      this.tabManager.onStreamingStateChanged(({ tabId, isStreaming }) => {
        this.postMessage({ type: "streaming_state", sessionId: tabId, isStreaming: isStreaming })
      }),
      this.contextMonitor.onContextChanged?.((usage) => {
        this.postMessage({
          type: "context_usage",
          percent: usage.percent,
          tokens: usage.tokens,
          maxTokens: usage.maxTokens,
        })
      })
    )

    // Webview message handler
    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        await this.handleWebviewMessage(msg)
      } catch (err) {
        log.error("Error handling webview message", err)
      }
    })

    webviewView.onDidDispose(() => {
      this._view = undefined
      this.webviewReady = false
      log.info("Chat webview disposed")
    })

    log.info("Chat webview resolved")
  }

  private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
    // H1: Basic input validation — reject malformed messages
    if (!msg || typeof msg.type !== "string") return

    const sessionId = msg.sessionId as string | undefined
    // H1: Validate sessionId format when provided (UUID or short hex)
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100)) return

    // H1: Validate message type is a known type
    const validTypes = [
      "create_tab", "send_prompt", "change_mode", "set_model", "abort",
      "close_tab", "switch_tab", "accept_diff", "reject_diff",
      "accept_permission", "mention_search", "list_sessions", "resume_session",
      "new_session", "get_models", "update_cost", "webview_ready",
      "open_settings", "open_mcp_settings", "attach_files",
    ]
    if (!validTypes.includes(msg.type)) {
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
      if (mode && !["normal", "plan", "build"].includes(mode)) {
        log.warn(`Invalid mode: ${mode}`)
        return
      }
    }

    switch (msg.type) {
      case "create_tab":
        if (sessionId) {
          this.ensureLocalTab(
            sessionId,
            typeof msg.name === "string" ? msg.name : undefined,
            typeof msg.model === "string" ? msg.model : undefined,
            typeof msg.mode === "string" ? msg.mode : undefined
          )
        }
        break

      case "send_prompt":
        // H6: Prevent duplicate prompt submissions
        if (this.promptInFlight) return
        if (sessionId && typeof msg.text === "string" && msg.text.trim()) {
          this.promptInFlight = true
          try {
            this.ensureLocalTab(
              sessionId,
              typeof msg.name === "string" ? msg.name : undefined,
              typeof msg.model === "string" ? msg.model : undefined,
              typeof msg.mode === "string" ? msg.mode : undefined
            )
            await this.streamCoordinator.startPrompt(sessionId, msg.text, {
              postMessage: (m) => this.postMessage(m),
              postRequestError: (m) => this.postRequestError(m),
            })
          } finally {
            this.promptInFlight = false
          }
        }
        break

      case "change_mode":
        if (sessionId) {
          this.ensureLocalTab(sessionId)
          this.tabManager.setMode(sessionId, msg.mode as string)
          this.sessionStore.updateMode(sessionId, msg.mode as string)
          log.info(`Mode changed to: ${msg.mode} (tab: ${sessionId})`)
        }
        break

      case "set_model":
        if (sessionId) {
          this.ensureLocalTab(sessionId)
          this.tabManager.setModel(sessionId, msg.model as string)
          const storeSession = this.sessionStore.get(sessionId)
          if (storeSession) this.sessionStore.updateModel(sessionId, msg.model as string)
        }
        break

      case "abort":
        if (sessionId) {
          await this.streamCoordinator.abort(sessionId, {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        }
        break

      case "close_tab":
        if (sessionId) {
          // Abort any active streaming for this tab first
          const tab = this.tabManager.getTab(sessionId)
          if (tab?.isStreaming) {
            void this.streamCoordinator.abort(sessionId, {
              postMessage: (m) => this.postMessage(m),
              postRequestError: (m) => this.postRequestError(m),
            })
          }
          // Close the tab (preserves SessionStore history)
          this.tabManager.closeTab(sessionId)
          log.info(`Tab closed and worker stopped: ${sessionId}`)
        }
        break

      case "switch_tab":
        if (sessionId) {
          this.ensureLocalTab(sessionId)
          this.tabManager.switchTab(sessionId)
          this.sessionStore.setActive(sessionId)
        }
        break

      case "accept_diff": {
        const blockId = msg.blockId
        if (typeof blockId !== "string" || !blockId) {
          log.warn("accept_diff rejected: missing or invalid blockId")
          return
        }
        await this.handleAcceptDiff(blockId)
        break
      }

      case "reject_diff": {
        const blockId = msg.blockId
        if (typeof blockId !== "string" || !blockId) {
          log.warn("reject_diff rejected: missing or invalid blockId")
          return
        }
        this.streamCoordinator.getDiffHandler().reject(blockId)
        break
      }

      case "accept_permission":
        await this.messageRouter.handleAcceptPermission(
          msg.sessionId as string,
          msg.permissionId as string,
          msg.response as string
        )
        break

      case "mention_search": {
        const query = typeof msg.query === "string" ? msg.query : ""
        await this.messageRouter.handleMentionSearch(query, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m),
        })
        break
      }

      case "list_sessions":
        await this.messageRouter.handleListSessions(this.sessionStore, {
          postMessage: (m) => this.postMessage(m),
          postRequestError: (m) => this.postRequestError(m),
        })
        break

      case "resume_session":
        this.handleResumeSession(msg.sessionId as string)
        break

      case "new_session":
        vscode.commands.executeCommand("opencode-harness.newSession")
        break

      case "get_models":
        this.pushModelListToWebview()
        break

      case "update_cost":
        if (sessionId) {
          const cost = Number(msg.cost || 0)
          this.sessionStore.updateCost(sessionId, cost)
          this.postMessage({ type: "cost_update", sessionId, cost })
        }
        break

      case "webview_ready":
        this.webviewReady = true
        this.pushAllStateToWebview()
        // H3: Flush any messages that were queued before webview was ready
        for (const queued of this.earlyMessageQueue) {
          this.postMessage(queued)
        }
        this.earlyMessageQueue = []
        break

      case "open_settings":
        vscode.commands.executeCommand("workbench.action.openSettings", "opencode")
        break

      case "open_mcp_settings":
        // MCP servers are typically configured in VS Code settings or claude_desktop_config.json
        // Open the generic settings page; user can search for "mcp" from there
        vscode.commands.executeCommand("workbench.action.openSettings", "opencode.mcp")
        break

      case "attach_files":
        await this.handleAttachFiles()
        break
    }
  }

  sendPromptToWebview(text: string, autoSend = true): void {
    if (!this._view) {
      this.pendingPrompt = { text, autoSend }
      return
    }
    this.postMessage({ type: "prefill_prompt", text, autoSend })
  }

  private ensureLocalTab(sessionId: string, name?: string, model?: string, mode?: string): void {
    const storeSession = this.sessionStore.ensure(
      sessionId,
      name || `Session ${sessionId.slice(-5)}`,
      model,
      mode || "normal"
    )
    if (!this.tabManager.getTab(sessionId)) {
      this.tabManager.createTab(sessionId, storeSession.cliSessionId, storeSession.model || model, storeSession.mode || mode)
    }
  }

  private handleResumeSession(sessionId: string): void {
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
    this.postMessage({
      type: "resume_session_data",
      session: {
        id: session.id,
        name: session.name,
        model: session.model,
        mode: session.mode,
        messages: session.messages,
        isStreaming: false,
      },
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

    const mentions = files
      .map((uri) => `@file:${vscode.workspace.asRelativePath(uri)}`)
      .join(" ")

    this.postMessage({
      type: "insert_text",
      text: `${mentions} `,
    })
  }

  private handleServerEvent(event: { type: string; sessionId?: string; data?: unknown }): void {
    if (!this._view) return

    // Find tab by CLI session ID
    const tab = Array.from(this.tabManager.getAllTabs()).find(
      (t) => t.cliSessionId === event.sessionId
    )
    const tabId = tab?.id || event.sessionId || ""

    switch (event.type) {
      case "tool_start": {
        const data = event.data as { tool?: string; input?: unknown; status?: string } | undefined
        this.postMessage({
          type: "message",
          sessionId: tabId,
          message: {
            role: "system",
            blocks: [{
              type: "tool_call",
              toolType: this.mapToolType(data?.tool || ""),
              toolName: data?.tool || "unknown",
              args: JSON.stringify(data?.input || {}),
              state: data?.status || "running",
            }],
            timestamp: Date.now(),
            sessionId: tabId,
          },
        })
        break
      }

      case "tool_end": {
        const data = event.data as { tool?: string; result?: unknown } | undefined
        this.postMessage({
          type: "tool_result",
          sessionId: tabId,
          toolName: data?.tool || "unknown",
          result: typeof data?.result === "string" ? data.result : JSON.stringify(data?.result ?? ""),
        })
        break
      }

      case "skill_load": {
        const data = event.data as { skill?: string; name?: string; id?: string } | undefined
        // Extract skill name from various possible fields
        const skillName = data?.skill || data?.name || data?.id || "skill"
        this.postMessage({
          type: "message",
          sessionId: tabId,
          message: {
            role: "system",
            blocks: [{ type: "skill_badge", skillName }],
            timestamp: Date.now(),
            sessionId: tabId,
          },
        })
        break
      }

      case "text_chunk": {
        const data = event.data as { text?: string } | undefined
        if (data?.text && tab) {
          // H4: Wrap appendChunk in try/catch to prevent event handler chain breakage
          try {
            this.streamCoordinator.appendChunk(tab.id, data.text, {
              postMessage: (m) => this.postMessage(m),
              postRequestError: (m) => this.postRequestError(m),
            })
          } catch (err) {
            log.error("Error appending text chunk", err)
          }
        }
        break
      }

      case "message_complete": {
        if (tab) {
          void this.streamCoordinator.finalizeStream(tab.id, {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        }
        break
      }

      case "session_status":
      case "server_status": {
        const data = event.data as { status?: { type?: string } } | undefined
        const rawStatus = data?.status?.type || "unknown"
        const status = rawStatus === "busy" ? "thinking" : rawStatus
        this.postMessage({
          type: "server_status",
          sessionId: tabId,
          status,
        })
        if (status === "idle" && tab) {
          void this.streamCoordinator.finalizeStream(tab.id, {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        }
        break
      }

      case "permission_request": {
        const data = event.data as { id?: string; title?: string; type?: string } | undefined
        this.postMessage({
          type: "permission_request",
          sessionId: tabId,
          permissionId: data?.id,
          title: data?.title || `Allow ${data?.type || "action"}?`,
        })
        break
      }

      case "permission_replied": {
        log.info(`Permission response accepted for session ${tabId}`)
        break
      }

      case "file_edited": {
        // Only show file_edited banners for tabs that are actively streaming
        // to prevent spurious "Edited file" banners for unrelated events
        if (!tab?.isStreaming) break
        const data = event.data as { file?: string } | undefined
        // Only show if we have an actual file path
        if (!data?.file) break
        this.postMessage({
          type: "file_edited",
          sessionId: tabId,
          file: data.file,
        })
        break
      }

      case "thinking": {
        const data = event.data as { text?: string } | undefined
        this.postMessage({
          type: "message",
          sessionId: tabId,
          message: {
            role: "system",
            blocks: [{ type: "thinking", text: data?.text || "" }],
            timestamp: Date.now(),
            sessionId: tabId,
          },
        })
        break
      }

      case "server_error": {
        const data = event.data as { error?: Error | string } | undefined
        const errorMsg = data?.error instanceof Error ? data.error.message : String(data?.error || "Server error")
        log.error("Server error during streaming", errorMsg)
        if (tab) {
          this.postRequestError(errorMsg)
          this.tabManager.setStreaming(tab.id, false)
        }
        break
      }

      case "server_disconnected": {
        // Server went away — reset streaming state for all tabs
        // so the UI doesn't remain stuck in "streaming" state
        log.info("Server disconnected — resetting all active streaming states")
        const allTabs = this.tabManager.getAllTabs()
        for (const t of allTabs) {
          if (t.isStreaming) {
            this.tabManager.setStreaming(t.id, false)
            this.postMessage({
              type: "streaming_state",
              sessionId: t.id,
              isStreaming: false,
            })
          }
        }
        // Also push a global error to the active tab
        this.postRequestError("OpenCode server connection lost. Attempting to reconnect...")
        break
      }

      case "server_connected": {
        // Server reconnected — push model list to refresh
        this.pushModelListToWebview()
        break
      }
    }
  }

  private async handleAcceptDiff(blockId: string): Promise<void> {
    try {
      const result = await this.streamCoordinator.getDiffHandler().accept(blockId)
      this.postMessage({
        type: "diff_result",
        blockId,
        ok: result.ok,
        message: result.message,
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
    // The webview manages its own tab content and switching.
    // Don't clear/re-render all messages — that causes a disruptive flash.
    // Only notify the webview of the active session change so it can
    // switch tabs if needed.
    const session = this.sessionStore.getActive()
    if (session && this._view) {
      this.postMessage({ type: "streaming_state", sessionId: session.id, isStreaming: false })
    }
  }

  private pushThemeToWebview(): void {
    const vars = this.themeManager.getThemeVariables()
    this.postMessage({ type: "theme_vars", vars: vars.customVars })
  }

  private pushModelToWebview(model?: string): void {
    this.postMessage({ type: "model_update", model: model || this.modelManager.model })
  }

  private pushModelListToWebview(): void {
    this.messageRouter.getModelList({
      postMessage: (m) => this.postMessage(m),
      postRequestError: (m) => this.postRequestError(m),
    })
  }

  private pushInitStateToWebview(): void {
    const sessions = this.sessionStore.list().map((s) => ({
      id: s.id,
      name: s.name,
      model: s.model,
      mode: s.mode,
      messages: s.messages,
      cost: s.cost || 0,
    }))
    const active = this.sessionStore.getActive()
    this.postMessage({
      type: "init_state",
      sessions,
      activeSessionId: active?.id || null,
      globalModel: this.modelManager.model || "",
    })
  }

  private pushAllStateToWebview(): void {
    this.pushThemeToWebview()
    this.pushModelToWebview()
    this.pushModelListToWebview()
    this.pushInitStateToWebview()
    if (this.pendingPrompt) {
      this.postMessage({ type: "prefill_prompt", ...this.pendingPrompt })
      this.pendingPrompt = undefined
    }
  }

  private postMessage(msg: Record<string, unknown>): void {
    // H3: Buffer messages if webview isn't ready yet.
    // Allow init_state, theme_vars, model_update, and model_list through
    // so the webview is fully initialized on first load.
    const passthrough = ["init_state", "theme_vars", "model_update", "model_list", "webview_ready"]
    if (!this.webviewReady && !passthrough.includes(msg.type as string)) {
      this.earlyMessageQueue.push(msg)
      return
    }

    // R2: Batch stream_chunk messages — accumulate text per session and flush every 50ms
    if (msg.type === "stream_chunk" && typeof msg.sessionId === "string" && typeof msg.text === "string") {
      const existing = this.chunkBuffer.get(msg.sessionId) || ""
      this.chunkBuffer.set(msg.sessionId, existing + msg.text)
      if (!this.chunkFlushTimer) {
        this.chunkFlushTimer = setTimeout(() => this.flushChunkBuffer(), ChatProvider.CHUNK_FLUSH_MS)
      }
      return
    }

    // For stream_end, flush any remaining chunks first so the webview has all text
    if (msg.type === "stream_end") {
      this.flushChunkBuffer()
    }

    this._view?.webview.postMessage(msg)
  }

  /** R2: Flush buffered text chunks to the webview as a single message per session */
  private flushChunkBuffer(): void {
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer)
      this.chunkFlushTimer = null
    }
    if (this.chunkBuffer.size === 0) return

    for (const [sessionId, text] of this.chunkBuffer) {
      this._view?.webview.postMessage({ type: "stream_chunk", sessionId, text })
    }
    this.chunkBuffer.clear()
  }

  private postRequestError(message: string): void {
    this.postMessage({
      type: "request_error",
      message: this.toUserErrorMessage(message),
    })
  }

  private toUserErrorMessage(message: string): string {
    if (/server not running/i.test(message)) return "OpenCode is not connected. Try again after the server starts."
    if (/not installed|not found/i.test(message)) return message
    if (/timeout|did not start/i.test(message)) return "OpenCode took too long to respond. Check the output logs and try again."
    return message || "The request failed. Check the OpenCode output logs for details."
  }

  private mapToolType(tool: string): string {
    if (!tool) return "read"
    const t = tool.toLowerCase()
    if (t.includes("edit") || t.includes("write") || t.includes("create") || t.includes("apply")) return "write"
    if (t.includes("bash") || t.includes("exec") || t.includes("run") || t.includes("command")) return "exec"
    return "read"
  }

  dispose(): void {
    // R2: Flush any remaining chunks and clear timer
    this.flushChunkBuffer()
    this.chunkBuffer.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.streamCoordinator.dispose()
    this.tabManager.dispose()
  }
}
