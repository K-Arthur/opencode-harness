import * as vscode from "vscode"
import * as path from "path"
import type { TabManager } from "./TabManager"
import type { StatePushService } from "./StatePushService"
import type { SessionLifecycleService } from "./SessionLifecycleService"
import type { CommandExecutionService } from "./CommandExecutionService"
import type { SessionStore } from "../session/SessionStore"
import type { SessionManager } from "../session/SessionManager"
import type { ModelManager } from "../model/ModelManager"
import type { DiffApplier } from "../diff/DiffApplier"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { MessageRouter } from "./handlers/MessageRouter"
import type { AutoCompactor } from "./AutoCompactor"
import type { CheckpointManager } from "../checkpoint/CheckpointManager"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { ThemeManager } from "../theme/ThemeManager"
import type { ThemeController } from "./ThemeController"
import type { PromptManager } from "../prompts/PromptManager"
import type { ChatFileOps } from "./ChatFileOps"
import type { SteerPromptHandler } from "./handlers/SteerPromptHandler"
import type { ChatMessage, Block } from "./types"
import type { ContextMonitor } from "../monitor/ContextMonitor"
import type { UsageAnalytics } from "../monitor/UsageAnalytics"
import { log } from "../utils/outputChannel"
import { handleWebviewError } from "./utils/errorHandler"

const crypto = globalThis.crypto

export interface WebviewEventRouterOptions {
  tabManager: TabManager
  statePush: StatePushService
  sessionLifecycle: SessionLifecycleService
  commandExec: CommandExecutionService
  sessionStore: SessionStore
  sessionManager: SessionManager
  modelManager: ModelManager
  diffApplier: DiffApplier
  streamCoordinator: StreamCoordinator
  messageRouter: MessageRouter
  autoCompactor: AutoCompactor
  checkpointManager: CheckpointManager
  mcpServerManager: McpServerManager
  themeManager: ThemeManager
  themeController: ThemeController
  promptManager: PromptManager
  fileOps: ChatFileOps
  contextMonitor: ContextMonitor
  usageAnalytics: UsageAnalytics
  steerPromptHandler: SteerPromptHandler
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
  showWarningMessage: (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
  showInformationMessage: (message: string, ...items: string[]) => Thenable<string | undefined>
  showErrorMessage: (message: string) => Thenable<string | undefined>
  openExternal: (uri: vscode.Uri) => Thenable<boolean>
  handleEditMessage: (sessionId: string, messageId: string, text: string) => void
  handleInsertAtCursor: (code: string, language: string) => Promise<void>
  handleCreateFileFromCode: (code: string, language: string) => Promise<void>
  handleServerEvent: (event: { type: string; sessionId?: string; data?: unknown }) => void
  ensureLocalTab: (sessionId: string, name?: string, model?: string, mode?: string) => void
  handleConnectProvider: () => Promise<void>
  openOpenCodeConfigOrSettings: () => Promise<void>
  hasAutoModeConfirmed: () => boolean
  showAutoModeConfirmation: (sessionId: string) => Promise<boolean>
  replayLiveStreamsToWebview: () => void
  exportChat: () => void
  exportChatJson: () => void
  exportChatText: () => void
  copyChat: () => void
  stashPrompt: (name: string, content: string, isGlobal: boolean) => void
  listStashes: () => void
  deleteStash: (id: string) => void
  addProvider: (name: string, apiKey: string, baseUrl?: string) => void
  listProviders: () => void
  updateProvider: (id: string, updates: Record<string, unknown>) => void
  deleteProvider: (id: string) => void
  showOpenFolderDialog: (dir: string) => void
}

export class WebviewEventRouter {
  private promptsInFlight = new Set<string>()

  /** H3: Timeout for webview_ready message to prevent unbounded queue growth */
  private readyTimeout?: ReturnType<typeof setTimeout>

  private static readonly VALID_WEBVIEW_TYPES = new Set([
    "create_tab", "send_prompt", "change_mode", "set_model", "set_variant", "abort",
    "close_tab", "switch_tab", "accept_diff", "reject_diff",
    "accept_permission", "mention_search", "list_sessions", "resume_session",
    "new_session", "get_models", "update_cost", "webview_ready", "rename_session", "webview_log",
    "open_settings", "connect_provider", "open_mcp_settings", "open_mcp_config", "attach_files", "export_chat", "export_chat_json", "export_chat_text", "copy_chat", "stash_prompt", "list_stashes", "delete_stash", "add_provider", "list_providers", "update_provider", "delete_provider",
    "compact_session", "execute_command", "list_commands",
    "insert_at_cursor", "create_file_from_code", "compact_banner_action",
    "edit_message", "attach_image",
    "delete_session", "archive_session", "revert_message",
    "list_server_sessions", "delete_server_session", "resume_server_session",
    "add_mcp_server", "update_mcp_server", "remove_mcp_server", "toggle_mcp_server", "get_mcp_servers",
    "show_diff", "list_checkpoints", "restore_checkpoint",
    "preview_theme", "get_theme_config", "update_theme_config", "list_cli_themes",
    "request_more_messages", "stream_ack", "retry_stream", "request_state_sync",
    "set_instructions", "fork_session", "accept_hunk", "reject_hunk",
    "toggle_diff_wrap", "toggle_thinking", "revert_diff",
    "context_history_request", "context_cost_estimate", "context_suggestions_request",
    "send_steer_prompt", "add_to_queue",
    "get_todos", "toggle_todo", "delete_todo",
    "get_skills", "toggle_skill", "search_skills",
    "get_changed_files", "open_file",
    "get_subagent_activities", "cancel_subagent",
    "update_setting", "show_error", "get_context_usage", "record_stash_usage",
  ])

