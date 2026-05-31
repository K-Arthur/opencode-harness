import * as vscode from "vscode"
import * as path from "path"
import type { TabManager } from "./TabManager"
import type { StatePushService } from "./StatePushService"
import type { SessionLifecycleService } from "./SessionLifecycleService"
import type { CommandExecutionService } from "./CommandExecutionService"
import type { SessionStore } from "../session/SessionStore"
import type { SessionManager } from "../session/SessionManager"
import type { DiffLine } from "./webview/types"
import { sdkFileContentToDiffLines, type SdkFileContentLike } from "./diff/sdkFileContentToDiffLines"
import type { ModelManager } from "../model/ModelManager"
import type { DiffApplier } from "../diff/DiffApplier"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { MessageRouter } from "./handlers/MessageRouter"
import type { AutoCompactor } from "./AutoCompactor"
import type { CheckpointManager } from "../checkpoint/CheckpointManager"
import type { McpServerManager } from "../mcp/McpServerManager"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import type { ThemeManager } from "../theme/ThemeManager"
import type { ThemeController } from "./ThemeController"
import type { PromptManager } from "../prompts/PromptManager"
import type { ChatFileOps } from "./ChatFileOps"
import type { SteerPromptHandler } from "./handlers/SteerPromptHandler"
import type { ChatMessage, Block } from "./types"
import type { ContextMonitor } from "../monitor/ContextMonitor"
import type { UsageAnalytics } from "../monitor/UsageAnalytics"
import type { SkillPreferencesStoreLike } from "../skills/SkillPreferencesStore"
import { log } from "../utils/outputChannel"
import { handleWebviewError } from "./utils/errorHandler"
import { validateWebviewMessage } from "./WebviewMessageValidator"
import { normalizeSessionMode, resolvePlanPermission } from "./modePolicy"
import { normalizeTodoList } from "../session/eventHandlers/TodoUpdatedHandler"

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
  setAutoModeConfirmed?: (value: boolean) => Promise<void> | void
  showAutoModeConfirmation: (sessionId: string) => Promise<boolean>
  replayLiveStreamsToWebview: () => void
  exportChat: () => void
  exportChatJson: () => void
  exportChatText: () => void
  copyChat: () => void
  // Async handlers must declare Promise<void>; otherwise `await` in route() is a no-op and
  // any rejection becomes an unhandled rejection at runtime.
  stashPrompt: (name: string, content: string, isGlobal: boolean) => Promise<void> | void
  listStashes: () => void
  deleteStash: (id: string) => void
  addProvider: (name: string, apiKey: string, baseUrl?: string) => Promise<void> | void
  listProviders: () => void
  updateProvider: (id: string, updates: Record<string, unknown>) => Promise<void> | void
  deleteProvider: (id: string) => void
  showOpenFolderDialog: (dir: string) => void
  skillPreferences: SkillPreferencesStoreLike
}

export class WebviewEventRouter {
  private promptsInFlight = new Set<string>()
  private promptSafetyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private static readonly PROMPT_SAFETY_TIMEOUT_MS = 30_000

  /** H3: Timeout for webview_ready message to prevent unbounded queue growth */
  private readyTimeout?: ReturnType<typeof setTimeout>

  /** Tracks whether the webview has processed init_state and sent init_ack. */
  public webviewFullyInitialized = false

