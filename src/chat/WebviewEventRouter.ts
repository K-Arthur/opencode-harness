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
          await this.opts.streamCoordinator.startPrompt(sessionId, msg.text as string || "[image]", {
            postMessage: (m) => this.opts.postMessage(m),
            postRequestError: (m) => this.opts.postRequestError(m),
          }, variant)
          const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
          const attachments = Array.isArray(msg.attachments) ? msg.attachments as Array<{ data: string; mimeType: string }> : []
          const textBlocks: Block[] = msg.text ? [{ type: "text", text: msg.text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId }
          this.opts.sessionStore.appendMessage(sessionId, userMsg)
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
        if (Number.isFinite(cost)) { this.opts.sessionStore.updateCost(sessionId, cost); this.opts.postMessage({ type: "cost_update", sessionId, cost }) }
      }
    }],
    ["rename_session", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && msg.name) { const ok = this.opts.sessionStore.rename(sessionId, msg.name as string); if (ok) this.opts.postMessage({ type: "session_renamed", sessionId, name: msg.name }) }
    }],
    ["webview_ready", async () => {
      this.webviewReady = true
      this.opts.statePush.pushAllStateToWebview()
      for (const q of this.earlyMessageQueue) this.opts.postMessage(q)
      this.earlyMessageQueue = []
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
    ["attach_image", (msg: Record<string, unknown>, sessionId?: string) => { if (sessionId && msg.data && msg.mimeType) this.opts.sessionLifecycle.handleAttachImage(sessionId, msg.data as string, msg.mimeType as string) }],
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
      const report = this.opts.usageAnalytics.generateReport(days)
      
      this.opts.postMessage({
        type: "context_suggestions_response",
        patterns: report.patterns,
        suggestions: report.suggestions,
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
    ["open_file", (msg: Record<string, unknown>) => {
      const filePath = msg.path as string | undefined
      if (!filePath) return
      
      vscode.workspace.openTextDocument(filePath).then(
        (doc) => vscode.window.showTextDocument(doc),
        (err) => {
          log.error(`Failed to open file: ${filePath}`, err)
          this.opts.showErrorMessage(`Failed to open file: ${(err as Error).message}`)
        }
      )
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
      // Forward to webview to handle queue addition
      this.opts.postMessage({
        type: "add_to_queue",
        sessionId,
        text: msg.text as string || "",
        attachments: msg.attachments as Array<{ data: string; mimeType: string }> || [],
        isSteerPrompt: msg.isSteerPrompt as boolean || false,
      })
    }],
    ["send_steer_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      try {
        const steerPrompt = {
          id: `steer-${crypto.randomUUID()}`,
          text: msg.text as string || "",
          attachments: Array.isArray(msg.attachments) ? msg.attachments as Array<{ data: string; mimeType: string }> : [],
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

  /** H3: Queue of messages buffered before webview was ready */
  earlyMessageQueue: Record<string, unknown>[] = []

  pendingOpenSessionId?: string

  constructor(private opts: WebviewEventRouterOptions) {}

  async route(msg: Record<string, unknown>): Promise<void> {
    if (!msg || typeof msg.type !== "string") return

    const sessionId = msg.sessionId as string | undefined
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100)) return

    if (!WebviewEventRouter.VALID_WEBVIEW_TYPES.has(msg.type)) {
      log.warn(`Unknown webview message type: ${msg.type}`)
      return
    }

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
    if (msg.type === "update_theme_config" && !this.opts.themeController.isValidThemeConfigPayload(msg.theme)) {
      log.warn("Rejected invalid theme config payload")
      return
    }

    const handler = this.webviewHandlers.get(msg.type)
    if (handler) {
      await handler(msg, sessionId)
    }
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
