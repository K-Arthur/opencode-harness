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
import { PromptManager, PromptCommand } from "../prompts/PromptManager"
import { log } from "../utils/outputChannel"
import { parseModelRef } from "../utils/tokenCounter"
import { ChatMessage, Block } from "./types"
import { MessageRouter } from "./handlers/MessageRouter"
import { ChatCommands } from "./ChatCommands"
import { AutoCompactor } from "./AutoCompactor"
import { ChatFileOps } from "./ChatFileOps"
import { ChunkBatcher } from "./ChunkBatcher"

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
  private chatCommands: ChatCommands
  private autoCompactor: AutoCompactor
  private fileOps = new ChatFileOps()

  /** H3: Queue of messages buffered before webview was ready */
  private earlyMessageQueue: Record<string, unknown>[] = []

  /** H6: Guard against duplicate prompt submissions — per-tab lock */
  private promptsInFlight = new Set<string>()

  /** R2: Chunk batching — buffers text_chunks and flushes every 50ms to reduce postMessage overhead */
  private chunkBatcher = new ChunkBatcher((msg) => { this._view?.webview.postMessage(msg) })

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
    this.promptManager = new PromptManager()
    this.promptManager.scanWorkspace()
    this.promptManager.watchPrompts()
    this.promptManager.onChanged(() => this.pushCommandListToWebview())
    this.messageRouter = new MessageRouter(sessionManager, modelManager)
    this.chatCommands = new ChatCommands(sessionStore, sessionManager, this.tabManager, this.streamCoordinator)
    this.autoCompactor = new AutoCompactor(sessionManager, sessionStore, contextMonitor, this.tabManager)
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
      this.modelManager.onModelChanged((model) => this.pushModelToWebview(model)),
      this.modelManager.onModelsRefreshed(() => this.pushModelListToWebview()),
      this.themeManager.onThemeChanged(() => this.pushThemeToWebview()),
      this.rateLimitMonitor.onWarning((msg) => vscode.window.showWarningMessage(msg)),
      this.sessionStore.onActiveSessionChanged(() => this.syncActiveSession()),
      this.sessionManager.onEvent((event) => this.handleServerEvent(event)),
      this.tabManager.onStreamingStateChanged(({ tabId, isStreaming }) => {
        this.postMessage({ type: "streaming_state", sessionId: tabId, isStreaming })
      }),
      this.contextMonitor.onContextChanged?.((usage) => {
        this.postMessage({
          type: "context_usage",
          percent: usage.percent,
          tokens: usage.tokens,
          maxTokens: usage.maxTokens,
        })
        if (usage.percent >= 80) {
          this.autoCompactor.tryCompactIfNeeded({
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        }
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

  private static readonly VALID_WEBVIEW_TYPES = new Set([
    "create_tab", "send_prompt", "change_mode", "set_model", "abort",
    "close_tab", "switch_tab", "accept_diff", "reject_diff",
    "accept_permission", "mention_search", "list_sessions", "resume_session",
    "new_session", "get_models", "update_cost", "webview_ready", "rename_session",
    "open_settings", "open_mcp_settings", "attach_files", "export_chat",
    "compact_session", "execute_command", "list_commands",
    "insert_at_cursor", "create_file_from_code", "compact_banner_action",
    "edit_message", "attach_image",
])

  // ---------------------------------------------------------------------------
  // Webview message handler map - for lower complexity in handleWebviewMessage
  // ---------------------------------------------------------------------------

  private readonly webviewHandlers: Map<string, (msg: Record<string, unknown>, sessionId?: string) => void | Promise<void>> = new Map([
    ["create_tab", (msg, sessionId) => {
      if (sessionId) {
        this.ensureLocalTab(
          sessionId,
          typeof msg.name === "string" ? msg.name : undefined,
          typeof msg.model === "string" ? msg.model : undefined,
          typeof msg.mode === "string" ? msg.mode : undefined
        )
      }
    }],
    ["send_prompt", async (msg, sessionId) => {
      if (sessionId && typeof msg.text === "string" && msg.text.trim()) {
        if (this.promptsInFlight.has(sessionId)) return
        this.promptsInFlight.add(sessionId)
        try {
          this.ensureLocalTab(sessionId, msg.name as string | undefined, msg.model as string | undefined, msg.mode as string | undefined)
          const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
          const attachments = Array.isArray(msg.attachments) ? msg.attachments as Array<{ data: string; mimeType: string }> : []
          const textBlocks: Block[] = msg.text ? [{ type: "text", text: msg.text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId }
          this.sessionStore.appendMessage(sessionId, userMsg)
          await this.streamCoordinator.startPrompt(sessionId, msg.text as string || "[image]", {
            postMessage: (m) => this.postMessage(m),
            postRequestError: (m) => this.postRequestError(m),
          })
        } finally { this.promptsInFlight.delete(sessionId) }
      }
    }],
    ["change_mode", async (msg, sessionId) => {
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
    ["set_model", (msg, sessionId) => {
      if (msg.model) this.modelManager.setModel(msg.model as string)
      if (sessionId) {
        this.ensureLocalTab(sessionId)
        this.tabManager.setModel(sessionId, msg.model as string)
        const s = this.sessionStore.get(sessionId)
        if (s) this.sessionStore.updateModel(sessionId, msg.model as string)
      }
    }],
    ["abort", async (_, sessionId) => {
      if (sessionId) await this.streamCoordinator.abort(sessionId, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
    }],
    ["close_tab", (_, sessionId) => {
      if (sessionId) {
        const tab = this.tabManager.getTab(sessionId)
        if (tab?.isStreaming) void this.streamCoordinator.abort(sessionId, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) })
        this.tabManager.closeTab(sessionId)
      }
    }],
    ["switch_tab", (msg, sessionId) => {
      if (sessionId) { this.ensureLocalTab(sessionId); this.tabManager.switchTab(sessionId); this.sessionStore.setActive(sessionId) }
    }],
    ["accept_diff", async (msg) => { const blockId = msg.blockId; if (blockId) await this.handleAcceptDiff(blockId as string) }],
    ["reject_diff", (msg) => { const blockId = msg.blockId; if (blockId) this.streamCoordinator.getDiffHandler().reject(blockId as string) }],
    ["accept_permission", async (msg) => { await this.messageRouter.handleAcceptPermission(msg.sessionId as string, msg.permissionId as string, msg.response as string) }],
    ["mention_search", async (msg) => { await this.messageRouter.handleMentionSearch(msg.query as string || "", { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }) }],
    ["list_sessions", async () => { await this.messageRouter.handleListSessions(this.sessionStore, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }) }],
    ["resume_session", (msg) => { if (msg.sessionId) this.handleResumeSession(msg.sessionId as string) }],
    ["new_session", () => { vscode.commands.executeCommand("opencode-harness.newSession") }],
    ["get_models", () => { this.pushModelListToWebview() }],
    ["update_cost", (msg, sessionId) => {
      if (sessionId) {
        const cost = Number(msg.cost ?? 0)
        if (Number.isFinite(cost)) { this.sessionStore.updateCost(sessionId, cost); this.postMessage({ type: "cost_update", sessionId, cost }) }
      }
    }],
    ["rename_session", (msg, sessionId) => {
      if (sessionId && msg.name) { const ok = this.sessionStore.rename(sessionId, msg.name as string); if (ok) this.postMessage({ type: "session_renamed", sessionId, name: msg.name }) }
    }],
    ["webview_ready", () => { this.webviewReady = true; this.pushAllStateToWebview(); for (const q of this.earlyMessageQueue) this.postMessage(q); this.earlyMessageQueue = [] }],
    ["open_settings", () => { vscode.commands.executeCommand("workbench.action.openSettings", "opencode") }],
    ["open_mcp_settings", () => { vscode.commands.executeCommand("workbench.action.openSettings", "opencode.mcp") }],
    ["attach_files", async () => { await this.handleAttachFiles() }],
    ["attach_image", (msg, sessionId) => { if (sessionId && msg.data && msg.mimeType) log.info(`Image attachment for ${sessionId}`) }],
    ["export_chat", () => { vscode.commands.executeCommand("opencode-harness.exportConversation") }],
    ["compact_session", async (_, sessionId) => { await this.handleCompactSession(sessionId) }],
    ["execute_command", async (msg, sessionId) => { await this.handleExecuteCommand(sessionId, msg.command as string, msg.arguments as string) }],
    ["list_commands", async () => { await this.handleListCommands() }],
    ["insert_at_cursor", async (msg) => { await this.handleInsertAtCursor(msg.code as string, msg.language as string) }],
    ["create_file_from_code", async (msg) => { await this.handleCreateFileFromCode(msg.code as string, msg.language as string) }],
    ["compact_banner_action", async (msg, sessionId) => { await this.handleCompactBannerAction(sessionId, msg.action as string) }],
    ["edit_message", (msg, sessionId) => { if (sessionId && msg.messageId) this.handleEditMessage(sessionId, msg.messageId as string, msg.text as string) }],
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

    // Use handler map for cleaner dispatch
    const handler = this.webviewHandlers.get(msg.type)
    if (handler) {
      await handler(msg, sessionId)
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

  private handleAttachImage(sessionId: string, data: string, mimeType: string): void {
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

  private async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
    if (!sessionId || !command) return

    // Check if this is a custom prompt command
    const promptName = command.replace(/^\//, "")
    const customPrompt = this.promptManager.getPrompt(promptName)
    if (customPrompt) {
      const resolved = await this.resolveCustomPromptVariables(promptName)
      if (resolved) {
        this.sendPromptToWebview(resolved, true)
      }
      return
    }

    const tab = this.tabManager.getTab(sessionId)
    if (!tab?.cliSessionId || !this.sessionManager.isRunning) {
      this.postRequestError("Cannot execute command: server not running or session not linked")
      return
    }

    try {
      const modelRef = tab.model ? parseModelRef(tab.model) : undefined
      const result = await this.sessionManager.sendCommand(tab.cliSessionId, command, args)

      const blocks: Block[] = []
      for (const part of result.parts) {
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
      this.postRequestError(message)
    }
  }

  private async handleListCommands(): Promise<void> {
    try {
      const customCommands = this.promptManager.getPromptCommands()
      if (!this.sessionManager.isRunning) {
        this.postMessage({ type: "command_list", commands: customCommands })
        return
      }
      const commands = await this.sessionManager.listCommands()
      this.postMessage({ type: "command_list", commands: [...customCommands, ...commands] })
    } catch (err) {
      log.warn("Failed to list commands", err)
      const customCommands = this.promptManager.getPromptCommands()
      this.postMessage({ type: "command_list", commands: customCommands })
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
    ["tool_start", (event, tabId) => {
      const data = event.data as { tool?: string; input?: unknown; status?: string } | undefined
      this.postMessage({ type: "message", sessionId: tabId, message: { role: "system", blocks: [{ type: "tool_call", toolType: this.mapToolType(data?.tool || ""), toolName: data?.tool || "unknown", args: JSON.stringify(data?.input || {}), state: data?.status || "running" }], timestamp: Date.now(), sessionId: tabId } })
    }],
    ["tool_end", (event, tabId) => {
      const data = event.data as { tool?: string; result?: unknown } | undefined
      this.postMessage({ type: "tool_result", sessionId: tabId, toolName: data?.tool || "unknown", result: typeof data?.result === "string" ? data.result : JSON.stringify(data?.result ?? "") })
    }],
    ["skill_load", (event, tabId) => {
      const data = event.data as { skill?: string; name?: string; id?: string } | undefined
      this.postMessage({ type: "skill_indicator", sessionId: tabId, skillName: data?.skill || data?.name || data?.id || "skill" })
    }],
    ["text_chunk", (event, tabId, tab) => {
      const data = event.data as { text?: string } | undefined
      if (data?.text && tab) { try { this.streamCoordinator.appendChunk(tab.id, data.text, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }) } catch (err) { log.error("Error appending text chunk", err) } }
    }],
    ["message_complete", async (event, tabId, tab) => {
      if (tab) { await this.streamCoordinator.finalizeStream(tab.id, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }).catch(err => log.error("finalizeStream failed", err)) }
    }],
    ["session_status", (event, tabId, tab) => {
      const data = event.data as { status?: { type?: string } } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status })
      if (status === "idle" && tab) { this.streamCoordinator.finalizeStream(tab.id, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }).catch(err => log.error("finalizeStream idle failed", err)) }
    }],
    ["server_status", (event, tabId, tab) => {
      const data = event.data as { status?: { type?: string } | undefined } | undefined
      const rawStatus = data?.status?.type || "unknown"
      const status = rawStatus === "busy" ? "thinking" : rawStatus
      this.postMessage({ type: "server_status", sessionId: tabId, status })
      if (status === "idle" && tab) { this.streamCoordinator.finalizeStream(tab.id, { postMessage: (m) => this.postMessage(m), postRequestError: (m) => this.postRequestError(m) }).catch(err => log.error("finalizeStream server_status idle failed", err)) }
    }],
    ["permission_request", (event, tabId) => {
      const data = event.data as { id?: string; title?: string; type?: string } | undefined
      this.postMessage({ type: "permission_request", sessionId: tabId, permissionId: data?.id, title: data?.title || `Allow ${data?.type || "action"}?` })
    }],
    ["permission_replied", (event, tabId) => { log.info(`Permission response for ${tabId}`) }],
    ["file_edited", (event, tabId, tab) => {
      if (!tab?.isStreaming) return
      const data = event.data as { file?: string; files?: string[] } | undefined
      const file = data?.file || (Array.isArray(data?.files) && data.files[0])
      if (file) this.postMessage({ type: "file_edited", sessionId: tabId, file })
    }],
    ["thinking", (event, tabId) => {
      const data = event.data as { text?: string } | undefined
      this.postMessage({ type: "message", sessionId: tabId, message: { role: "system", blocks: [{ type: "thinking", text: data?.text || "" }], timestamp: Date.now(), sessionId: tabId } })
    }],
    ["session_compacted", (event, tabId) => { log.info(`Session compacted for ${tabId}`); this.postMessage({ type: "session_compacted", sessionId: tabId }) }],
    ["server_error", (event, tabId, tab) => {
      const data = event.data as { error?: Error | string } | undefined
      const errorMsg = data?.error instanceof Error ? data.error.message : String(data?.error || "Server error")
      log.error("Server error during streaming", errorMsg)
      if (tab) { this.postRequestError(errorMsg); this.tabManager.setStreaming(tab.id, false) }
    }],
    ["server_disconnected", () => {
      log.info("Server disconnected — resetting all streaming states")
      for (const t of this.tabManager.getAllTabs()) { if (t.isStreaming) { this.tabManager.setStreaming(t.id, false); this.postMessage({ type: "streaming_state", sessionId: t.id, isStreaming: false }) } }
      this.postRequestError("OpenCode server connection lost. Attempting to reconnect...")
    }],
    ["server_connected", () => { this.pushModelListToWebview() }],
  ])

  private handleServerEvent(event: { type: string; sessionId?: string; data?: unknown }): void {
    if (!this._view) return

    const tab = Array.from(this.tabManager.getAllTabs()).find((t) => t.cliSessionId === event.sessionId)
    const tabId = tab?.id || event.sessionId || ""

    const handler = this.serverEventHandlers.get(event.type)
    if (handler) { handler(event, tabId, tab!) }
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
    const MAX_MESSAGES_PER_TAB = 50
    const activeSession = this.sessionStore.getActive()
    const activeId = activeSession?.id || null

    // Only send the active session on init — avoid cluttering webview state
    // with historical sessions. History is fetched on-demand via list_sessions.
    const sessionsToSend: Record<string, unknown>[] = []
    if (activeSession) {
      sessionsToSend.push({
        id: activeSession.id,
        name: activeSession.name,
        model: activeSession.model,
        mode: activeSession.mode || "build",
        messages: activeSession.messages.slice(-MAX_MESSAGES_PER_TAB),
        isStreaming: false,
        cost: activeSession.cost || 0,
        totalMessages: activeSession.messages.length,
      })
    }

    this.postMessage({
      type: "init_state",
      sessions: sessionsToSend,
      activeSessionId: activeId,
      globalModel: this.modelManager.model || "",
    })
  }

  private pushAllStateToWebview(): void {
    this.pushInitStateToWebview()
    this.pushModelToWebview()
    this.pushModelListToWebview()
    this.pushThemeToWebview()
    this.pushCommandListToWebview()
    if (this.pendingPrompt) {
      this.postMessage({ type: "prefill_prompt", ...this.pendingPrompt })
      this.pendingPrompt = undefined
    }
  }

  private pushCommandListToWebview(): void {
    const customCommands = this.promptManager.getPromptCommands()
    if (!this.sessionManager.isRunning) {
      this.postMessage({ type: "command_list", commands: customCommands })
      return
    }
    this.sessionManager.listCommands().then((commands) => {
      this.postMessage({ type: "command_list", commands: [...customCommands, ...commands] })
    }).catch(() => {
      this.postMessage({ type: "command_list", commands: customCommands })
    })
  }

  private postMessage(msg: Record<string, unknown>): void {
    if (!this._view) return

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
      this.chunkBatcher.add(msg.sessionId, msg.text)
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

  /** R2: Flush buffered text chunks to the webview as a single message per session */
  private flushChunkBuffer(): void {
    this.chunkBatcher.flush()
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
  }
}