  private readonly webviewHandlers: Map<string, (msg: Record<string, unknown>, sessionId?: string) => void | Promise<void>> = new Map([
    ["create_tab", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        this.opts.ensureLocalTab(
          sessionId,
          typeof msg.name === "string" ? msg.name : undefined,
          typeof msg.model === "string" ? msg.model : undefined,
          typeof msg.mode === "string" ? msg.mode : undefined
        )
      }
    }],
    ["show_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      const filePath = msg.filePath as string
      const proposed = msg.proposedContent as string
      const title = msg.title as string | undefined
      if (filePath && proposed) {
        await this.opts.diffApplier.showSideBySideDiff(filePath, proposed, title)
      }
    }],
    ["send_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.text === "string" && msg.text.trim()) {
        if (this.promptsInFlight.has(sessionId)) return
        this.promptsInFlight.add(sessionId)
        try {
          const model = (msg.model as string | undefined) || this.opts.modelManager.model
          if (!model) { throw new Error("No model selected. Please select a model and try again.") }
          this.opts.ensureLocalTab(sessionId, msg.name as string | undefined, model, msg.mode as string | undefined)
          const variant = typeof msg.variant === "string" ? msg.variant : undefined
          const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
          // I7: validate attachments before they hit the session store / agent — caps size & MIME.
          const validatedAttachments = this.validateAttachments(msg.attachments)
          if (validatedAttachments === null) {
            this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
            return
          }
          const attachments = validatedAttachments
          const textBlocks: Block[] = msg.text ? [{ type: "text", text: msg.text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId }
          this.opts.sessionStore.appendMessage(sessionId, userMsg)
          await this.opts.streamCoordinator.startPrompt(sessionId, msg.text as string || "[image]", {
            postMessage: (m) => this.opts.postMessage(m),
            postRequestError: (m) => this.opts.postRequestError(m),
          }, variant)
        } catch (err) {
          log.error("send_prompt failed", err)
          this.opts.postRequestError(err instanceof Error ? err.message : "Failed to send prompt")
        } finally { this.promptsInFlight.delete(sessionId) }
      }
    }],
    ["change_mode", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const mode = msg.mode as string
        if (mode === "auto" && !this.opts.hasAutoModeConfirmed()) {
          const confirmed = await this.opts.showAutoModeConfirmation(sessionId)
          if (!confirmed) return
        }
        this.opts.ensureLocalTab(sessionId)
        this.opts.tabManager.setMode(sessionId, mode)
        this.opts.sessionStore.updateMode(sessionId, mode)
      }
    }],
    ["set_model", (msg: Record<string, unknown>, sessionId?: string) => {
      if (msg.model) this.opts.modelManager.setModel(msg.model as string)
      if (sessionId) {
        this.opts.ensureLocalTab(sessionId)
        this.opts.tabManager.setModel(sessionId, msg.model as string)
        const s = this.opts.sessionStore.get(sessionId)
        if (s) this.opts.sessionStore.updateModel(sessionId, msg.model as string)
      }
    }],
    ["set_variant", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && msg.variant) {
        this.opts.ensureLocalTab(sessionId)
        this.opts.sessionStore.updateVariant(sessionId, msg.variant as string)
      }
    }],
    ["set_instructions", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.instructions === "string") {
        this.opts.ensureLocalTab(sessionId)
        this.opts.tabManager.setInstructions(sessionId, msg.instructions)
      }
    }],
    ["accept_hunk", async (msg: Record<string, unknown>, sessionId?: string) => {
      const path = typeof msg.path === "string" ? msg.path : undefined
      const hunkId = typeof msg.hunkId === "string" ? msg.hunkId : undefined
      const hunk = msg.hunk as { id: string; hunkId: string; oldStart: number; oldCount: number; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> } | undefined
      if (!path || !hunkId || !hunk) return
      const ok = await this.opts.diffApplier.applyHunks(path, [hunk], new Set([hunkId]))
      this.opts.postMessage({ type: "hunk_result", hunkId, ok, diffId: msg.diffId, sessionId })
    }],
    ["reject_hunk", (msg: Record<string, unknown>) => {
      const hunkId = typeof msg.hunkId === "string" ? msg.hunkId : undefined
      if (hunkId) {
        this.opts.postMessage({ type: "hunk_result", hunkId, ok: true, rejected: true, diffId: msg.diffId })
      }
    }],
    ["fork_session", (msg: Record<string, unknown>, sessionId?: string) => {
      const sourceId = sessionId ?? (typeof msg.sessionId === "string" ? msg.sessionId : undefined)
      const turnIndex = typeof msg.turnIndex === "number" ? msg.turnIndex : undefined
      if (!sourceId || turnIndex === undefined) return
      const forked = this.opts.sessionStore.forkSession(sourceId, turnIndex)
      if (!forked) return
      this.opts.ensureLocalTab(forked.id, forked.name, forked.model, forked.mode)
      this.opts.tabManager.switchTab(forked.id)
      this.opts.postMessage({ type: "fork_created", sessionId: forked.id, name: forked.name, parentSessionId: sourceId, forkedAtTurn: turnIndex })
    }],
    ["abort", async (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) await this.opts.streamCoordinator.abort(sessionId, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) })
    }],
    ["webview_log", (msg: Record<string, unknown>) => {
      const lvl = msg.level === "warn" ? "warn" : msg.level === "error" ? "error" : "info"
      log[lvl](`[Webview] ${msg.message}`)
    }],
    ["retry_stream", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        void this.opts.streamCoordinator.retryFromHere(sessionId, {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m),
        }).catch(err => log.error("Retry stream failed", err))
      }
    }],
    ["close_tab", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const tab = this.opts.tabManager.getTab(sessionId)
        if (tab?.isStreaming) void this.opts.streamCoordinator.abort(sessionId, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }).catch(err => log.warn("Abort on close failed", err))
        this.opts.tabManager.closeTab(sessionId)
        this.opts.sessionStore.deleteIfEmpty(sessionId)
      }
    }],
    ["switch_tab", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) { this.opts.ensureLocalTab(sessionId); this.opts.tabManager.switchTab(sessionId); this.opts.sessionStore.setActive(sessionId) }
    }],
    ["accept_diff", async (msg: Record<string, unknown>, sessionId?: string) => { const diffId = msg.diffId as string || msg.blockId as string; if (diffId) await this.opts.sessionLifecycle.handleAcceptDiff(diffId, sessionId) }],
    ["reject_diff", (msg: Record<string, unknown>) => { const diffId = msg.diffId as string || msg.blockId as string; if (diffId) this.opts.streamCoordinator.getDiffHandler().reject(diffId) }],
    ["accept_permission", async (msg: Record<string, unknown>) => { await this.opts.messageRouter.handleAcceptPermission(msg.sessionId as string, msg.permissionId as string, msg.response as string) }],
    ["mention_search", async (msg: Record<string, unknown>) => { await this.opts.messageRouter.handleMentionSearch(msg.query as string || "", { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }) }],
    ["list_sessions", async () => { await this.opts.messageRouter.handleListSessions(this.opts.sessionStore, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }) }],
    ["resume_session", async (msg: Record<string, unknown>) => { if (msg.sessionId) await this.opts.sessionLifecycle.handleResumeSession(msg.sessionId as string) }],
    ["new_session", async () => {
      const session = this.opts.sessionStore.create()
      await this.opts.sessionLifecycle.openSessionInWebview(session.id)
    }],
    ["get_models", () => { this.pushModelListToWebview() }],
    ["update_cost", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const cost = Number(msg.cost ?? 0)
        if (Number.isFinite(cost) && cost > 0) {
          this.opts.sessionStore.updateCost(sessionId, cost)
          const session = this.opts.sessionStore.get(sessionId)
          this.opts.postMessage({ type: "cost_update", sessionId, cost: session?.cost ?? cost })
        }
      }
    }],
    ["rename_session", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && msg.name) { const ok = this.opts.sessionStore.rename(sessionId, msg.name as string); if (ok) this.opts.postMessage({ type: "session_renamed", sessionId, name: msg.name }) }
    }],
    ["webview_ready", async () => {
      this.clearReadyTimeout()
      this.webviewReady = true
      this.opts.statePush.pushAllStateToWebview()
      if (this.earlyMessageQueue.length > 0) {
        const queue = this.earlyMessageQueue
        this.earlyMessageQueue = []
        setTimeout(() => {
          for (const q of queue) this.opts.postMessage(q)
        }, 0)
      }
      this.opts.replayLiveStreamsToWebview()
      if (this.pendingOpenSessionId) {
        const sessionId = this.pendingOpenSessionId
        this.pendingOpenSessionId = undefined
        await this.opts.sessionLifecycle.handleResumeSession(sessionId)
      }
    }],
    ["request_state_sync", () => {
      this.pushVisibleStateToWebview()
    }],
    ["open_settings", async () => { await this.opts.openOpenCodeConfigOrSettings() }],
    ["connect_provider", async () => { await this.opts.handleConnectProvider() }],
    ["open_mcp_settings", async () => { await this.opts.mcpServerManager.openPrimaryConfigFile() }],
    ["open_mcp_config", () => { this.pushMcpServersToWebview() }],
    ["get_mcp_servers", () => { this.pushMcpServersToWebview() }],
    ["add_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const config = msg.config as { command: string; args?: string[]; env?: Record<string, string> }
      if (name && config) {
        await this.opts.mcpServerManager.addServer(name, config)
        this.pushMcpServersToWebview()
      }
    }],
    ["update_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const config = msg.config as Partial<{ command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }>
      if (name && config) {
        await this.opts.mcpServerManager.updateServer(name, config)
        this.pushMcpServersToWebview()
      }
    }],
    ["remove_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      if (name) {
        await this.opts.mcpServerManager.removeServer(name)
        this.pushMcpServersToWebview()
      }
    }],
    ["toggle_mcp_server", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const disabled = msg.disabled as boolean
      if (name !== undefined && disabled !== undefined) {
        await this.opts.mcpServerManager.toggleServer(name, disabled)
        this.pushMcpServersToWebview()
      }
    }],
    ["attach_files", async () => { await this.opts.sessionLifecycle.handleAttachFiles() }],
    ["attach_image", (msg: Record<string, unknown>, sessionId?: string) => {
      // I7: enforce the same attachment caps even on the single-image path.
      if (!sessionId || typeof msg.data !== "string" || typeof msg.mimeType !== "string") return
      const validated = this.validateAttachments([{ data: msg.data, mimeType: msg.mimeType }])
      if (validated === null || validated.length === 0) {
        this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
        return
      }
      const safe = validated[0]
      if (!safe) return
      this.opts.sessionLifecycle.handleAttachImage(sessionId, safe.data, safe.mimeType)
    }],
    ["export_chat", () => { this.opts.exportChat() }],
    ["export_chat_json", () => { this.opts.exportChatJson() }],
    ["export_chat_text", () => { this.opts.exportChatText() }],
    ["copy_chat", () => { this.opts.copyChat() }],
    ["stash_prompt", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const content = msg.content as string
      const isGlobal = msg.isGlobal as boolean ?? true
      if (name && content) {
        await this.opts.stashPrompt(name, content, isGlobal)
      }
    }],
    ["list_stashes", () => { this.opts.listStashes() }],
    ["delete_stash", (msg: Record<string, unknown>) => {
      const id = msg.id as string
      if (id) {
        this.opts.deleteStash(id)
      }
    }],
    ["add_provider", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const apiKey = msg.apiKey as string
      const baseUrl = msg.baseUrl as string | undefined
      if (name && apiKey) {
        await this.opts.addProvider(name, apiKey, baseUrl)
      }
    }],
    ["list_providers", () => { this.opts.listProviders() }],
    ["update_provider", async (msg: Record<string, unknown>) => {
      const id = msg.id as string
      const updates = msg.updates as Record<string, unknown>
      if (id && updates) {
        await this.opts.updateProvider(id, updates)
      }
    }],
    ["delete_provider", (msg: Record<string, unknown>) => {
      const id = msg.id as string
      if (id) {
        this.opts.deleteProvider(id)
      }
    }],
    ["compact_session", async (_: Record<string, unknown>, sessionId?: string) => { await this.opts.sessionLifecycle.handleCompactSession(sessionId) }],
    ["execute_command", async (msg: Record<string, unknown>, sessionId?: string) => { await this.opts.commandExec.handleExecuteCommand(sessionId, msg.command as string, msg.arguments as string) }],
    ["list_commands", async () => { await this.handleListCommands() }],
    ["insert_at_cursor", async (msg: Record<string, unknown>) => { await this.opts.handleInsertAtCursor(msg.code as string, msg.language as string) }],
    ["create_file_from_code", async (msg: Record<string, unknown>) => { await this.opts.handleCreateFileFromCode(msg.code as string, msg.language as string) }],
    ["compact_banner_action", async (msg: Record<string, unknown>, sessionId?: string) => { await this.opts.autoCompactor.handleBannerAction(sessionId, msg.action as string, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }) }],
    ["edit_message", (msg: Record<string, unknown>, sessionId?: string) => { if (sessionId && msg.messageId) this.opts.handleEditMessage(sessionId, msg.messageId as string, msg.text as string) }],
    ["delete_session", async (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId) {
        const session = this.opts.sessionStore.get(targetId)
        if (session && session.messages.length > 0) {
          const confirmed = await this.opts.showWarningMessage(
            `Delete session "${session.name}"? This cannot be undone.`,
            { modal: true },
            "Delete"
          )
          if (confirmed !== "Delete") return
        }
        this.opts.sessionStore.delete(targetId)
        log.info(`Session deleted via webview: ${targetId}`)
      }
    }],
    ["archive_session", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId) {
        this.opts.sessionStore.archive(targetId)
        log.info(`Session archived: ${targetId}`)
      }
    }],
    ["revert_message", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.messageId === "string") {
        try {
          await this.opts.sessionManager.revertMessage(sessionId, msg.messageId)
          this.opts.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: true,
          })
          this.opts.showInformationMessage("Reverted changes from the selected message.")
        } catch (err) {
          log.error("Revert message failed", err)
          this.opts.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: false,
            error: (err as Error).message,
          })
          this.opts.showErrorMessage(`Failed to revert: ${(err as Error).message}`)
        }
      }
    }],
    ["list_server_sessions", async () => {
      if (!this.opts.sessionManager.isRunning) {
        this.opts.postMessage({ type: "server_session_list", sessions: [] })
        return
      }
      try {
        const all = await this.opts.sessionManager.listSessions()
        const currentDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        this.opts.postMessage({
          type: "server_session_list",
          sessions: all
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
              isCurrentWorkspace: !currentDir || !s.directory || s.directory === currentDir,
            })),
        })
      } catch (err) {
        log.error("Failed to list server sessions", err)
        this.opts.postMessage({ type: "server_session_list", sessions: [] })
      }
    }],
    ["resume_server_session", async (msg: Record<string, unknown>) => {
      const serverId = msg.serverSessionId as string | undefined
      const title   = msg.title as string | undefined
      const dir     = msg.directory as string | undefined
      if (!serverId) return

      const localSession = this.opts.sessionStore.importOneServerSession(serverId, title, dir)
      await this.opts.sessionLifecycle.handleResumeSession(localSession.id)

      const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (dir && wsDir && dir !== wsDir) {
        const choice = await this.opts.showInformationMessage(
          `This session was created in "${path.basename(dir)}". Open that folder in VS Code?`,
          "Open Folder",
          "Continue Here"
        )
        if (choice === "Open Folder") {
          this.opts.showOpenFolderDialog(dir)
        }
      }
    }],
    ["list_checkpoints", async (_: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      try {
        const checkpoints = await this.opts.checkpointManager.listCheckpoints(sessionId)
        this.opts.postMessage({
          type: "checkpoint_list",
          sessionId,
          checkpoints: checkpoints.map((cp) => ({
            id: cp.id,
            sessionId: cp.sessionId,
            messageId: cp.messageId,
            filesChanged: cp.filesChanged,
            gitRef: cp.gitRef,
          })),
        })
      } catch (err) {
        log.error("Failed to list checkpoints", err)
        this.opts.postMessage({ type: "checkpoint_list", sessionId, checkpoints: [] })
      }
    }],
    ["restore_checkpoint", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.checkpointId !== "string") return
      try {
        const ok = await this.opts.checkpointManager.restore(msg.checkpointId as string)
        this.opts.postMessage({ type: "checkpoint_restored", sessionId, ok })
      } catch (err) {
        log.error("Failed to restore checkpoint", err)
        this.opts.postMessage({ type: "checkpoint_restored", sessionId, ok: false, error: (err as Error).message })
        this.opts.showErrorMessage(`Failed to restore checkpoint: ${(err as Error).message}`)
      }
    }],
    ["request_more_messages", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      const beforeIndex = typeof msg.beforeIndex === "number" ? msg.beforeIndex : session.messages.length
      const limit = typeof msg.limit === "number" ? msg.limit : 50
      const start = Math.max(0, beforeIndex - limit)
      const slice = session.messages.slice(start, beforeIndex)
      this.opts.postMessage({
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
      if (!serverId || !this.opts.sessionManager.isRunning) return

      const confirm = await this.opts.showWarningMessage(
        `Delete server session "${serverId.slice(0, 20)}..."? This removes it from the server permanently.`,
        { modal: true },
        "Delete from Server",
        "Cancel"
      )
      if (confirm !== "Delete from Server") return

      try {
        await this.opts.sessionManager.deleteSession(serverId)
        log.info(`Server session deleted: ${serverId}`)

        for (const local of this.opts.sessionStore.list(true)) {
          if (local.cliSessionId === serverId) {
            this.opts.sessionStore.delete(local.id)
            log.info(`Cleaned up extension session ${local.id} matching deleted server session ${serverId}`)
            break
          }
        }

        this.opts.postMessage({ type: "server_session_deleted", serverSessionId: serverId })
      } catch (err) {
        log.error(`Failed to delete server session ${serverId}`, err)
        this.opts.showErrorMessage(`Failed to delete server session: ${(err as Error).message}`)
      }
    }],
    ["preview_theme", async (_msg: Record<string, unknown>, _sessionId?: string) => {
      try {
        await this.opts.themeManager.previewTheme()
      } catch (err) {
        log.error("Theme preview failed", err)
        this.opts.showErrorMessage(`Theme preview failed: ${(err as Error).message}`)
      }
    }],
    ["get_theme_config", () => {
      this.opts.themeController.pushThemeConfigToWebview()
    }],
    ["update_theme_config", async (msg: Record<string, unknown>) => {
      await this.opts.themeController.handleUpdateThemeConfig(msg.theme)
    }],
    ["list_cli_themes", () => {
      const themes = this.opts.themeManager.discoverCliThemes()
      this.opts.postMessage({ type: "cli_themes_list", themes })
    }],
    ["toggle_diff_wrap", (msg: Record<string, unknown>) => {
      const enabled = msg.enabled === true
      this.opts.postMessage({
        type: "display_pref_update",
        pref: "diffWrapEnabled",
        value: enabled,
      })
    }],
    ["toggle_thinking", (msg: Record<string, unknown>) => {
      const visible = msg.visible === true
      this.opts.postMessage({
        type: "display_pref_update",
        pref: "thinkingVisible",
        value: visible,
      })
    }],
    ["update_setting", (msg: Record<string, unknown>) => {
      const key = msg.key as string
      const value = msg.value
      if (key === "skipModeWarning" && value === true) {
        this.opts.postMessage({ type: "display_pref_update", pref: "skipModeWarning", value: true })
      }
    }],
    ["show_error", (msg: Record<string, unknown>) => {
      const message = msg.message as string
      if (message) {
        this.opts.postRequestError(message)
      }
    }],
    ["revert_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      const diffId = msg.diffId as string
      const path = msg.path as string
      if (!diffId || !path || !sessionId) {
        log.warn("Invalid revert_diff message: missing required fields")
        return
      }

      try {
        // Find the diff in the session and revert it
        const success = await this.opts.diffApplier.rollbackEdit({
          filePath: path,
          backupPath: "", // Will be looked up from diff metadata
        } as any)

        if (success) {
          this.opts.postMessage({
            type: "revert_success",
            diffId,
            path,
            sessionId,
          })
        } else {
          log.warn("Revert operation returned false", { diffId, path, sessionId })
          this.opts.postMessage({
            type: "revert_failed",
            diffId,
            path,
            sessionId,
            error: "Failed to revert changes",
          })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log.error("Revert failed", err)
        this.opts.postMessage({
          type: "revert_failed",
          diffId,
          path,
          sessionId,
          error: errorMsg,
        })
      }
    }],
    ["context_history_request", (msg: Record<string, unknown>) => {
      const days = typeof msg.days === "number" ? msg.days : 7
      const sessionId = msg.sessionId as string | undefined
      const history = this.opts.contextMonitor.getHistory(sessionId)
      const statistics = this.opts.usageAnalytics.getUsageStatistics(days)
      
      this.opts.postMessage({
        type: "context_history_response",
        history,
        statistics,
        trackingEnabled: this.opts.contextMonitor.isTrackingEnabled(),
        retentionDays: this.opts.contextMonitor.getHistoryRetentionDays(),
      })
    }],
    ["context_cost_estimate", (msg: Record<string, unknown>) => {
      const pendingTokens = typeof msg.pendingTokens === "number" ? msg.pendingTokens : 0
      const prediction = this.opts.contextMonitor.predictUsage(pendingTokens)
      
      this.opts.postMessage({
        type: "context_cost_estimate_response",
        predictedTokens: prediction.predictedTokens,
        predictedCost: prediction.predictedCost,
        willOverflow: prediction.willOverflow,
      })
    }],
    ["context_suggestions_request", (msg: Record<string, unknown>) => {
      const days = typeof msg.days === "number" ? msg.days : 7
      
      // Use ContextMonitor for proactive optimization suggestions
      const suggestions = this.opts.contextMonitor.generateOptimizationSuggestions()
      
      this.opts.postMessage({
        type: "context_suggestions_response",
        suggestions: suggestions.map(s => ({
          type: s.type,
          title: s.type.charAt(0).toUpperCase() + s.type.slice(1),
          description: s.message,
          priority: s.priority,
          estimatedSavings: s.estimatedSavings
        })),
      })
    }],
    ["get_todos", async (_: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      const cliSessionId = session?.cliSessionId
      if (!cliSessionId || !this.opts.sessionManager.isRunning) {
        this.opts.postMessage({ type: "todos_update", todos: [], sessionId })
        return
      }
      try {
        const raw = await this.opts.sessionManager.getSessionTodos(cliSessionId)
        const todos = raw.map((t) => ({
          id: t.id,
          content: t.content,
          status: t.status === "in_progress" ? "in-progress" : t.status,
          createdAt: 0,
        }))
        this.opts.postMessage({ type: "todos_update", todos, sessionId })
      } catch (err) {
        log.error("Failed to fetch todos", err)
        this.opts.postMessage({ type: "todos_update", todos: [], sessionId })
      }
    }],
    ["toggle_todo", (_: Record<string, unknown>, sessionId?: string) => {
      // Server-managed todos are read-only; the AI agent controls their state.
      if (!sessionId) return
    }],
    ["delete_todo", (_: Record<string, unknown>, sessionId?: string) => {
      // Server-managed todos are read-only; the AI agent controls their state.
      if (!sessionId) return
    }],
    ["get_changed_files", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      
      // Convert changedFiles string[] to FileChange format
      const files = (session.changedFiles || []).map((path: string) => ({
        path,
        added: 0,
        removed: 0,
      }))
      this.opts.postMessage({ type: "changed_files_update", files, sessionId })
    }],
    ["open_file", async (msg: Record<string, unknown>) => {
      const rawPath = msg.path as string | undefined
      if (!rawPath) return

      try {
        let filePath = rawPath

        // Strip URI fragments (e.g. #L4 for line selection)
        const fragmentIdx = filePath.indexOf("#")
        let lineNumber: number | undefined
        if (fragmentIdx >= 0) {
          const fragment = filePath.slice(fragmentIdx + 1)
          const lineMatch = fragment.match(/^L(\d+)/)
          if (lineMatch) lineNumber = parseInt(lineMatch[1] ?? "0", 10)
          filePath = filePath.slice(0, fragmentIdx)
        }

        // Expand ~/ to home directory
        if (filePath.startsWith("~/") || filePath === "~") {
          const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
          filePath = path.join(home, filePath.replace(/^~/, ""))
        }

        // Resolve relative paths against workspace root
        if (!path.isAbsolute(filePath)) {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          if (workspaceRoot) {
            filePath = path.join(workspaceRoot, filePath)
          } else {
            this.opts.showErrorMessage(`Cannot open relative file "${rawPath}": no workspace folder open`)
            return
          }
        }

        const uri = vscode.Uri.file(filePath)
        const doc = await vscode.workspace.openTextDocument(uri)
        const options: vscode.TextDocumentShowOptions = {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
        }
        if (lineNumber) {
          options.selection = new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0)
        }
        await vscode.window.showTextDocument(doc, options)
      } catch (err) {
        log.error(`Failed to open file: ${rawPath}`, err)
        this.opts.showErrorMessage(`Failed to open file: ${(err as Error).message}`)
      }
    }],
    ["get_skills", async (_: Record<string, unknown>) => {
      try {
        const all = await this.resolveAllSkills()
        this.opts.postMessage({ type: "skills_list", skills: all })
      } catch (err) {
        log.error("Failed to list skills", err)
        this.opts.postMessage({ type: "skills_list", skills: [] })
      }
    }],
    ["toggle_skill", (_: Record<string, unknown>) => {
      // Agent enable/disable is not supported by the opencode server API.
    }],
    ["search_skills", async (msg: Record<string, unknown>) => {
      const query = (msg.query as string | undefined)?.toLowerCase() || ""
      try {
        const all = await this.resolveAllSkills()
        const results = query
          ? all.filter((s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
          : all
        this.opts.postMessage({ type: "skills_search_results", results, query })
      } catch (err) {
        log.error("Failed to search skills", err)
        this.opts.postMessage({ type: "skills_search_results", results: [], query })
      }
    }],
    ["get_subagent_activities", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      // TODO: Implement proper subagent activity tracking
      const activities: any[] = []
      this.opts.postMessage({ type: "subagent_activities", activities, sessionId })
    }],
    ["cancel_subagent", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const subagentId = msg.subagentId as string | undefined
      if (!subagentId) return
      // TODO: Implement proper subagent cancellation
      log.info(`Cancel subagent ${subagentId} in session ${sessionId}`)
    }],
    ["add_to_queue", (msg: Record<string, unknown>, sessionId?: string) => {
      // I7: validate before round-tripping back to the webview to forestall payload bloat.
      const validated = this.validateAttachments(msg.attachments)
      if (validated === null) {
        if (sessionId) this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
        return
      }
      // Forward to webview to handle queue addition
      this.opts.postMessage({
        type: "add_to_queue",
        sessionId,
        text: msg.text as string || "",
        attachments: validated,
        isSteerPrompt: msg.isSteerPrompt as boolean || false,
      })
    }],
    ["send_steer_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      try {
        // I7: validate attachments on this path too.
        const validated = this.validateAttachments(msg.attachments)
        if (validated === null) {
          this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
          return
        }
        const steerPrompt = {
          id: `steer-${crypto.randomUUID()}`,
          text: msg.text as string || "",
          attachments: validated,
          mode: msg.mode as 'interrupt' | 'append' | 'queue' || 'interrupt',
          timestamp: Date.now(),
          sessionId,
        }
        await this.opts.steerPromptHandler.sendSteerPrompt(sessionId, steerPrompt, {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m, sessionId),
        })
      } catch (error) {
        log.error(`[WebviewEventRouter] Error handling send_steer_prompt: ${error}`)
        this.opts.postRequestError(`Failed to send steer prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
      }
    }],
  ])

  webviewReady = false

  /** H3: Maximum queue size to prevent unbounded memory growth */
  private static readonly MAX_QUEUE_SIZE = 100
  /** H3: Timeout for webview_ready message to prevent unbounded queue growth */
  private static readonly READY_TIMEOUT_MS = 5000

  /** H3: Queue of messages buffered before webview was ready */
  earlyMessageQueue: Record<string, unknown>[] = []

  pendingOpenSessionId?: string

  constructor(private opts: WebviewEventRouterOptions) {}

  /**
   * O1: Message types that lose meaning if newer instances arrive. We drop the oldest copy
   * before evicting anything else so state updates collapse instead of crowding out critical
   * messages like init_state or stream_end.
   */
  private static readonly COALESCEABLE_TYPES = new Set([
    "theme_vars", "theme_config", "model_list", "model_update",
    "rate_limit_state", "context_usage", "cost_update", "streaming_state",
  ])

  /** O1: Message types that must never be silently dropped from the early queue. */
  private static readonly UNDROPPABLE_TYPES = new Set([
    "init_state", "stream_start", "stream_end", "stream_tool_start", "stream_tool_end",
    "error", "request_error", "session_deleted", "session_renamed", "session_list_update",
    "webview_request_error", "prompt_rejected",
  ])

  /**
   * Enqueue a message with queue size enforcement.
   * O1: When the queue is full, prefer evicting a stale coalesceable update over the oldest
   * message. Undroppable critical messages are never evicted; if the queue is full of them,
   * we evict the oldest non-critical instead. As a last resort, drop the incoming message.
   */
  public enqueueMessage(msg: Record<string, unknown>): void {
    if (this.webviewReady) {
      // Webview is ready, send immediately
      this.opts.postMessage(msg)
      return
    }

    if (this.earlyMessageQueue.length >= WebviewEventRouter.MAX_QUEUE_SIZE) {
      const incomingType = msg.type as string
      // Prefer evicting a stale coalesceable message of the SAME type — collapses repeated updates.
      const sameTypeIdx = this.earlyMessageQueue.findIndex(m => m.type === incomingType && WebviewEventRouter.COALESCEABLE_TYPES.has(incomingType))
      if (sameTypeIdx >= 0) {
        this.earlyMessageQueue.splice(sameTypeIdx, 1)
      } else {
        // Otherwise evict the oldest non-undroppable message.
        const oldestDroppable = this.earlyMessageQueue.findIndex(m => !WebviewEventRouter.UNDROPPABLE_TYPES.has(m.type as string))
        if (oldestDroppable >= 0) {
          const dropped = this.earlyMessageQueue.splice(oldestDroppable, 1)[0]
          log.warn(`Early message queue full — evicting non-critical ${dropped?.type ?? "?"} to make room for ${incomingType}`)
        } else if (WebviewEventRouter.UNDROPPABLE_TYPES.has(incomingType)) {
          // Queue is wall-to-wall critical AND so is the incoming message — drop the oldest to keep going.
          log.error(`Early message queue is full of undroppable messages; dropping oldest to enqueue ${incomingType}`)
          this.earlyMessageQueue.shift()
        } else {
          // Drop the incoming non-critical message rather than displacing a critical one.
          log.warn(`Early message queue full and all undroppable; dropping incoming ${incomingType}`)
          return
        }
      }
    }

    this.earlyMessageQueue.push(msg)
  }

  /** Start ready timeout when webviewReady is set to false */
  startReadyTimeout(): void {
    this.clearReadyTimeout()
    this.readyTimeout = setTimeout(() => {
      if (!this.webviewReady && this.earlyMessageQueue.length > 0) {
        log.warn(`Webview ready timeout after ${WebviewEventRouter.READY_TIMEOUT_MS}ms, flushing ${this.earlyMessageQueue.length} queued messages`)
        // Flush queued messages even though webview may not be fully ready
        for (const msg of this.earlyMessageQueue) {
          try {
            this.opts.postMessage(msg)
          } catch (err) {
            log.error(`Failed to post queued message during ready timeout: ${msg.type}`, err)
            // Add failed message to retry queue if it's a critical type
            // Note: This is a simplified retry - proper implementation would need access to retry logic
            log.warn(`Message dropped during ready timeout: ${msg.type}`)
          }
        }
        this.earlyMessageQueue = []
      } else if (!this.webviewReady) {
        log.warn(`Webview ready timeout after ${WebviewEventRouter.READY_TIMEOUT_MS}ms but no queued messages to flush`)
      }
    }, WebviewEventRouter.READY_TIMEOUT_MS)
  }

  /** Clear ready timeout when webview_ready message arrives */
  clearReadyTimeout(): void {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout)
      this.readyTimeout = undefined
    }
  }

  /**
   * I7: Validate inbound attachment payloads. Caps total size and enforces a MIME allowlist
   * so an oversized or hostile attachment cannot exhaust memory or smuggle in script content.
   * Returns a sanitized list — invalid entries are dropped with a warning.
   */
  private static readonly ATTACHMENT_MIME_ALLOWLIST = new Set([
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf", "text/plain", "text/markdown",
  ])
  private static readonly ATTACHMENT_MAX_BYTES_PER_ITEM = 8 * 1024 * 1024   // 8 MB per attachment
  private static readonly ATTACHMENT_MAX_TOTAL_BYTES = 24 * 1024 * 1024     // 24 MB aggregate
  private static readonly ATTACHMENT_MAX_COUNT = 10

  /** I7: Decode-free size estimate — base64 expands by ~4/3, so payload bytes ≈ length * 3/4. */
  private static estimateBase64Bytes(b64: string): number {
    return Math.floor((b64.length * 3) / 4)
  }

  /** I7: returns null if any attachment is over-limit or malformed. Otherwise returns the safe subset. */
  public validateAttachments(raw: unknown): Array<{ data: string; mimeType: string }> | null {
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw)) {
      log.warn("Rejected attachments: not an array")
      return null
    }
    if (raw.length > WebviewEventRouter.ATTACHMENT_MAX_COUNT) {
      log.warn(`Rejected attachments: too many (${raw.length} > ${WebviewEventRouter.ATTACHMENT_MAX_COUNT})`)
      return null
    }
    const safe: Array<{ data: string; mimeType: string }> = []
    let totalBytes = 0
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") { log.warn("Rejected attachment: not an object"); return null }
      const item = entry as Record<string, unknown>
      const mimeType = item.mimeType
      const data = item.data
      if (typeof mimeType !== "string" || typeof data !== "string") {
        log.warn("Rejected attachment: missing data or mimeType")
        return null
      }
      if (!WebviewEventRouter.ATTACHMENT_MIME_ALLOWLIST.has(mimeType)) {
        log.warn(`Rejected attachment: disallowed mimeType ${mimeType}`)
        return null
      }
      // Validate base64 (allows standard alphabet, optional padding).
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        log.warn("Rejected attachment: data is not valid base64")
        return null
      }
      const bytes = WebviewEventRouter.estimateBase64Bytes(data)
      if (bytes > WebviewEventRouter.ATTACHMENT_MAX_BYTES_PER_ITEM) {
        log.warn(`Rejected attachment: ${bytes} bytes exceeds per-item cap`)
        return null
      }
      totalBytes += bytes
      if (totalBytes > WebviewEventRouter.ATTACHMENT_MAX_TOTAL_BYTES) {
        log.warn(`Rejected attachments: aggregate ${totalBytes} bytes exceeds cap`)
        return null
      }
      safe.push({ data, mimeType })
    }
    return safe
  }

  async route(msg: Record<string, unknown>): Promise<void> {
    if (!msg || typeof msg.type !== "string") return

    const sessionId = msg.sessionId as string | undefined
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100)) return

    if (!WebviewEventRouter.VALID_WEBVIEW_TYPES.has(msg.type)) {
      log.warn(`Unknown webview message type: ${msg.type}`)
      // O7: surface unknown-type rejections to the webview so version-skew is observable
      // and the UI can release any pending state instead of waiting forever for a response.
      try {
        this.opts.postMessage({
          type: "webview_request_error",
          requestType: msg.type,
          requestId: typeof msg.requestId === "string" ? msg.requestId : undefined,
          sessionId,
          error: `Unknown webview message type: ${msg.type}`,
          reason: "unknown_type",
        })
      } catch { /* best-effort */ }
      return
    }

    // Comprehensive message validation
    if (!this.validateMessage(msg, msg.type)) {
      // I2: surface validation failures to the webview so controls (send button, etc.) can recover.
      try {
        this.opts.postMessage({
          type: "webview_request_error",
          requestType: msg.type,
          requestId: typeof msg.requestId === "string" ? msg.requestId : undefined,
          sessionId,
          error: `Rejected ${msg.type}: invalid payload`,
          reason: "invalid_payload",
        })
      } catch { /* best-effort */ }
      return
    }

    const handler = this.webviewHandlers.get(msg.type)
    if (handler) {
      try {
        await handler(msg, sessionId)
      } catch (err) {
        handleWebviewError(err, msg.type, sessionId, this.opts.postRequestError)
      }
    }
  }

  private validateMessage(msg: Record<string, unknown>, msgType: string): boolean {
    switch (msgType) {
      case "send_prompt": {
        const text = msg.text as string | undefined
        if (!text || typeof text !== "string" || text.length > 50000) {
          log.warn("Rejected oversized or invalid prompt")
          return false
        }
        break
      }
      case "mention_search": {
        const query = msg.query as string | undefined
        if (query && (typeof query !== "string" || query.length > 500)) {
          log.warn("Rejected oversized mention search query")
          return false
        }
        break
      }
      case "change_mode": {
        const mode = msg.mode as string | undefined
        if (mode && !["normal", "plan", "build", "auto"].includes(mode)) {
          log.warn(`Invalid mode: ${mode}`)
          return false
        }
        break
      }
      case "update_theme_config":
        if (!this.opts.themeController.isValidThemeConfigPayload(msg.theme)) {
          log.warn("Rejected invalid theme config payload")
          return false
        }
        break
      case "set_model":
      case "set_variant":
        // Validate model/variant strings if provided
        if (msg.model && typeof msg.model !== "string") {
          log.warn("Invalid model type")
          return false
        }
        if (msg.variant && typeof msg.variant !== "string") {
          log.warn("Invalid variant type")
          return false
        }
        break
      case "edit_message":
        // Validate edit message fields
        if (!msg.messageId || typeof msg.messageId !== "string") {
          log.warn("Invalid messageId in edit_message")
          return false
        }
        if (msg.text !== undefined && typeof msg.text !== "string") {
          log.warn("Invalid text type in edit_message")
          return false
        }
        break
      case "rename_session":
        if (!msg.name || typeof msg.name !== "string" || msg.name.length > 200) {
          log.warn("Invalid session name")
          return false
        }
        break
      case "compact_banner_action":
        if (!msg.action || typeof msg.action !== "string") {
          log.warn("Invalid action in compact_banner_action")
          return false
        }
        break
      case "execute_command":
        if (!msg.command || typeof msg.command !== "string") {
          log.warn("Invalid command in execute_command")
          return false
        }
        break
      case "restore_checkpoint":
        if (!msg.checkpointId || typeof msg.checkpointId !== "string") {
          log.warn("Invalid checkpointId in restore_checkpoint")
          return false
        }
        break
      case "delete_stash":
      case "delete_provider":
        if (!msg.id || typeof msg.id !== "string") {
          log.warn(`Invalid id in ${msgType}`)
          return false
        }
        break
      case "add_provider":
        if (!msg.name || typeof msg.name !== "string") {
          log.warn("Invalid name in add_provider")
          return false
        }
        if (!msg.apiKey || typeof msg.apiKey !== "string") {
          log.warn("Invalid apiKey in add_provider")
          return false
        }
        break
      case "update_provider":
        if (!msg.id || typeof msg.id !== "string") {
          log.warn("Invalid id in update_provider")
          return false
        }
        if (!msg.updates || typeof msg.updates !== "object") {
          log.warn("Invalid updates in update_provider")
          return false
        }
        break
      case "toggle_mcp_server":
        if (!msg.name || typeof msg.name !== "string") {
          log.warn("Invalid name in toggle_mcp_server")
          return false
        }
        if (typeof msg.disabled !== "boolean") {
          log.warn("Invalid disabled flag in toggle_mcp_server")
          return false
        }
        break
      case "add_mcp_server":
      case "update_mcp_server":
        if (!msg.name || typeof msg.name !== "string") {
          log.warn(`Invalid name in ${msgType}`)
          return false
        }
        if (!msg.config || typeof msg.config !== "object") {
          log.warn(`Invalid config in ${msgType}`)
          return false
        }
        break
      case "remove_mcp_server":
        if (!msg.name || typeof msg.name !== "string") {
          log.warn("Invalid name in remove_mcp_server")
          return false
        }
        break
      case "accept_diff":
      case "reject_diff":
        if (!msg.diffId && !msg.blockId) {
          log.warn(`Missing diffId/blockId in ${msgType}`)
          return false
        }
        break
      case "accept_permission":
        if (!msg.permissionId || typeof msg.permissionId !== "string") {
          log.warn("Invalid permissionId in accept_permission")
          return false
        }
        if (!msg.response || typeof msg.response !== "string") {
          log.warn("Invalid response in accept_permission")
          return false
        }
        break
      case "open_file":
        if (!msg.path || typeof msg.path !== "string") {
          log.warn("Invalid path in open_file")
          return false
        }
        break
      case "open_folder":
        if (!msg.dir || typeof msg.dir !== "string") {
          log.warn("Invalid dir in open_folder")
          return false
        }
        break
      case "open_url":
        if (!msg.url || typeof msg.url !== "string") {
          log.warn("Invalid url in open_url")
          return false
        }
        break
      case "show_diff":
        if (!msg.filePath || typeof msg.filePath !== "string") {
          log.warn("Invalid filePath in show_diff")
          return false
        }
        if (!msg.proposedContent || typeof msg.proposedContent !== "string") {
          log.warn("Invalid proposedContent in show_diff")
          return false
        }
        break
      case "insert_at_cursor":
      case "create_file_from_code":
        if (!msg.code || typeof msg.code !== "string") {
          log.warn(`Invalid code in ${msgType}`)
          return false
        }
        if (!msg.language || typeof msg.language !== "string") {
          log.warn(`Invalid language in ${msgType}`)
          return false
        }
        break
      case "fork_session":
        if (!msg.turnIndex || typeof msg.turnIndex !== "number") {
          log.warn("Invalid turnIndex in fork_session")
          return false
        }
        break
      case "revert_diff":
        if (!msg.diffId || typeof msg.diffId !== "string") {
          log.warn("Invalid diffId in revert_diff")
          return false
        }
        if (!msg.path || typeof msg.path !== "string") {
          log.warn("Invalid path in revert_diff")
          return false
        }
        break
      case "accept_hunk":
      case "reject_hunk":
        if (!msg.hunkId || typeof msg.hunkId !== "string") {
          log.warn(`Invalid hunkId in ${msgType}`)
          return false
        }
        break
      case "context_cost_estimate":
        if (msg.pendingTokens !== undefined && typeof msg.pendingTokens !== "number") {
          log.warn("Invalid pendingTokens in context_cost_estimate")
          return false
        }
        break
      case "context_history_request":
        if (msg.days !== undefined && typeof msg.days !== "number") {
          log.warn("Invalid days in context_history_request")
          return false
        }
        break
      case "context_suggestions_request":
        if (msg.days !== undefined && typeof msg.days !== "number") {
          log.warn("Invalid days in context_suggestions_request")
          return false
        }
        break
      case "request_more_messages":
        if (msg.beforeIndex !== undefined && typeof msg.beforeIndex !== "number") {
          log.warn("Invalid beforeIndex in request_more_messages")
          return false
        }
        if (msg.limit !== undefined && typeof msg.limit !== "number") {
          log.warn("Invalid limit in request_more_messages")
          return false
        }
        break
      case "delete_session":
      case "archive_session":
        if (!msg.targetSessionId || typeof msg.targetSessionId !== "string") {
          log.warn(`Invalid targetSessionId in ${msgType}`)
          return false
        }
        break
      case "resume_server_session":
        if (!msg.serverSessionId || typeof msg.serverSessionId !== "string") {
          log.warn("Invalid serverSessionId in resume_server_session")
          return false
        }
        break
      case "delete_server_session":
        if (!msg.serverSessionId || typeof msg.serverSessionId !== "string") {
          log.warn("Invalid serverSessionId in delete_server_session")
          return false
        }
        break
      case "update_cost":
        if (msg.cost !== undefined && (typeof msg.cost !== "number" || !Number.isFinite(msg.cost) || msg.cost < 0)) {
          log.warn("Invalid cost value")
          return false
        }
        break
      case "toggle_diff_wrap":
      case "toggle_thinking":
        if (msg.enabled !== undefined && typeof msg.enabled !== "boolean") {
          log.warn(`Invalid enabled flag in ${msgType}`)
          return false
        }
        break
      case "update_setting":
        if (!msg.key || typeof msg.key !== "string") {
          log.warn("Invalid key in update_setting")
          return false
        }
        break
      case "send_steer_prompt":
        if (!msg.text || typeof msg.text !== "string") {
          log.warn("Invalid text in send_steer_prompt")
          return false
        }
        if (msg.mode && !["interrupt", "append", "queue"].includes(msg.mode as string)) {
          log.warn("Invalid mode in send_steer_prompt")
          return false
        }
        break
      default:
        // No specific validation for other message types
        break
    }
    return true
  }

  private pushModelListToWebview(): void {
    this.opts.messageRouter.getModelList({
      postMessage: (m) => this.opts.statePush.postMessage(m),
      postRequestError: (m) => this.opts.statePush.postRequestError(m),
    })
  }

  private pushMcpServersToWebview(): void {
    this.opts.mcpServerManager.refresh()
    const servers = this.opts.mcpServerManager.getServers()
    this.opts.statePush.pushMcpServersToWebview(servers)
  }

  private pushVisibleStateToWebview(): void {
    this.opts.statePush.pushVisibleStateToWebview()
  }

  private async handleListCommands(): Promise<void> {
    const customCommands = this.opts.promptManager.getPromptCommands()
    if (!this.opts.sessionManager.isRunning) {
      this.opts.statePush.pushCommandListToWebview(customCommands)
      return
    }
    try {
      const commands = await this.opts.sessionManager.listCommands()
      this.opts.statePush.pushCommandListToWebview([...customCommands, ...commands])
    } catch (err) {
      log.warn("Failed to list commands", err)
      this.opts.statePush.pushCommandListToWebview(customCommands)
    }
  }

  private async resolveAllSkills(): Promise<Array<{ id: string; name: string; description: string; category: string; enabled: boolean }>> {
    const seen = new Set<string>()
    const skills: Array<{ id: string; name: string; description: string; category: string; enabled: boolean }> = []

    // API agents (server-managed, only when server is up)
    if (this.opts.sessionManager.isRunning) {
      try {
        const directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        const agents = await this.opts.sessionManager.listAgents(directory)
        for (const a of agents) {
          if (seen.has(a.name)) continue
          seen.add(a.name)
          skills.push({ id: a.name, name: a.name, description: a.description || "", category: a.builtIn ? "built-in" : "custom", enabled: true })
        }
      } catch (err) {
        log.warn("Failed to list agents from server", err)
      }
    }

    // Local ~/.agents/skills — always available, independent of server
    try {
      const local = await this.opts.sessionManager.scanLocalSkills()
      for (const s of local) {
        if (seen.has(s.name)) continue
        seen.add(s.name)
        skills.push({ id: s.id, name: s.name, description: s.description, category: s.category, enabled: true })
      }
    } catch (err) {
      log.warn("Failed to scan local skills", err)
    }

    return skills
  }
}