  private static readonly VALID_WEBVIEW_TYPES = new Set([
    "create_tab", "send_prompt", "change_mode", "set_model", "set_variant", "abort",
    "close_tab", "switch_tab", "accept_diff", "reject_diff",
    "accept_permission", "mention_search", "list_sessions", "resume_session",
    "new_session", "get_models", "update_cost", "webview_ready", "init_ack", "rename_session", "webview_log",
    "open_settings", "connect_provider", "open_mcp_settings", "open_mcp_config", "attach_files", "export_chat", "export_chat_json", "export_chat_text", "copy_chat", "stash_prompt", "list_stashes", "delete_stash", "add_provider", "list_providers", "update_provider", "delete_provider",
    "compact_session", "execute_command", "list_commands",
    "insert_at_cursor", "create_file_from_code", "compact_banner_action",
    "edit_message", "attach_image",
    "delete_session", "archive_session", "revert_message",
    "list_server_sessions", "delete_server_session", "resume_server_session",
    "add_mcp_server", "update_mcp_server", "remove_mcp_server", "toggle_mcp_server", "get_mcp_servers",
    "show_diff", "list_checkpoints", "restore_checkpoint",
    "preview_theme", "get_theme_config", "update_theme_config", "list_cli_themes",
    "request_more_messages", "refresh_session_messages", "stream_ack", "retry_stream", "request_state_sync",
    "set_instructions", "fork_session", "accept_hunk", "reject_hunk",
    "toggle_diff_wrap", "toggle_thinking", "revert_diff",
    "context_history_request", "context_cost_estimate", "context_suggestions_request",
    "send_steer_prompt", "add_to_queue",
    "get_todos",
    "get_skills", "toggle_skill", "search_skills",
    "get_changed_files", "get_file_diff", "open_file", "open_folder", "open_url",
    "get_subagent_activities", "cancel_subagent",
    "update_setting", "show_error", "get_context_usage", "record_stash_usage",
    "model_favorite", "model_toggle",
    "question_answer",
    "resume_stream", "decline_resume",
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
      const diffId = msg.diffId as string | undefined
      let filePath = msg.filePath as string | undefined
      let proposed = msg.proposedContent as string | undefined
      let title = msg.title as string | undefined

      if (diffId) {
        const diffHandler = this.opts.streamCoordinator.getDiffHandler()
        const edit = diffHandler.getPendingEdit(diffId) ?? diffHandler.getAcceptedEdit(diffId)
        if (edit) {
          filePath = edit.filePath
          proposed = edit.proposedContent
          title = title || `Review Changes: ${path.basename(filePath)}`
        }
      }

      if (filePath && proposed) {
        await this.opts.diffApplier.showSideBySideDiff(filePath, proposed, title)
      } else {
        log.warn("show_diff: could not resolve filePath and proposedContent", { diffId, filePath })
      }
    }],
    ["send_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && this.hasPromptContent(msg)) {
        if (this.promptsInFlight.has(sessionId)) {
          log.warn(`send_prompt dropped: prompt already in flight for ${sessionId}`)
          return
        }
        this.promptsInFlight.add(sessionId)
        const safetyTimer = setTimeout(() => {
          if (this.promptsInFlight.has(sessionId)) {
            log.warn(`promptsInFlight safety timeout for ${sessionId} — clearing stale entry`)
            this.promptsInFlight.delete(sessionId)
          }
          this.promptSafetyTimers.delete(sessionId)
        }, WebviewEventRouter.PROMPT_SAFETY_TIMEOUT_MS)
        this.promptSafetyTimers.set(sessionId, safetyTimer)
        try {
          const text = this.getPromptText(msg)
          const model = (msg.model as string | undefined) || this.opts.modelManager.model
          if (!model) { throw new Error("No model selected. Please select a model and try again.") }
          const attachmentCount = Array.isArray(msg.attachments) ? msg.attachments.length : 0
          log.info(`send_prompt processing: sessionId=${sessionId}, textLength=${text.length}, attachments=${attachmentCount}, model=${model}`)
          this.opts.ensureLocalTab(sessionId, msg.name as string | undefined, model, msg.mode as string | undefined)
          const variant = typeof msg.variant === "string" ? msg.variant : undefined
          const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
          const validatedAttachments = this.validateAttachments(msg.attachments)
          if (validatedAttachments === null) {
            this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
            return
          }
          const attachments = validatedAttachments
          const textBlocks: Block[] = text.trim() ? [{ type: "text", text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId }
          this.opts.sessionStore.appendMessage(sessionId, userMsg)
          await this.opts.streamCoordinator.startPrompt(sessionId, text, {
            postMessage: (m) => this.opts.postMessage(m),
            postRequestError: (m) => this.opts.postRequestError(m),
          }, variant, attachments)
        } catch (err) {
          log.error("send_prompt failed", err)
          this.opts.postRequestError(err instanceof Error ? err.message : "Failed to send prompt")
        } finally {
          this.promptsInFlight.delete(sessionId)
          const timer = this.promptSafetyTimers.get(sessionId)
          if (timer) { clearTimeout(timer); this.promptSafetyTimers.delete(sessionId) }
        }
      } else {
        const textLength = typeof msg.text === "string" ? msg.text.length : "N/A"
        const attachmentCount = Array.isArray(msg.attachments) ? msg.attachments.length : 0
        log.warn(`send_prompt dropped: sessionId=${sessionId ?? "undefined"}, hasContent=${this.hasPromptContent(msg)}, textType=${typeof msg.text}, textLength=${textLength}, attachments=${attachmentCount}`)
      }
    }],
    ["question_answer", async (msg: Record<string, unknown>, sessionId?: string) => {
      // The user just answered a `question` tool call from opencode. Forward
      // the answer as a follow-up user prompt — opencode receives it in
      // context, resolves the pending tool, and continues the stream. This
      // reuses send_prompt's in-flight guard so a double-submit can't fire
      // twice and clobber the stream.
      if (!sessionId) {
        log.warn("question_answer dropped: missing sessionId")
        return
      }
      const value = typeof msg.value === "string" ? msg.value.trim() : ""
      if (!value) {
        log.warn(`question_answer dropped: empty value (sessionId=${sessionId})`)
        return
      }
      const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : undefined
      const source = typeof msg.source === "string" ? msg.source : "unknown"
      log.info(`question_answer: sessionId=${sessionId}, toolCallId=${toolCallId ?? "N/A"}, source=${source}, len=${value.length}`)

      if (this.promptsInFlight.has(sessionId)) {
        log.warn(`question_answer dropped: prompt already in flight for ${sessionId}`)
        return
      }
      this.promptsInFlight.add(sessionId)
      try {
        const model = this.opts.modelManager.model
        if (!model) throw new Error("No model selected. Please select a model and try again.")
        this.opts.ensureLocalTab(sessionId)
        const userMessageId = (msg.messageId as string) || `user-${crypto.randomUUID()}`
        const userMsg: ChatMessage = {
          role: "user",
          id: userMessageId,
          blocks: [{ type: "text", text: value, toolCallId }],
          timestamp: Date.now(),
          sessionId,
        }
        this.opts.sessionStore.appendMessage(sessionId, userMsg)
        await this.opts.streamCoordinator.startPrompt(sessionId, value, {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m),
          toolCallId,
        })
      } catch (err) {
        log.error("question_answer failed", err)
        this.opts.postRequestError(err instanceof Error ? err.message : "Failed to send answer")
      } finally {
        this.promptsInFlight.delete(sessionId)
      }
    }],
    ["change_mode", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        const previousMode = normalizeSessionMode(
          this.opts.tabManager.getTab(sessionId)?.mode ?? this.opts.sessionStore.get(sessionId)?.mode
        ) ?? "build"
        const mode = normalizeSessionMode(msg.mode)
        if (!mode) {
          this.opts.postMessage({ type: "mode_change_result", accepted: false, sessionId, mode: previousMode, reason: "invalid_mode" })
          return
        }
        if (mode === "auto" && !this.opts.hasAutoModeConfirmed()) {
          const confirmed = await this.opts.showAutoModeConfirmation(sessionId)
          if (!confirmed) {
            this.opts.postMessage({ type: "mode_change_result", accepted: false, sessionId, mode: previousMode, reason: "cancelled" })
            return
          }
        }
        this.opts.ensureLocalTab(sessionId)
        if (!this.opts.tabManager.setMode(sessionId, mode)) {
          this.opts.postMessage({ type: "mode_change_result", accepted: false, sessionId, mode: previousMode, reason: "tab_not_found" })
          return
        }
        this.opts.sessionStore.updateMode(sessionId, mode)
        this.opts.postMessage({ type: "mode_change_result", accepted: true, sessionId, mode })
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
    ["resume_stream", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        this.opts.tabManager.clearRestorationState(sessionId)
        void this.opts.streamCoordinator.retryFromHere(sessionId, {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m),
        }).catch(err => log.error("Resume stream failed", err))
      }
    }],
    ["decline_resume", (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        this.opts.tabManager.clearRestorationState(sessionId)
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
    ["accept_permission", async (msg: Record<string, unknown>) => {
      const sessionId = msg.sessionId as string
      if (this.isPlanModeSession(sessionId) && this.shouldRejectPlanPermissionResponse(msg)) {
        log.warn(`Rejected permission ${msg.permissionId as string} because session ${sessionId} is in plan mode`)
        await this.opts.messageRouter.handleAcceptPermission(sessionId, msg.permissionId as string, "reject")
        this.opts.postMessage({ type: "permission_rejected", sessionId, permissionId: msg.permissionId, reason: "plan_mode" })
        return
      }
      await this.opts.messageRouter.handleAcceptPermission(sessionId, msg.permissionId as string, msg.response as string)
    }],
    ["mention_search", async (msg: Record<string, unknown>) => { await this.opts.messageRouter.handleMentionSearch(msg.query as string || "", { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }) }],
    ["list_sessions", async (msg: Record<string, unknown>) => { await this.opts.messageRouter.handleListSessions(this.opts.sessionStore, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }, typeof msg.query === "string" ? msg.query : "") }],
    ["resume_session", async (msg: Record<string, unknown>) => { if (msg.sessionId) await this.opts.sessionLifecycle.handleResumeSession(msg.sessionId as string) }],
    ["new_session", async () => {
      const session = this.opts.sessionStore.create()
      const currentModel = this.opts.modelManager.model
      if (currentModel) {
        this.opts.sessionStore.updateModel(session.id, currentModel)
      }
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
    ["init_ack", () => {
      this.webviewFullyInitialized = true
    }],
    ["request_state_sync", () => {
      this.pushVisibleStateToWebview()
    }],
    ["stream_ack", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const seq = typeof msg.seq === "number" && Number.isFinite(msg.seq) ? msg.seq : undefined
      const lastRenderedChunkSeq = typeof msg.lastRenderedChunkSeq === "number" && Number.isFinite(msg.lastRenderedChunkSeq)
        ? msg.lastRenderedChunkSeq
        : undefined
      this.opts.streamCoordinator.handleStreamAck(sessionId, seq ?? 0, lastRenderedChunkSeq)
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
    ["list_server_sessions", async (msg: Record<string, unknown>) => {
      if (!this.opts.sessionManager.isRunning) {
        this.opts.postMessage({ type: "server_session_list", sessions: [] })
        return
      }
      try {
        const all = await this.opts.sessionManager.listSessions()
        const currentDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        const query = typeof msg.query === "string" ? msg.query.trim().toLowerCase() : ""
        const matchesServerSession = (s: { id?: string; title?: string; directory?: string }) => {
          if (!query) return true
          return [
            s.id,
            s.title,
            s.directory,
          ].some((value) => String(value || "").toLowerCase().includes(query))
        }
        this.opts.postMessage({
          type: "server_session_list",
          sessions: all
            .filter((s) => !s.parentID)
            .filter(matchesServerSession)
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
            createdAt: cp.createdAt,
            filesChanged: cp.filesChanged,
            action: cp.action,
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
        const checkpointId = msg.checkpointId as string
        const ok = await this.opts.checkpointManager.restore(checkpointId)
        this.opts.postMessage({ type: "checkpoint_restored", sessionId, checkpointId, ok })
      } catch (err) {
        log.error("Failed to restore checkpoint", err)
        this.opts.postMessage({ type: "checkpoint_restored", sessionId, checkpointId: msg.checkpointId, ok: false, error: (err as Error).message })
        this.opts.showErrorMessage(`Failed to restore checkpoint: ${(err as Error).message}`)
      }
    }],
    ["request_more_messages", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      const beforeIndex = typeof msg.beforeIndex === "number" ? msg.beforeIndex : session.messages.length
      const limit = typeof msg.limit === "number" ? msg.limit : 50
      const start = Math.max(0, beforeIndex - limit)
      const slice = session.messages.slice(start, beforeIndex)

      if (slice.length > 0 || start > 0) {
        this.opts.postMessage({
          type: "more_messages",
          sessionId,
          messages: slice,
          hasMore: start > 0,
          newBeforeIndex: start,
          totalCount: session.messages.length,
        })
        return
      }

      // Local exhausted — try server if available
      if (session.cliSessionId && this.opts.sessionManager.isRunning) {
        try {
          const rows = await this.opts.sessionManager.getSessionMessages(session.cliSessionId)
          const serverMessages = sdkMessagesToChatMessages(rows)
          if (serverMessages.length > session.messages.length) {
            this.opts.sessionStore.applyBackfilledMessages(session.id, serverMessages, summarizeOpencodeMessageUsage(rows))
            const refreshed = this.opts.sessionStore.get(sessionId)
            if (refreshed) {
              const newStart = Math.max(0, refreshed.messages.length - limit)
              this.opts.postMessage({
                type: "more_messages",
                sessionId,
                messages: refreshed.messages.slice(newStart),
                hasMore: newStart > 0,
                newBeforeIndex: newStart,
                totalCount: refreshed.messages.length,
              })
            }
            return
          }
        } catch (err) {
          log.warn(`Server fallback for request_more_messages failed for ${sessionId}`, err)
        }
      }

      this.opts.postMessage({
        type: "more_messages",
        sessionId,
        messages: [],
        hasMore: false,
        newBeforeIndex: 0,
        totalCount: session.messages.length,
      })
    }],
    ["refresh_session_messages", async (_msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      if (!session.cliSessionId || !this.opts.sessionManager.isRunning) {
        this.opts.postMessage({ type: "session_messages_refreshed", sessionId, messages: session.messages, totalCount: session.messages.length })
        return
      }
      try {
        const rows = await this.opts.sessionManager.getSessionMessages(session.cliSessionId)
        const messages = sdkMessagesToChatMessages(rows)
        if (messages.length > 0) {
          this.opts.sessionStore.applyBackfilledMessages(session.id, messages, summarizeOpencodeMessageUsage(rows))
          this.opts.sessionStore.autoTitleFromMessages(session.id)
        }
        const refreshed = this.opts.sessionStore.get(sessionId) || session
        this.opts.postMessage({ type: "session_messages_refreshed", sessionId, messages: refreshed.messages, totalCount: refreshed.messages.length })
      } catch (err) {
        log.warn(`refresh_session_messages failed for ${sessionId}`, err)
        this.opts.postMessage({ type: "session_messages_refreshed", sessionId, messages: session.messages, totalCount: session.messages.length })
      }
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
    ["update_setting", async (msg: Record<string, unknown>) => {
      const key = msg.key as string
      const value = msg.value
      if ((key === "skipModeWarning" || key === "autoModeConfirmed") && value === true) {
        await this.opts.setAutoModeConfirmed?.(true)
        this.opts.postMessage({ type: "display_pref_update", pref: key, value: true })
      }
    }],
    ["model_favorite", (msg: Record<string, unknown>) => {
      const modelId = msg.modelId as string
      this.opts.modelManager.toggleModelFavorite(modelId)
      this.pushModelListToWebview()
    }],
    ["model_toggle", (msg: Record<string, unknown>) => {
      const modelId = msg.modelId as string
      const enabled = msg.enabled as boolean
      this.opts.modelManager.setModelEnabled(modelId, enabled)
      this.pushModelListToWebview()
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
        // Find the accepted diff metadata and revert it.
        const edit = this.opts.streamCoordinator.getDiffHandler().getAcceptedEdit(diffId)
        if (!edit) {
          throw new Error("No accepted diff metadata is available for this edit")
        }
        const success = await this.opts.diffApplier.rollbackEdit(edit)

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
    ["get_context_usage", (msg: Record<string, unknown>, sessionId?: string) => {
      const requestedId = typeof msg.sessionId === "string" && msg.sessionId.length > 0 ? msg.sessionId : undefined
      const targetId = requestedId ?? sessionId ?? this.opts.sessionStore.activeId
      if (!targetId) return

      const usage = this.opts.contextMonitor.getCurrentUsage(targetId)
      if (usage) {
        this.opts.postMessage({ type: "context_usage", ...usage, sessionId: targetId })
        return
      }

      const maxTokens = this.opts.contextMonitor.limit
      if (maxTokens > 0) {
        this.opts.postMessage({ type: "context_usage", sessionId: targetId, percent: 0, tokens: 0, maxTokens })
      } else {
        this.opts.postMessage({
          type: "context_window_unknown",
          sessionId: targetId,
          modelId: this.opts.modelManager.model,
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
        const todos = normalizeTodoList(raw)
        this.opts.postMessage({ type: "todos_update", todos, sessionId })
      } catch (err) {
        log.error("Failed to fetch todos", err)
        this.opts.postMessage({ type: "todos_update", todos: [], sessionId })
      }
    }],
    ["get_changed_files", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      
      // Return stored diff stats alongside paths so the dropdown shows real change counts
      const stats = this.opts.sessionStore.getChangedFileStats(sessionId)
      const files = (session.changedFiles || []).map((path: string) => ({
        path,
        added: stats[path]?.added ?? 0,
        removed: stats[path]?.removed ?? 0,
      }))
      this.opts.postMessage({ type: "changed_files_update", files, sessionId })
    }],
    ["get_file_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      // Per-file diff for the changed-files dropdown's inline expansion. opencode
      // applies edits server-side, so we read the file (with its diff) from the
      // server and normalize it into DiffLine[] for the webview. Previously
      // unhandled — expansion silently showed nothing.
      const path = typeof msg.path === "string" ? msg.path : ""
      if (!path) return
      const respond = (lines: DiffLine[] | null, error?: string) =>
        this.opts.postMessage({ type: "file_diff_response", sessionId, path, lines, error })
      if (!this.opts.sessionManager.isRunning) {
        respond(null, "opencode server is not running")
        return
      }
      try {
        const content = await this.opts.sessionManager.getFileContent(path)
        respond(sdkFileContentToDiffLines(content as SdkFileContentLike))
      } catch (err) {
        log.warn(`get_file_diff failed for ${path}`, err)
        respond(null, err instanceof Error ? err.message : "Failed to load diff")
      }
    }],
    ["open_file", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawPath = msg.path as string | undefined
      if (!rawPath) return

      try {
        const { uri, lineNumber } = await this.resolveOpenFileTarget(rawPath, sessionId)
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
    ["open_folder", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawDir = msg.dir as string | undefined
      if (!rawDir) return
      try {
        const uri = vscode.Uri.file(rawDir)
        await vscode.commands.executeCommand("vscode.openFolder", uri)
      } catch (err) {
        log.error(`Failed to open folder: ${rawDir}`, err)
      }
    }],
    ["open_url", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawUrl = msg.url as string | undefined
      if (!rawUrl) return
      try {
        const uri = vscode.Uri.parse(rawUrl)
        await this.opts.openExternal(uri)
      } catch (err) {
        log.error(`Failed to open URL: ${rawUrl}`, err)
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
    ["toggle_skill", (msg: Record<string, unknown>) => {
      // Persist the user's enable/disable preference locally. The opencode
      // server doesn't accept agent enable/disable, so we surface this only
      // to our own pipeline (SkillTriggerEngine ↦ methodology addendum) and
      // to the modal's render state.
      const skillId = typeof msg.skillId === "string" ? msg.skillId : ""
      const enabled = msg.enabled === true
      if (!skillId) return
      this.opts.skillPreferences.setEnabled(skillId, enabled)
      // Re-emit the list so the modal reflects the new state immediately.
      void this.resolveAllSkills()
        .then((skills) => this.opts.postMessage({ type: "skills_list", skills }))
        .catch(() => { /* best effort */ })
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
      const activities: unknown[] = []
      this.opts.postMessage({ type: "subagent_activities", activities, sessionId })
    }],
    ["cancel_subagent", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const subagentId = msg.subagentId as string | undefined
      if (!subagentId) return
      log.info(`Cancel subagent ${subagentId} in session ${sessionId}`)
      this.opts.postMessage({
        type: "webview_request_error",
        requestType: "cancel_subagent",
        sessionId,
        error: "Subagent cancellation is not available for the current OpenCode server.",
      })
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
        const text = this.getPromptText(msg)
        const steerPrompt = {
          id: `steer-${crypto.randomUUID()}`,
          text,
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
  private static readonly MAX_QUEUE_SIZE = 200
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

  private getPromptText(msg: Record<string, unknown>): string {
    return typeof msg.text === "string" ? msg.text : ""
  }

  private hasPromptContent(msg: Record<string, unknown>): boolean {
    const text = this.getPromptText(msg)
    const hasText = text.trim().length > 0
    const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0
    return hasText || hasAttachments
  }

  async route(msg: Record<string, unknown>): Promise<void> {
    if (!msg || typeof msg.type !== "string") return

    const sessionId = msg.sessionId as string | undefined
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100)) {
      log.warn(`route: rejected invalid sessionId (type=${typeof sessionId}, len=${typeof sessionId === "string" ? sessionId.length : "N/A"}, msgType=${msg.type})`)
      return
    }

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
    return validateWebviewMessage(msg, msgType, {
      hasPromptContent: (payload) => this.hasPromptContent(payload),
      isValidThemeConfigPayload: (theme) => this.opts.themeController.isValidThemeConfigPayload(theme),
      warn: (message) => log.warn(message),
    })
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

  private isPlanModeSession(sessionId: string | undefined): boolean {
    if (!sessionId) return false
    return this.opts.tabManager.getTab(sessionId)?.mode === "plan" ||
      this.opts.sessionStore.get(sessionId)?.mode === "plan"
  }

  private shouldRejectPlanPermissionResponse(msg: Record<string, unknown>): boolean {
    const permissionType = typeof msg.permissionType === "string" ? msg.permissionType : undefined
    const pattern = typeof msg.pattern === "string" || Array.isArray(msg.pattern) ? msg.pattern : undefined
    return resolvePlanPermission({ type: permissionType, pattern }) === "reject"
  }

  private async resolveOpenFileTarget(rawPath: string, sessionId?: string): Promise<{ uri: vscode.Uri; lineNumber?: number }> {
    const parsed = this.parseOpenFileTarget(rawPath)
    const roots = this.getOpenFileRoots(sessionId)
    const filePath = this.expandHomePath(parsed.filePath)

    if (path.isAbsolute(filePath)) {
      const absolutePath = path.resolve(filePath)
      if (roots.length > 0 && !roots.some(root => this.isPathInsideRoot(absolutePath, root))) {
        throw new Error(`Refusing to open "${rawPath}" because it is outside the session workspace`)
      }
      const uri = vscode.Uri.file(absolutePath)
      await this.assertOpenableFile(uri, rawPath)
      return { uri, lineNumber: parsed.lineNumber }
    }

    if (roots.length === 0) {
      throw new Error(`Cannot open relative file "${rawPath}": no session workspace or VS Code workspace folder is available`)
    }

    const candidates = roots
      .map(root => path.resolve(root, filePath))
      .filter(candidate => roots.some(root => this.isPathInsideRoot(candidate, root)))

    for (const candidate of candidates) {
      const uri = vscode.Uri.file(candidate)
      if (await this.isOpenableFile(uri)) {
        return { uri, lineNumber: parsed.lineNumber }
      }
    }

    throw new Error(`File "${parsed.filePath}" was not found under the session workspace or open workspace folders`)
  }

  private parseOpenFileTarget(rawPath: string): { filePath: string; lineNumber?: number } {
    const fragmentIdx = rawPath.indexOf("#")
    if (fragmentIdx < 0) return { filePath: rawPath }

    const fragment = rawPath.slice(fragmentIdx + 1)
    const lineMatch = fragment.match(/^L(\d+)/i)
    const lineNumber = lineMatch ? Number.parseInt(lineMatch[1] ?? "0", 10) : undefined
    return {
      filePath: rawPath.slice(0, fragmentIdx),
      lineNumber: lineNumber && lineNumber > 0 ? lineNumber : undefined,
    }
  }

  private expandHomePath(filePath: string): string {
    if (!filePath.startsWith("~/") && filePath !== "~") return filePath
    const home = process.env.HOME ?? process.env.USERPROFILE
    if (!home) return filePath
    return path.join(home, filePath.replace(/^~\/?/, ""))
  }

  private getOpenFileRoots(sessionId?: string): string[] {
    const roots: string[] = []
    const sessionWorkspace = sessionId ? this.opts.sessionStore.get(sessionId)?.workspacePath : undefined
    if (sessionWorkspace) roots.push(sessionWorkspace)
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri.fsPath)
    }

    const seen = new Set<string>()
    return roots
      .filter(Boolean)
      .map(root => path.resolve(root))
      .filter(root => {
        const key = this.normalizeFsPath(root)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  private isPathInsideRoot(filePath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, filePath)
    return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  }

  private normalizeFsPath(filePath: string): string {
    const resolved = path.resolve(filePath)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }

  private async assertOpenableFile(uri: vscode.Uri, displayPath: string): Promise<void> {
    if (await this.isOpenableFile(uri)) return
    throw new Error(`File "${displayPath}" does not exist or is not a file`)
  }

  private async isOpenableFile(uri: vscode.Uri): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      return (stat.type & vscode.FileType.Directory) === 0
    } catch {
      return false
    }
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
    const prefs = this.opts.skillPreferences

    // API agents (server-managed, only when server is up)
    if (this.opts.sessionManager.isRunning) {
      try {
        const directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        const agents = await this.opts.sessionManager.listAgents(directory)
        for (const a of agents) {
          if (seen.has(a.name)) continue
          seen.add(a.name)
          skills.push({ id: a.name, name: a.name, description: a.description || "", category: a.builtIn ? "built-in" : "custom", enabled: prefs.isEnabled(a.name) })
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
        skills.push({ id: s.id, name: s.name, description: s.description, category: s.category, enabled: prefs.isEnabled(s.id) })
      }
    } catch (err) {
      log.warn("Failed to scan local skills", err)
    }

    return skills
  }
}
