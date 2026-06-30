import * as vscode from "vscode"
import * as path from "path"
import { execSync } from "node:child_process"
import { realpathSync } from "node:fs"
import type { TabManager } from "./TabManager"
import type { StatePushService } from "./StatePushService"
import type { SessionLifecycleService } from "./SessionLifecycleService"
import type { CommandExecutionService } from "./CommandExecutionService"
import type { SessionStore } from "../session/SessionStore"
import type { SessionManager } from "../session/SessionManager"
import type { DiffLine } from "./webview/types"
import { sdkFileContentToDiffLines, type SdkFileContentLike } from "./diff/sdkFileContentToDiffLines"
import { getFileHunks, planHunkRevert, type FileHunkSummary } from "./diff/hunkRevertPlan"
import { getBaselineContent } from "./SessionBaselineResolver"
import type { ModelManager } from "../model/ModelManager"
import type { DiffApplier } from "../diff/DiffApplier"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { MessageRouter } from "./handlers/MessageRouter"
import type { AutoCompactor } from "./AutoCompactor"
import type { CheckpointManager } from "../checkpoint/CheckpointManager"
import type { McpServerManager } from "../mcp/McpServerManager"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { generateUserMessageId } from "../session/messageId"
import type { ThemeManager } from "../theme/ThemeManager"
import type { ThemeController } from "./ThemeController"
import type { PromptManager } from "../prompts/PromptManager"
import type { ChatFileOps } from "./ChatFileOps"
import type { WorkspaceFileIndex } from "./WorkspaceFileIndex"
import type { ActiveFileTracker } from "./ActiveFileTracker"
import type { SteerPromptHandler } from "./handlers/SteerPromptHandler"
import type { HostPromptQueue } from "./HostPromptQueue"
import type { ChatMessage, Block } from "./types"
import type { ContextMonitor } from "../monitor/ContextMonitor"
import type { UsageAnalytics } from "../monitor/UsageAnalytics"
import { groupMessagesIntoTurns } from "./webview/turnGrouper"
import type { SkillPreferencesStoreLike } from "../skills/SkillPreferencesStore"
import type { VoiceInputService } from "./VoiceInputService"
import { log } from "../utils/outputChannel"
import { PtyRouter } from "./routers/PtyRouter"
import { computeMessageCounts } from "./webview/messageCounter"
import { rankByFuzzy } from "./webview/fuzzyMatch"
import { handleWebviewError } from "./utils/errorHandler"
import { validateWebviewMessage } from "./WebviewMessageValidator"
import { normalizeSessionMode, resolvePlanPermission } from "./modePolicy"
import { normalizeTodoList } from "../session/eventHandlers/TodoUpdatedHandler"
import { categorizeQuestionReplyError } from "./QuestionExpiryDetector"
import { isLocalPlaceholderSessionId } from "../session/sessionUtils"

const crypto = globalThis.crypto

type ChildSessionLike = {
  id?: unknown
  parentID?: unknown
  title?: unknown
  summary?: unknown
  time?: unknown
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function findAuthorizedSubagentChild(
  children: unknown[],
  parentSessionId: string,
  subagentId: string,
): ChildSessionLike | undefined {
  for (const raw of children) {
    if (!raw || typeof raw !== "object") continue
    const child = raw as ChildSessionLike
    if (asNonEmptyString(child.id) !== subagentId) continue
    const childParentId = asNonEmptyString(child.parentID)
    if (childParentId && childParentId !== parentSessionId) continue
    return child
  }
  return undefined
}

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
  workspaceFileIndex: WorkspaceFileIndex
  activeFileTracker?: ActiveFileTracker
  contextMonitor: ContextMonitor
  usageAnalytics: UsageAnalytics
  steerPromptHandler: SteerPromptHandler
  hostQueue: HostPromptQueue
  voiceInputService: VoiceInputService
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
  replayLiveStreamsToWebview: () => void
  clearReplayDedup: () => void
  exportChat: () => void
  exportChatJson: () => void
  exportChatText: () => void
  copyChat: () => void
  // Async handlers must declare Promise<void>; otherwise `await` in route() is a no-op and
  // any rejection becomes an unhandled rejection at runtime.
  stashPrompt: (name: string, content: string, isGlobal: boolean) => Promise<void> | void
  listStashes: () => void
  deleteStash: (id: string) => void
  saveTemplate: (name: string, content: string, tags: string[], existingId?: string) => Promise<void> | void
  listTemplates: () => void
  deleteTemplate: (id: string) => void
  addProvider: (name: string, apiKey: string, baseUrl?: string) => Promise<void> | void
  listProviders: () => void
  updateProvider: (id: string, updates: Record<string, unknown>) => Promise<void> | void
  deleteProvider: (id: string) => void
  discoverProviders: () => Promise<void> | void
  getProviderAuthMethods: (providerId: string) => Promise<void> | void
  connectProviderKey: (providerId: string, key: string, label?: string) => Promise<void> | void
  connectProviderOAuth: (providerId: string, methodIndex?: number) => Promise<void> | void
  completeProviderOAuth: (providerId: string, code?: string, methodIndex?: number) => Promise<void> | void
  listProviderCredentials: () => Promise<void> | void
  removeProviderCredential: (credentialId: string) => Promise<void> | void
  showOpenFolderDialog: (dir: string) => void
  skillPreferences: SkillPreferencesStoreLike
  pushAllStateToWebview: () => void
  pushVisibleStateToWebview: () => void
  /**
   * Opens a new VS Code editor webview panel dedicated to a single subagent
   * detail. The host passes a popout session id and the subagent id; the
   * new panel will auto-request the subagent detail via the same path as
   * the inline `get_subagent_detail` message. Returns the popout session id
   * (a string the host may use to track the panel), or undefined if the
   * host declined (e.g. panel creation was rejected by VS Code).
   */
  applySessionMode: (sessionId: string, mode: string) => boolean
  handlePlanCompletePreference: (sessionId: string, targetMode: string, persist: boolean) => void
  openSubagentDetailPanel: (parentSessionId: string, subagentId: string) => string | undefined
  /**
   * Called after the host fetches subagent detail data (from
   * get_subagent_detail). Gives the ChatProvider a chance to forward the
   * detail to any open popout panels before (or in addition to) posting to
   * the main webview. Returns true if any popout consumed the message.
   */
  postSubagentDetailToPopouts: (detail: Record<string, unknown>, subagentId: string) => boolean
  /**
   * Persist panel visibility state to workspaceState so it survives
   * webview reloads. Called when the user toggles a panel open/closed.
   */
  persistPanelVisibilityState?: (panels: Record<string, boolean>) => void
  /**
   * Push the stored panel visibility state from host to webview.
   * Called during pushVisibleStateToWebview (on init/reconnect).
   */
  pushPanelVisibilityStateToWebview?: () => void
  /**
   * Persist the chat text direction (ltr/rtl) to extension globalState so
   * it survives VS Code restarts. Called when the user toggles direction.
   */
  persistChatDirection?: (direction: "ltr" | "rtl") => void
}

export class WebviewEventRouter {
  private promptsInFlight = new Set<string>()
  private promptSafetyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private static readonly PROMPT_SAFETY_TIMEOUT_MS = 30_000

  readonly ptyRouter: PtyRouter

  /** H3: Timeout for webview_ready message to prevent unbounded queue growth */
  private readyTimeout?: ReturnType<typeof setTimeout>

  /** Tracks whether the webview has processed init_state and sent init_ack. */
  public webviewFullyInitialized = false

  private static readonly VALID_WEBVIEW_TYPES = new Set([
    "create_tab", "send_prompt", "change_mode", "set_model", "set_variant", "abort", "cancel_tool",
    "close_tab", "switch_tab", "accept_diff", "reject_diff",
    "accept_permission", "mention_search", "list_sessions", "resume_session",
    "new_session", "get_models", "update_cost", "webview_ready", "init_ack", "rename_session", "webview_log",
    "open_settings", "connect_provider", "open_mcp_settings", "open_mcp_config", "attach_files", "export_chat", "export_chat_json", "export_chat_text", "copy_chat", "stash_prompt", "list_stashes", "delete_stash",     "add_provider", "list_providers", "update_provider", "delete_provider",
    // Prompt templates + changed-file reverts: handlers exist for all of these,
    // but they were absent from this gate, so the messages were rejected before
    // dispatch. `undo_file` is a live dead wire (the changed-files dropdown's
    // "undo file" button); the others have handlers + declared types and must be
    // reachable. The dead-wire guard test enforces handler⊆allowlist.
    "save_template", "list_templates", "delete_template", "save_message_as_template",
    "undo_file", "revert_all_files", "accept_file_changes", "reject_file_changes",
    "discover_providers", "get_provider_auth_methods", "connect_provider_key",
    "connect_provider_oauth", "complete_provider_oauth", "list_provider_credentials",
    "remove_provider_credential",
    "compact_session", "execute_command", "open_terminal", "copy_text", "list_commands",
    "get_workspace_files",
    "log_ambiguity",
    "toggle_active_file",
    "insert_at_cursor", "create_file_from_code", "compact_banner_action",
    "edit_message", "attach_image",
    "delete_session", "archive_session", "unarchive_session", "pin_session", "set_session_tags", "revert_message", "unrevert",
    "list_server_sessions", "delete_server_session", "resume_server_session",
    "add_mcp_server", "update_mcp_server", "remove_mcp_server", "toggle_mcp_server", "get_mcp_servers",
    "show_diff", "list_checkpoints", "restore_checkpoint", "list_restore_points", "restore_point",
    "preview_theme", "get_theme_config", "update_theme_config", "list_cli_themes", "update_switch_workbench_theme",
    "request_more_messages", "refresh_session_messages", "stream_ack", "retry_stream", "request_state_sync",
    "set_instructions", "fork_session", "accept_hunk", "reject_hunk", "open_model_selector", "open_model_selector_for_regen", "regenerate_with_model",
    "get_file_hunks", "revert_hunk",
    "toggle_diff_wrap", "toggle_thinking", "revert_diff", "open_changed_file_diff",
    "context_history_request", "context_cost_estimate", "context_suggestions_request",
    "send_steer_prompt",
    "probe_run_status",
    "panel_visibility_state",
    "remove_from_queue", "edit_queue_item", "reorder_queue", "retry_queue_item", "send_queue_item",
    "request_queue_state", "resume_queue",
    "get_todos", // handler posts todos_error on unavailable server/session fetch failures
    "get_skills", "toggle_skill", "search_skills",
    // PTY terminal vertical (audit §14.1/§14.2): live terminal via the SDK PTY API.
    "pty_connect", "pty_cancel", "pty_send_input", "pty_resize", "pty_list",
    "get_changed_files", "get_file_diff", "open_file", "open_folder", "open_url", "reveal_in_explorer",
    "get_subagent_activities", "get_subagent_detail", "cancel_subagent", "mark_subagent_read", "open_subagent_session",
    "popout_get_subagent_detail", "popout_cancel_subagent",
    "show_error", "get_context_usage", "record_stash_usage", "open_context_window_override_dialog",
    "model_favorite", "model_toggle", "get_permission_config", "update_permission_config",
    "question_answer",
    "resume_stream", "decline_resume",
    "get_voice_settings", "setup_voice_input", "voice_start", "voice_stop", "voice_cancel",
    "mode_switch_request",
    "plan_complete_preference",
    "open_subagent_detail",
    "webview_error",
    "chat_dir_change",
  ])

  /**
   * Resolve a webview tab ID to the server-side CLI session ID.
   *
   * Several `sessionManager` methods (`replyToQuestion`, `rejectQuestion`,
   * `revertMessage`, `unrevert`, `respondToPermission`, etc.) require the
   * **server** session identifier, not the local tab ID.  Calling
   * `ensureSession` both creates the server session if it doesn't exist yet
   * and returns the canonical `cliSessionId`.  The tab and store are updated
   * so subsequent calls short-circuit.
   *
   * B10: Once a tab has a valid server-side session ID (not a local
   * placeholder), subsequent calls return it immediately without re-verifying
   * via an HTTP roundtrip to `sessionExists`. The session ID is stable, and
   * re-verifying on every `question_answer` was the source of unnecessary
   * HTTP calls that added latency without preventing `QuestionNotFoundError`
   * (the server's question registry can be empty even when the session exists).
   */
  private async resolveCliSessionId(tabId: string): Promise<string> {
    const tab = this.opts.tabManager.getTab(tabId)
    // B10: Short-circuit when the tab already has a real server session ID.
    // Local placeholder IDs (session-XXXXXXXX) still need resolution.
    const existingCliId = tab?.cliSessionId
    if (existingCliId && !isLocalPlaceholderSessionId(existingCliId)) {
      return existingCliId
    }
    const cliSessionId = await this.opts.sessionManager.ensureSession(existingCliId)
    if (tab) {
      this.opts.tabManager.setCliSessionId(tabId, cliSessionId)
      this.opts.sessionStore.updateCliSessionId(tabId, cliSessionId)
    }
    return cliSessionId
  }

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
    ["get_voice_settings", () => {
      this.opts.voiceInputService.postSettings()
    }],
    ["setup_voice_input", async () => {
      await vscode.commands.executeCommand("opencode-harness.setupVoiceInput")
    }],
    ["voice_start", async (msg: Record<string, unknown>) => {
      await this.opts.voiceInputService.start(msg.requestId)
    }],
    ["voice_stop", async (msg: Record<string, unknown>) => {
      await this.opts.voiceInputService.stop(msg.requestId)
    }],
    ["voice_cancel", (msg: Record<string, unknown>) => {
      this.opts.voiceInputService.cancel(msg.requestId)
    }],
    ["show_diff", async (msg: Record<string, unknown>, _sessionId?: string) => {
      // C1-a: This handler was previously gated on DiffHandler which has been
      // removed (the server applies edits directly). The direct filePath +
      // proposedContent path is kept for any future caller that passes them
      // directly (M7 new open_diff action will use a different message type).
      const filePath = msg.filePath as string | undefined
      const proposed = msg.proposedContent as string | undefined
      const title = (msg.title as string) || (filePath ? `Diff: ${path.basename(filePath)}` : "Diff")
      if (filePath && proposed) {
        await this.opts.diffApplier.showSideBySideDiff(filePath, proposed, title)
      } else {
        log.warn("show_diff: no filePath/proposedContent (expected for legacy callers that use show_diff as a generic message type without the old inline-diff fields)", { filePath })
      }
    }],
    ["send_prompt", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && this.hasPromptContent(msg)) {
        if (this.promptsInFlight.has(sessionId)) {
          // Queue at host layer instead of silently dropping.
          // Persist the user message to SessionStore immediately so it's not lost
          // even if the queue never drains (tab close, stream timeout, etc.).
          const text = this.getPromptText(msg)
          const validatedAttachments = this.validateAttachments(msg.attachments)
          if (validatedAttachments === null) {
            this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
            return
          }
          const userMessageId = (msg.messageId as string) || generateUserMessageId()
          const textBlocks: Block[] = text.trim() ? [{ type: "text", text }] : []
          const imageBlocks: Block[] = (validatedAttachments || []).map((a: { data: string; mimeType: string }) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }))
          const currentTabForMode = this.opts.tabManager.getTab(sessionId)
          const userMsg: ChatMessage = {
            role: "user",
            id: userMessageId,
            blocks: [...textBlocks, ...imageBlocks],
            timestamp: Date.now(),
            sessionId,
            mode: currentTabForMode?.mode,
          }
          this.opts.sessionStore.appendMessage(sessionId, userMsg)
          this.opts.postMessage({ type: "add_message", sessionId, message: userMsg })
          const id = this.opts.hostQueue.enqueue(sessionId, {
            text,
            sessionId,
            attachments: validatedAttachments,
            mode: "queue",
            isSteerPrompt: false,
            userMessageId,
          })
          if (id) {
            log.info(`send_prompt queued (in-flight): ${sessionId}, item=${id}`)
            this.opts.postMessage({ type: "prompt_queued", sessionId, itemId: id })
            this.postQueueState(sessionId)
          } else {
            this.opts.postRequestError("Queue is full. Please wait for the current response to complete.", sessionId)
          }
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
          const userMessageId = (msg.messageId as string) || generateUserMessageId()
          const clientRequestId = typeof msg.clientRequestId === "string" ? msg.clientRequestId : undefined
          const validatedAttachments = this.validateAttachments(msg.attachments)
          if (validatedAttachments === null) {
            this.opts.postMessage({ type: "prompt_rejected", sessionId, reason: "invalid_attachments" })
            return
          }
          const attachments = validatedAttachments
          const textBlocks: Block[] = text.trim() ? [{ type: "text", text }] : []
          const imageBlocks: Block[] = attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }))
          const currentTabForMode = this.opts.tabManager.getTab(sessionId)
          const userMsg: ChatMessage = { role: "user", id: userMessageId, blocks: [...textBlocks, ...imageBlocks], timestamp: Date.now(), sessionId, mode: currentTabForMode?.mode }
          this.opts.sessionStore.appendMessage(sessionId, userMsg)
          await this.opts.streamCoordinator.startPrompt({
            tabId: sessionId,
            text,
            callbacks: {
              postMessage: (m) => this.opts.postMessage(m),
              postRequestError: (m) => this.opts.postRequestError(m),
            },
            variant,
            attachments,
            identity: { userMessageId, clientRequestId },
          })
        } catch (err) {
          log.error("send_prompt failed", err)
          const text = typeof msg.text === "string" ? msg.text : ""
          const reason = err instanceof Error ? err.message : "Failed to send prompt"
          this.opts.postMessage({
            type: "prompt_send_failed",
            sessionId,
            messageId: typeof msg.messageId === "string" ? msg.messageId : undefined,
            clientRequestId: typeof msg.clientRequestId === "string" ? msg.clientRequestId : undefined,
            text,
            reason,
            attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
          })
          this.opts.postRequestError(reason, sessionId)
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
      const requestID = typeof msg.requestID === "string" ? msg.requestID : undefined
      const source = typeof msg.source === "string" ? msg.source : "unknown"
      log.info(`question_answer: sessionId=${sessionId}, toolCallId=${toolCallId ?? "N/A"}, requestID=${requestID ?? "N/A"}, source=${source}, len=${value.length}`)

      if (requestID) {
        // Resolve webview tab ID → server session ID (the SDK v2
        // question.reply/reject endpoints require the server-side session
        // identifier, not the local tab ID).
        const cliSessionId = await this.resolveCliSessionId(sessionId)
        // B10: For subagent (child session) questions, use the ORIGINAL
        // session ID that created the question — not the parent tab's
        // session. The server's question registry is scoped to the session
        // that called question.ask(); replying via the parent session's
        // endpoint looks in the wrong registry scope → NotFoundError.
        const originSessionId = typeof msg.originSessionId === "string" ? msg.originSessionId : undefined
        const replySessionId = originSessionId || cliSessionId
        if (originSessionId && originSessionId !== cliSessionId) {
          log.info(`question_answer: using originSessionId=${originSessionId} for reply (parent=${cliSessionId})`)
        }
        const userMessageId = (msg.messageId as string) || generateUserMessageId()
        const textForPrompt = source === "response" ? `The user responded: ${value}` : value
        const answerSource: "option" | "freetext" | "skip" | "response" =
          source === "freetext" || source === "skip" || source === "response" ? source : "option"
        const answerId = toolCallId ?? requestID
        const userMsg: ChatMessage = {
          role: "user",
          id: userMessageId,
          blocks: [{ type: "text", text: textForPrompt, toolCallId: answerId, requestID }],
          timestamp: Date.now(),
          sessionId,
        }
        // Optimistic state: record the user message and mark the question
        // answered BEFORE awaiting the SDK call. If the call throws, the
        // catch block rolls all of this back (B9).
        this.opts.sessionStore.appendMessage(sessionId, userMsg)
        this.opts.sessionStore.markQuestionAnswered(sessionId, answerId, textForPrompt, answerSource)
        this.opts.streamCoordinator.markQuestionAnswered(sessionId, answerId)
        // Flipped true only when the v2 reply/reject lands, so the happy-path
        // continuation below runs exclusively on success — the expired and
        // transient catch branches own their own resume / rollback.
        let resumeAfterReply = false
        try {
          if (source === "skip") {
            await this.opts.sessionManager.rejectQuestion(replySessionId, requestID)
          } else {
            // B-edge-1: prefer the per-group structured answers the webview
            // builds (string[][] — one inner array per question group, with
            // the selected labels in group order). Fall back to [[value]] for
            // older webview bundles that haven't been updated to send
            // structuredAnswers. The server can no longer map a flattened
            // "Header1: A\nHeader2: B" string back to individual groups.
            const structured = Array.isArray(msg.structuredAnswers)
              ? (msg.structuredAnswers as unknown as unknown[])
                  .filter((g): g is unknown[] => Array.isArray(g))
                  .map((g) => g.map((v) => (typeof v === "string" ? v : String(v ?? ""))).filter((v) => v.length > 0))
              : null
            const wireAnswers = structured && structured.length > 0 ? structured : [[value]]
            await this.opts.sessionManager.replyToQuestion(replySessionId, requestID, wireAnswers)
          }
          this.opts.postMessage({
            type: "question_acknowledged",
            sessionId,
            toolCallId: answerId,
            requestID,
          })
          resumeAfterReply = true
        } catch (err) {
          // B9/B10: the SDK call failed. Categorize the error to decide
          // whether to rollback (transient → user can retry) or remove
          // (expired → question is dead on the server, no point retrying).
          const classification = categorizeQuestionReplyError(err)
          log.error(
            `question_answer v2 failed (${classification.category}, retryable=${classification.retryable}) — ${classification.technicalDetail}`,
            err,
          )

          if (classification.category === "expired") {
            // B10: The server no longer knows about this question. The
            // optimistic markQuestionAnswered at L416-417 already handled
            // local state. Send the user's answer as a regular text prompt
            // so the model still gets the information — no retry needed.
            this.opts.postMessage({
              type: "question_unacknowledged",
              sessionId,
              toolCallId: answerId,
              requestID,
              error: classification.userFacingMessage,
              category: "expired",
              retryable: false,
            })
            // Send the answer as a text prompt so the model can continue.
            // B10-recovery: Wrap in try/finally so promptsInFlight is ALWAYS
            // released, even if startPrompt early-returns (tab not found,
            // server down, stream-slot rejected). Previously the
            // clearPromptsInFlight callback only fired deep inside
            // emitStreamStartAndArmWatchdogs, leaving promptsInFlight stuck
            // and silently dropping all future prompts in this tab — which
            // is what forced the user to close/reopen the tab.
            if (!this.promptsInFlight.has(sessionId)) {
              this.promptsInFlight.add(sessionId)
              try {
                await this.opts.streamCoordinator.startPrompt({
                  tabId: sessionId,
                  text: value,
                  callbacks: {
                    postMessage: (m) => this.opts.postMessage(m),
                    postRequestError: (m) => this.opts.postRequestError(m),
                    toolCallId: answerId,
                    clearPromptsInFlight: () => this.promptsInFlight.delete(sessionId),
                    // B10-recovery: arm the hard 15s unconditional watchdog
                    // so the user is never stuck "generating" indefinitely.
                    // The webview receives `expired_question_recovery_failed`
                    // with the answer text pre-filled if no response arrives.
                    recoveryFromExpiredQuestion: true,
                    expiredRecoveryAnswerText: value,
                  },
                })
              } catch (promptErr) {
                log.error("B10: failed to send expired question answer as prompt", promptErr)
                this.opts.postMessage({
                  type: "expired_question_recovery_failed",
                  sessionId,
                  answerText: value,
                  reason: promptErr instanceof Error ? promptErr.message : "send_failed",
                })
              } finally {
                // Defensive: clearPromptsInFlight may have already fired
                // inside emitStreamStartAndArmWatchdogs, but if startPrompt
                // early-returned (tab not found / server down / slot
                // rejected) the callback was never invoked. Always clear.
                this.promptsInFlight.delete(sessionId)
              }
            } else {
              log.warn(`expired question answer dropped: promptsInFlight already set for ${sessionId}; surfacing for manual resend`)
              this.opts.postMessage({
                type: "expired_question_recovery_failed",
                sessionId,
                answerText: value,
                reason: "prompt_in_flight",
              })
            }
          } else {
            // B9: Transient or unknown error — rollback optimistic state so
            // the user can retry.
            this.opts.sessionStore.unmarkQuestionAnswered(sessionId, answerId)
            this.opts.streamCoordinator.unmarkQuestionAnswered(sessionId, answerId)
            this.opts.postMessage({
              type: "question_unacknowledged",
              sessionId,
              toolCallId: answerId,
              requestID,
              error: classification.userFacingMessage,
              category: classification.category,
              retryable: classification.retryable,
            })
          }
          // B10: Only show the error banner for non-expired failures.
          // For expired questions, the answer was already sent as a text
          // prompt above — showing an error would confuse the user since
          // the model IS continuing with their answer.
          if (classification.category !== "expired") {
            this.opts.postRequestError(classification.userFacingMessage, sessionId)
          }
        }

        // Happy-path continuation. opencode's `question` tool ENDS the
        // assistant turn — the local stream finalizes the instant the answer
        // is recorded (streamCoordinator.markQuestionAnswered →
        // maybeFinalizeStream above). The v2 question.reply endpoint records
        // the answer server-side but does NOT start a new turn, so on its own
        // it leaves the user stranded on a finished stream, forced to type
        // "Continue" by hand (generation blocked). Forward the answer as a
        // follow-up prompt to resume generation — the documented design (ADR
        // 2026-06-05): answers are forwarded as prompts, which cleanly unblock
        // the agent. Reuses the per-session in-flight guard so a double-submit
        // can't fire two streams; `toolCallId` threads the continuation into
        // the same assistant bubble that already holds the question block
        // (StreamCoordinator H2a). Runs AFTER the reply try/catch so a resume
        // failure is never misclassified as a reply failure.
        if (resumeAfterReply) {
          if (this.promptsInFlight.has(sessionId)) {
            // Edge case: another prompt is already streaming for this session
            // (race, stuck flag, or user double-submit). Silently dropping
            // here would reproduce the exact "blocked after answering" bug
            // this fix targets. Surface the answer text via the same
            // recovery channel the expired path uses so the webview can
            // auto-forward it once the in-flight stream drains.
            log.warn(`question_answer resume skipped: prompt already in flight for ${sessionId}; surfacing for auto-resend`)
            this.opts.postMessage({
              type: "expired_question_recovery_failed",
              sessionId,
              answerText: value,
              reason: "resume_in_flight",
            })
          } else {
            this.promptsInFlight.add(sessionId)
            try {
              await this.opts.streamCoordinator.startPrompt({
                tabId: sessionId,
                text: value,
                callbacks: {
                  postMessage: (m) => this.opts.postMessage(m),
                  postRequestError: (m) => this.opts.postRequestError(m),
                  toolCallId: answerId,
                  clearPromptsInFlight: () => this.promptsInFlight.delete(sessionId),
                },
              })
            } catch (resumeErr) {
              // The v2 reply succeeded (server has the answer) but the
              // follow-up prompt that resumes generation threw — tab gone,
              // server down, slot rejected. Post the answer text via the
              // recovery channel so the webview auto-forwards it (no silent
              // loss, no manual "Continue"). Mirrors the expired-path catch.
              log.error("question_answer: failed to resume generation after reply", resumeErr)
              this.opts.postMessage({
                type: "expired_question_recovery_failed",
                sessionId,
                answerText: value,
                reason: resumeErr instanceof Error ? resumeErr.message : "resume_failed",
              })
            } finally {
              this.promptsInFlight.delete(sessionId)
            }
          }
        }
        return
      }

      if (this.promptsInFlight.has(sessionId)) {
        log.warn(`question_answer dropped: prompt already in flight for ${sessionId}`)
        return
      }
      this.promptsInFlight.add(sessionId)
      try {
        const model = this.opts.modelManager.model
        if (!model) throw new Error("No model selected. Please select a model and try again.")
        this.opts.ensureLocalTab(sessionId)
        const userMessageId = (msg.messageId as string) || generateUserMessageId()
        const textForPrompt = source === "response"
          ? `The user responded: ${value}`
          : value
        const userMsg: ChatMessage = {
          role: "user",
          id: userMessageId,
          blocks: [{ type: "text", text: textForPrompt, toolCallId }],
          timestamp: Date.now(),
          sessionId,
        }
        this.opts.sessionStore.appendMessage(sessionId, userMsg)
        if (toolCallId) {
          const answerSource: "option" | "freetext" | "skip" | "response" =
            source === "freetext" || source === "skip" || source === "response" ? source : "option"
          this.opts.sessionStore.markQuestionAnswered(sessionId, toolCallId, textForPrompt, answerSource)
          this.opts.streamCoordinator.markQuestionAnswered(sessionId, toolCallId)
        }
        await this.opts.streamCoordinator.startPrompt({
          tabId: sessionId,
          text: value,
          callbacks: {
            postMessage: (m) => this.opts.postMessage(m),
            postRequestError: (m) => this.opts.postRequestError(m),
            toolCallId,
            clearPromptsInFlight: () => this.promptsInFlight.delete(sessionId),
          },
        })
        this.opts.postMessage({
          type: "question_acknowledged",
          sessionId,
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
        const mode = normalizeSessionMode(msg.mode)
        if (!mode) {
          const previousMode = normalizeSessionMode(
            this.opts.tabManager.getTab(sessionId)?.mode ?? this.opts.sessionStore.get(sessionId)?.mode
          ) ?? "build"
          this.opts.postMessage({ type: "mode_change_result", accepted: false, sessionId, mode: previousMode, reason: "invalid_mode" })
          return
        }
        // Switching to Auto is treated as the user's consent (no confirmation
        // modal). See CHANGELOG: the native warning modal was removed as an
        // anti-pattern — it blocked the workbench on Linux and gated the switch.
        this.opts.ensureLocalTab(sessionId)
        this.opts.applySessionMode(sessionId, mode)
      }
    }],
    ["set_model", (msg: Record<string, unknown>, sessionId?: string) => {
      if (msg.model) {
        const modelId = msg.model as string
        this.opts.modelManager.setModel(modelId)
        this.opts.modelManager.touchRecentModel(modelId)
      }
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
    ["mode_switch_request", async (msg: Record<string, unknown>, sessionId?: string) => {
      const sid = typeof msg.sessionId === "string" ? msg.sessionId : sessionId
      const targetMode = typeof msg.targetMode === "string" ? msg.targetMode : undefined
      if (!sid || !targetMode || !["plan", "build", "auto"].includes(targetMode)) {
        log.warn("mode_switch_request: missing sessionId or invalid targetMode")
        return
      }
      log.info(`mode_switch_request: session=${sid}, targetMode=${targetMode}`)
      // Forward as a standard change_mode message, reusing the existing handler
      const handler = this.webviewHandlers.get("change_mode")
      if (handler) await handler({ type: "change_mode", mode: targetMode, sessionId: sid }, sid)
    }],
    ["plan_complete_preference", (msg: Record<string, unknown>) => {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : undefined
      const targetMode = typeof msg.targetMode === "string" ? msg.targetMode : undefined
      const persist = typeof msg.persist === "boolean" ? msg.persist : false
      if (sessionId && targetMode && (targetMode === "build" || targetMode === "auto")) {
        this.opts.handlePlanCompletePreference(sessionId, targetMode, persist)
      }
    }],
    ["set_instructions", (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.instructions === "string") {
        this.opts.ensureLocalTab(sessionId)
        this.opts.tabManager.setInstructions(sessionId, msg.instructions)
      }
    }],
    ["accept_hunk", async (_msg: Record<string, unknown>, _sessionId?: string) => {
      // opencode applies edits server-side, so accept is a UI bookmark.
      // The renderer handles the visual state; this acks to prevent warnings.
    }],
    ["reject_hunk", async (msg: Record<string, unknown>, sessionId?: string) => {
      // Revert a single hunk by restoring the original content for that range.
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      const hunkId = typeof msg.hunkId === "string" ? msg.hunkId : undefined
      if (!filePath || !hunkId) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      const plan = planHunkRevert(ba.before, ba.after, hunkId)
      if (!plan) {
        this.opts.postMessage({ type: "hunk_result", hunkId, ok: false, rejected: true, reason: "stale", sessionId })
        return
      }
      const wsRoot = this.opts.sessionStore.getSessionDirectory(sessionId ?? this.opts.sessionStore.activeId ?? "")
      if (!wsRoot) return
      const uri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), plan.newContent)
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) await doc.save()
        this.opts.postMessage({ type: "hunk_result", hunkId, ok: applied, rejected: true, diffId: msg.diffId, sessionId })
        this.opts.postMessage({ type: "file_hunks", path: filePath, hunks: getFileHunks(ba.before, plan.newContent), sessionId })
      } catch (err) {
        log.warn(`reject_hunk failed for ${filePath}`, err)
        this.opts.postMessage({ type: "hunk_result", hunkId, ok: false, rejected: true, diffId: msg.diffId, sessionId })
      }
    }],
    // Hunk staging (audit §14.3): host-authoritative hunks computed from git
    // before/after so webview/host ids can't drift. get_file_hunks supplies the
    // ids; revert_hunk reverts one hunk as a single undoable WorkspaceEdit (the
    // user editing their own file — opencode's file watcher reconciles).
    ["get_file_hunks", async (msg: Record<string, unknown>, sessionId?: string) => {
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      this.opts.postMessage({ type: "file_hunks", path: filePath, hunks: getFileHunks(ba.before, ba.after), sessionId })
    }],
    ["revert_hunk", async (msg: Record<string, unknown>, sessionId?: string) => {
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      const hunkId = typeof msg.hunkId === "string" ? msg.hunkId : undefined
      if (!filePath || !hunkId) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      const plan = planHunkRevert(ba.before, ba.after, hunkId)
      if (!plan) {
        this.opts.postMessage({ type: "hunk_reverted", path: filePath, ok: false, reason: "stale", sessionId })
        return
      }
      const wsRoot = this.opts.sessionStore.getSessionDirectory(sessionId ?? this.opts.sessionStore.activeId ?? "")
      if (!wsRoot) return
      const uri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), plan.newContent)
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) await doc.save()
        this.opts.postMessage({ type: "hunk_reverted", path: filePath, ok: applied, sessionId })
        // Re-emit remaining hunks so the panel updates immediately.
        this.opts.postMessage({ type: "file_hunks", path: filePath, hunks: getFileHunks(ba.before, plan.newContent), sessionId })
      } catch (err) {
        log.warn(`revert_hunk failed for ${filePath}`, err)
        this.opts.postMessage({ type: "hunk_reverted", path: filePath, ok: false, sessionId })
      }
    }],
    // W1.E: Undo changes to a single file (revert to git HEAD)
    ["undo_file", async (msg: Record<string, unknown>, sessionId?: string) => {
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      const wsRoot = this.opts.sessionStore.getSessionDirectory(sessionId ?? this.opts.sessionStore.activeId ?? "")
      if (!wsRoot) return
      const uri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), ba.before)
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) await doc.save()
        this.opts.postMessage({ type: "hunk_reverted", path: filePath, ok: applied, sessionId })
      } catch (err) {
        log.warn(`undo_file failed for ${filePath}`, err)
        this.opts.postMessage({ type: "hunk_reverted", path: filePath, ok: false, sessionId })
      }
    }],
    // Accept all changes in a file (write current content back to disk)
    ["accept_file_changes", async (msg: Record<string, unknown>, _sessionId?: string) => {
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      try {
        await vscode.commands.executeCommand("opencode-harness.acceptFileChanges", filePath)
      } catch (err) {
        log.warn(`accept_file_changes failed for ${filePath}`, err)
      }
    }],
    // Reject all changes in a file (restore from git HEAD)
    ["reject_file_changes", async (msg: Record<string, unknown>, _sessionId?: string) => {
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      try {
        await vscode.commands.executeCommand("opencode-harness.rejectFileChanges", filePath)
      } catch (err) {
        log.warn(`reject_file_changes failed for ${filePath}`, err)
      }
    }],
    // W1.F: Revert all changed files to git HEAD
    ["revert_all_files", async (msg: Record<string, unknown>, sessionId?: string) => {
      const sid = sessionId ?? (typeof msg.sessionId === "string" ? msg.sessionId : undefined)
      if (!sid) return
      const fileStats = this.opts.sessionStore.getChangedFileStats?.(sid) ?? {}
      const filePaths = Object.keys(fileStats)
      let reverted = 0
      for (const filePath of filePaths) {
        const ba = await this.getFileBeforeAfter(filePath, sessionId)
        if (!ba) continue
        const wsFolder = vscode.workspace.workspaceFolders?.[0]
        if (!wsFolder) continue
        const uri = vscode.Uri.joinPath(wsFolder.uri, filePath)
        try {
          const doc = await vscode.workspace.openTextDocument(uri)
          const edit = new vscode.WorkspaceEdit()
          edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), ba.before)
          const applied = await vscode.workspace.applyEdit(edit)
          if (applied) { await doc.save(); reverted++ }
        } catch (err) {
          log.warn(`revert_all_files: failed for ${filePath}`, err)
        }
      }
      this.opts.postMessage({ type: "revert_result", ok: true, sessionId: sid, reverted })
    }],
    ["fork_session", async (msg: Record<string, unknown>, sessionId?: string) => {
      const sourceId = sessionId ?? (typeof msg.sessionId === "string" ? msg.sessionId : undefined)
      const turnIndex = typeof msg.turnIndex === "number" ? msg.turnIndex : undefined
      if (!sourceId || turnIndex === undefined) return

      const sourceSession = this.opts.sessionStore.get(sourceId)
      if (!sourceSession) return

      // Try SDK fork first when available
      if (sourceSession.cliSessionId) {
        try {
          // Find the message ID at the turn index
          const messages = sourceSession.messages
          const turnMessages = groupMessagesIntoTurns(messages)
          if (turnIndex >= 0 && turnIndex < turnMessages.length) {
            const turn = turnMessages[turnIndex]
            if (!turn) return
            const messageId = turn.userMessageId
            if (messageId) {
              const forked = await this.opts.sessionManager.forkSession(sourceSession.cliSessionId, messageId)
              if (forked) {
                // Create local session for the forked server session
                const localForked = this.opts.sessionStore.ensure(forked.id, `${sourceSession.name} (Fork from Turn ${turnIndex + 1})`, sourceSession.model, sourceSession.mode)
                localForked.cliSessionId = forked.id
                localForked.parentSessionId = sourceId
                localForked.forkedAtTurn = turnIndex
                this.opts.sessionStore.persist()
                this.opts.ensureLocalTab(localForked.id, localForked.name, localForked.model, localForked.mode)
                this.opts.tabManager.switchTab(localForked.id)
                this.opts.postMessage({ type: "fork_created", sessionId: localForked.id, name: localForked.name, mode: localForked.mode, parentSessionId: sourceId, forkedAtTurn: turnIndex })
                log.info(`Forked session using SDK: ${sourceId} → ${localForked.id}`)
                return
              }
            }
          }
        } catch (err) {
          log.warn(`SDK fork failed for session ${sourceId}, falling back to client-side fork`, err)
        }
      }

      // Fallback to client-side fork
      const forked = this.opts.sessionStore.forkSession(sourceId, turnIndex)
      if (!forked) return
      this.opts.ensureLocalTab(forked.id, forked.name, forked.model, forked.mode)
      this.opts.tabManager.switchTab(forked.id)
      this.opts.postMessage({ type: "fork_created", sessionId: forked.id, name: forked.name, mode: forked.mode, parentSessionId: sourceId, forkedAtTurn: turnIndex })
    }],
    ["open_model_selector", () => {
      // Plain "switch model" affordance (e.g. the context-usage dropdown action).
      // Round-trips through the host so the webview opens its model manager via
      // the canonical "open_model_manager" message — no regeneration context.
      this.opts.postMessage({ type: "open_model_manager" })
    }],
    ["open_model_selector_for_regen", (msg: Record<string, unknown>, sessionId?: string) => {
      const targetSessionId = sessionId ?? (typeof msg.sessionId === "string" ? msg.sessionId : undefined)
      if (!targetSessionId) return
      // Open model manager and set a flag to indicate this is for regeneration
      this.opts.postMessage({ type: "open_model_manager", forRegeneration: true, sessionId: targetSessionId, messageId: msg.messageId as string })
    }],
    ["regenerate_with_model", async (msg: Record<string, unknown>, sessionId?: string) => {
      const targetSessionId = sessionId ?? (typeof msg.sessionId === "string" ? msg.sessionId : undefined)
      const model = typeof msg.model === "string" ? msg.model : undefined
      if (!targetSessionId || !model) return
      
      // Set the model for the session and trigger regeneration
      const session = this.opts.sessionStore.get(targetSessionId)
      if (session) {
        session.model = model
        this.opts.sessionStore.persist()
        // Trigger regeneration with the new model
        void this.opts.streamCoordinator.retryFromHere(targetSessionId, {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m),
        })
      }
    }],
    ["open_changed_file_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      // M7: Open a VS Code diff editor comparing the file's baseline
      // (before) against its current workspace content (after). Falls back
      // to a simple "before unavailable" label for untracked / new files.
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      const sid = sessionId ?? this.opts.sessionStore.activeId ?? ""
      if (!filePath) return

      const wsRoot = this.opts.sessionStore.getSessionDirectory(sid)
      if (!wsRoot) {
        this.opts.postMessage({ type: "error", message: "No workspace directory available for diff" })
        return
      }

      // Resolve baseline content via SessionBaselineResolver
      const beforeContent = await getBaselineContent(sid, filePath, {
        sessionStore: this.opts.sessionStore,
        checkpointManager: this.opts.checkpointManager,
        execSync,
        log: { debug: (msg) => log.debug(msg), warn: (msg) => log.warn(msg), info: (msg) => log.info(msg) },
      })

      // Read current file content as the "after" side
      let afterContent = ""
      const workspaceUri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(workspaceUri)
        afterContent = doc.getText()
      } catch {
        // File doesn't exist yet — will show empty right side
      }

      const afterLabel = `${path.basename(filePath)} (After)`
      await this.opts.diffApplier.showSideBySideDiff(filePath, afterContent, `${path.basename(filePath)} — Changes`, beforeContent, afterLabel)
    }],
    ["abort", async (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) await this.opts.streamCoordinator.abort(sessionId, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) })
    }],
    ["probe_run_status", async (_: Record<string, unknown>, sessionId?: string) => {
      // Host-authoritative status probe. Asks the server whether the run for
      // this tab is still active and replies with run_status_result. The
      // webview uses this to correct stale optimistic flags after errors,
      // reconnects, or tab switches. Always replies, even on server failure,
      // so the webview never hangs waiting.
      if (!sessionId) return
      await this.opts.streamCoordinator.probeActiveRun(sessionId, {
        postMessage: (m) => this.opts.postMessage(m),
      })
    }],
    ["cancel_tool", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      await this.opts.streamCoordinator.cancelToolFromCard(sessionId, {
        toolId: typeof msg.toolId === "string" ? msg.toolId : undefined,
        stdout: typeof msg.stdout === "string" ? msg.stdout : undefined,
        stderr: typeof msg.stderr === "string" ? msg.stderr : undefined,
        durationMs: typeof msg.durationMs === "number" ? msg.durationMs : undefined,
      }, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) })
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
        const wasActive = this.opts.tabManager.getActiveId() === sessionId || this.opts.sessionStore.activeId === sessionId
        if (tab?.isStreaming) void this.opts.streamCoordinator.abort(sessionId, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }).catch(err => log.warn("Abort on close failed", err))
        // Clear the host queue for the closed session to prevent orphaned chips
        this.opts.hostQueue.clear(sessionId)
        this.opts.tabManager.closeTab(sessionId)
        this.opts.sessionStore.deleteIfEmpty(sessionId)
        if (wasActive) {
          const nextActiveId = this.opts.tabManager.getActiveId()
          if (nextActiveId) this.opts.sessionStore.setActive(nextActiveId)
          else this.opts.sessionStore.clearActive()
        }
      }
    }],
    ["switch_tab", (msg: Record<string, unknown>, sessionId?: string) => {
      // silent: the webview already switched itself locally before sending
      // this message (see main.ts switchTab) — echoing active_session_changed
      // back here is what forced visible snap-backs to a stale tab once the
      // user had already moved on to a different one.
      if (sessionId) { this.opts.ensureLocalTab(sessionId); this.opts.tabManager.switchTab(sessionId); this.opts.sessionStore.setActive(sessionId, { silent: true }) }
      // Re-deliver the active file so the context pill appears when switching tabs
      this.opts.activeFileTracker?.repost()
    }],
    ["accept_diff", async (_msg: Record<string, unknown>, _sessionId?: string) => {
      // opencode applies edits server-side; accept is a UI bookmark.
      // The renderer handles the visual pending→accepted chip transition.
    }],
    ["reject_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      // Revert ALL changes in this diff block by restoring git HEAD content.
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      const wsRoot = this.opts.sessionStore.getSessionDirectory(sessionId ?? this.opts.sessionStore.activeId ?? "")
      if (!wsRoot) return
      const uri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), ba.before)
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) await doc.save()
        this.opts.postMessage({ type: "diff_rejected", path: filePath, ok: applied, sessionId })
      } catch (err) {
        log.warn(`reject_diff failed for ${filePath}`, err)
        this.opts.postMessage({ type: "diff_rejected", path: filePath, ok: false, sessionId })
      }
    }],
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
    ["get_workspace_files", () => { this.opts.workspaceFileIndex?.handleGetFiles() }],
    ["toggle_active_file", () => {
      // Active-file inclusion is gated entirely in the webview via
      // `isActiveFileIncluded()` (it controls whether the `@file:` mention is
      // prepended to the prompt). The host keeps no inclusion state, so this
      // message needs no host-side handling — the handler exists only so the
      // message is recognised and not logged as unknown.
    }],
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
      if (sessionId && msg.name) {
        // Use setTitle (not rename/updateName) so the new title propagates
        // to the opencode server via serverTitleUpdater. Without this, the
        // webview's deduped title (e.g. "Fix bug (2)") would never reach
        // the CLI, causing the CLI tab strip to show the un-deduped label
        // ("Fix bug") — a mismatch when the user resumes the session from
        // the CLI or opens it in a sibling window. setTitle also fires
        // titleAppliedCallback (the D3 race-free IPC push) so the webview
        // receives session_title_updated even if the rename originated
        // elsewhere. Feedback-loop-safe: server's eventual session.updated
        // echo is no-op'd by applyServerTitle's equality gate.
        const ok = this.opts.sessionStore.setTitle(sessionId, msg.name as string)
        if (ok) this.opts.postMessage({ type: "session_renamed", sessionId, name: msg.name })
      }
    }],
    ["webview_ready", async () => {
      this.clearReadyTimeout()
      this.webviewReady = true
      this.opts.pushAllStateToWebview()
      // Refresh the workspace file index on webview ready to ensure the cache
      // is up-to-date, then send the files to the webview
      await this.opts.workspaceFileIndex?.refresh()
      this.opts.workspaceFileIndex?.handleGetFiles()
      // Re-deliver the active file now that the webview's handlers exist. The
      // eager post in ActiveFileTracker.start() races ahead of webview wiring
      // (active_file is a passthrough message, so it isn't queued), so without
      // this the context pill never appears until the user switches editors.
      this.opts.activeFileTracker?.repost()
      if (this.earlyMessageQueue.length > 0) {
        const queue = this.earlyMessageQueue
        this.earlyMessageQueue = []
        setTimeout(() => {
          for (const q of queue) this.opts.postMessage(q)
        }, 0)
      }
      this.opts.clearReplayDedup()
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
      this.opts.pushVisibleStateToWebview()
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
    ["panel_visibility_state", (msg: Record<string, unknown>) => {
      const panels = msg.panels as Record<string, boolean> | undefined
      if (panels) this.opts.persistPanelVisibilityState?.(panels)
    }],
    ["connect_provider", async () => { await this.opts.handleConnectProvider() }],
    ["open_mcp_settings", async () => { await this.opts.mcpServerManager.openPrimaryConfigFile() }],
    ["open_mcp_config", () => { this.pushMcpServersToWebview() }],
    ["get_permission_config", () => {
      this.opts.postMessage({ type: "permission_config", rules: [] })
    }],
    ["update_permission_config", (_msg: Record<string, unknown>) => {
      this.opts.postMessage({ type: "permission_config_saved" })
    }],
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
    ["save_template", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const content = msg.content as string
      const tags = (msg.tags as string[]) ?? []
      const existingId = msg.existingId as string | undefined
      if (name && content) {
        await this.opts.saveTemplate(name, content, tags, existingId)
      }
    }],
    ["list_templates", () => { this.opts.listTemplates() }],
    ["delete_template", (msg: Record<string, unknown>) => {
      const id = msg.id as string
      if (id) {
        this.opts.deleteTemplate(id)
      }
    }],
    ["save_message_as_template", async (msg: Record<string, unknown>) => {
      const name = msg.name as string
      const content = msg.content as string
      const tags = (msg.tags as string[]) ?? []
      if (name && content) {
        await this.opts.saveTemplate(name, content, tags)
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
    ["discover_providers", async () => {
      await this.opts.discoverProviders()
    }],
    ["get_provider_auth_methods", async (msg: Record<string, unknown>) => {
      const providerId = msg.providerId as string
      if (providerId) await this.opts.getProviderAuthMethods(providerId)
    }],
    ["connect_provider_key", async (msg: Record<string, unknown>) => {
      const providerId = msg.providerId as string
      const key = msg.key as string
      const label = msg.label as string | undefined
      if (providerId && key) await this.opts.connectProviderKey(providerId, key, label)
    }],
    ["connect_provider_oauth", async (msg: Record<string, unknown>) => {
      const providerId = msg.providerId as string
      const methodIndex = typeof msg.methodIndex === "number" ? msg.methodIndex : undefined
      if (providerId) await this.opts.connectProviderOAuth(providerId, methodIndex)
    }],
    ["complete_provider_oauth", async (msg: Record<string, unknown>) => {
      const providerId = msg.providerId as string
      const code = msg.code as string | undefined
      const methodIndex = typeof msg.methodIndex === "number" ? msg.methodIndex : undefined
      if (providerId) await this.opts.completeProviderOAuth(providerId, code, methodIndex)
    }],
    ["list_provider_credentials", async () => {
      await this.opts.listProviderCredentials()
    }],
    ["remove_provider_credential", async (msg: Record<string, unknown>) => {
      const credentialId = msg.credentialId as string
      if (credentialId) await this.opts.removeProviderCredential(credentialId)
    }],
    ["compact_session", async (_: Record<string, unknown>, sessionId?: string) => { await this.opts.sessionLifecycle.handleCompactSession(sessionId) }],
    ["execute_command", async (msg: Record<string, unknown>, sessionId?: string) => { await this.opts.commandExec.handleExecuteCommand(sessionId, msg.command as string, msg.arguments as string) }],
    ["log_ambiguity", async (msg: Record<string, unknown>) => {
      const prefix = typeof msg.prefix === "string" ? msg.prefix : "?"
      const suffix = typeof msg.suffix === "string" ? msg.suffix : "?"
      const candidates = Array.isArray(msg.candidates) ? msg.candidates : []
      const sources = candidates.map((c: Record<string, unknown>) => `${c.source ?? "unknown"}${c.origin ? `:${c.origin}` : ""}`).join(", ")
      log.warn(`Ambiguous slash command: /${prefix}:${suffix} — matched: ${sources}`)
    }],
    ["list_commands", async () => { await this.handleListCommands() }],
    ["insert_at_cursor", async (msg: Record<string, unknown>) => { await this.opts.handleInsertAtCursor(msg.code as string, msg.language as string) }],
    ["create_file_from_code", async (msg: Record<string, unknown>) => { await this.opts.handleCreateFileFromCode(msg.code as string, msg.language as string) }],
    ["compact_banner_action", async (msg: Record<string, unknown>, sessionId?: string) => { await this.opts.autoCompactor.handleBannerAction(sessionId, msg.action as string, { postMessage: (m) => this.opts.postMessage(m), postRequestError: (m) => this.opts.postRequestError(m) }) }],
    ["edit_message", (msg: Record<string, unknown>, sessionId?: string) => { if (sessionId && msg.messageId) this.opts.handleEditMessage(sessionId, msg.messageId as string, msg.text as string) }],
    ["delete_session", async (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (!targetId) return
      const session = this.opts.sessionStore.get(targetId)
      if (session && session.messages.length > 0) {
        const confirmed = await this.opts.showWarningMessage(
          `Delete session "${session.name}"? This cannot be undone.`,
          { modal: true },
          "Delete"
        )
        if (confirmed !== "Delete") return
      }
      // Capture cliSessionId BEFORE delete — the onDidChangeSession handler in
      // ChatProvider reads sessionStore.get() after deletion and gets undefined,
      // so the server-side delete silently never fires. Pass it explicitly.
      const cliId = session?.cliSessionId
      // Close the tab BEFORE deleting so we don't depend on the
      // onDidChangeSession handler's registration order. If the handler
      // fires too, closeTab is idempotent (no-op on already-closed tabs).
      this.opts.tabManager.closeTab(targetId)
      this.opts.sessionStore.delete(targetId)
      log.info(`Session deleted via webview: ${targetId}`)
      if (cliId && this.opts.sessionManager.isRunning) {
        void this.opts.sessionManager.deleteSession(cliId).catch(err =>
          log.warn(`Server-side session delete failed for ${cliId}`, err)
        )
      }
    }],
    ["archive_session", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (!targetId) return
      const session = this.opts.sessionStore.get(targetId)
      const cliId = session?.cliSessionId
      this.opts.sessionStore.archive(targetId)
      log.info(`Session archived: ${targetId}`)
      // Propagate to server so archiving is consistent across CLI / sibling windows.
      if (cliId && this.opts.sessionManager.isRunning) {
        void this.opts.sessionManager.archiveSession(cliId, true).catch(err =>
          log.warn(`Server-side archive failed for ${cliId}`, err)
        )
      }
    }],
    ["unarchive_session", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (!targetId) return
      const session = this.opts.sessionStore.get(targetId)
      const cliId = session?.cliSessionId
      this.opts.sessionStore.unarchive(targetId)
      log.info(`Session unarchived: ${targetId}`)
      if (cliId && this.opts.sessionManager.isRunning) {
        void this.opts.sessionManager.archiveSession(cliId, false).catch(err =>
          log.warn(`Server-side unarchive failed for ${cliId}`, err)
        )
      }
    }],
    ["pin_session", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId && typeof msg.pinned === "boolean") {
        this.opts.sessionStore.setPinned(targetId, msg.pinned)
        log.info(`Session ${msg.pinned ? "pinned" : "unpinned"}: ${targetId}`)
      }
    }],
    ["set_session_tags", (msg: Record<string, unknown>) => {
      const targetId = msg.targetSessionId as string | undefined
      if (targetId && Array.isArray(msg.tags)) {
        const tags = msg.tags.filter((tag): tag is string => typeof tag === "string")
        this.opts.sessionStore.setTags(targetId, tags)
        log.info(`Session tags updated: ${targetId}`)
      }
    }],
    ["open_terminal", (msg: Record<string, unknown>) => {
      const command = typeof msg.command === "string" ? msg.command : ""
      if (!command.trim()) return
      const cwd = typeof msg.cwd === "string" && msg.cwd.trim() ? msg.cwd : undefined
      const terminal = vscode.window.createTerminal({ name: "OpenCode Task", cwd })
      terminal.show()
      terminal.sendText(command, msg.autorun === true)
    }],
    // PTY terminal handlers are registered in the constructor via PtyRouter
    ["copy_text", async (msg: Record<string, unknown>) => {
      const text = typeof msg.text === "string" ? msg.text : ""
      if (!text.trim()) return
      // Webviews frequently have no navigator.clipboard; copy actions
      // round-trip through the host clipboard instead.
      await vscode.env.clipboard.writeText(text)
      vscode.window.setStatusBarMessage("OpenCode: copied to clipboard", 2000)
    }],
    ["revert_message", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (sessionId && typeof msg.messageId === "string") {
        try {
          const cliSessionId = await this.resolveCliSessionId(sessionId)
          await this.opts.sessionManager.revertMessage(cliSessionId, msg.messageId)
          this.opts.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: true,
          })
          this.opts.showInformationMessage("OpenCode: Changes reverted for the selected message.")
        } catch (err) {
          log.error("Revert message failed", err)
          this.opts.postMessage({
            type: "revert_result",
            sessionId,
            messageId: msg.messageId,
            ok: false,
            error: (err as Error).message,
          })
          this.opts.showErrorMessage(`OpenCode: Could not revert changes — ${(err as Error).message}`)
        }
      }
    }],
    ["unrevert", async (_: Record<string, unknown>, sessionId?: string) => {
      if (sessionId) {
        try {
          const cliSessionId = await this.resolveCliSessionId(sessionId)
          await this.opts.sessionManager.unrevert(cliSessionId)
          this.opts.postMessage({ type: "unrevert_result", sessionId, ok: true })
          this.opts.showInformationMessage("OpenCode: All reverted messages restored.")
        } catch (err) {
          log.error("Unrevert failed", err)
          this.opts.postMessage({ type: "unrevert_result", sessionId, ok: false, error: (err as Error).message })
          this.opts.showErrorMessage(`OpenCode: Could not restore reverted messages — ${(err as Error).message}`)
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
              isCurrentWorkspace: !currentDir || !s.directory || path.resolve(s.directory) === path.resolve(currentDir),
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
    ["open_subagent_session", async (msg: Record<string, unknown>) => {
      const childSessionId = typeof msg.childSessionId === "string" ? msg.childSessionId : ""
      if (!childSessionId) return
      const title = typeof msg.title === "string" && msg.title.trim() ? msg.title : "Subagent session"
      try {
        // Subagent child sessions live on the server; import locally (no-op if
        // already imported) and resume as a regular tab.
        const localSession = this.opts.sessionStore.importOneServerSession(childSessionId, title, undefined)
        await this.opts.sessionLifecycle.handleResumeSession(localSession.id)
      } catch (err) {
        log.error("Failed to open subagent session", err)
        this.opts.showErrorMessage(`OpenCode: Could not open the subagent session — ${(err as Error).message}`)
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
        this.opts.showErrorMessage(`OpenCode: Could not restore checkpoint — ${(err as Error).message}. Check the output channel for details.`)
      }
    }],
    ["list_restore_points", async (_msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const session = this.opts.sessionStore.get(sessionId)
      if (!session) return
      try {
        const { collectRestorePoints } = await import("../checkpoint/restorePoints")
        interface SnapshotBlock { id: string; type: string; snapshot?: string; tool?: string; title?: string }
        const points = collectRestorePoints(session.messages
          .filter((m): m is typeof m & { id: string } => typeof m.id === "string")
          .map((m) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            time: m.timestamp,
            parts: (m.blocks ?? [])
              .filter((b): b is typeof b & { id: string } => typeof b.id === "string")
              .map((b): SnapshotBlock => {
                const raw = b as Record<string, unknown>
                return {
                  id: b.id,
                  type: b.type,
                  snapshot: typeof raw.snapshot === "string" ? raw.snapshot : undefined,
                  tool: typeof raw.tool === "string" ? raw.tool : undefined,
                  title: typeof raw.title === "string" ? raw.title : undefined,
                }
              }),
          })))
        this.opts.postMessage({ type: "restore_points", sessionId, points })
      } catch (err) {
        log.error("Failed to list restore points", err)
        this.opts.postMessage({ type: "restore_points", sessionId, points: [] })
      }
    }],
    ["restore_point", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.messageID !== "string") return
      const messageID = msg.messageID as string
      const partID = typeof msg.partID === "string" ? msg.partID : undefined
      try {
        const ok = await this.opts.sessionManager.revert(sessionId, messageID, partID)
        this.opts.postMessage({ type: "restore_point_result", sessionId, messageID, ok })
        if (ok) {
          this.opts.showInformationMessage?.(`OpenCode: Restored to ${partID ? "checkpoint" : "message"} ${messageID.slice(0, 8)}.`)
        }
      } catch (err) {
        log.error("Failed to restore point", err)
        this.opts.postMessage({ type: "restore_point_result", sessionId, messageID, ok: false, error: (err as Error).message })
        this.opts.showErrorMessage?.(`OpenCode: Could not restore point — ${(err as Error).message}`)
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
        // Hidden turns = turns older than the slice we just sent (still
        // hidden from the webview). The webview uses this for the banner
        // label "Load N earlier items".
        const stillHiddenTurns = computeMessageCounts(session.messages.slice(0, start)).userTurns + computeMessageCounts(session.messages.slice(0, start)).assistantTurns
        this.opts.postMessage({
          type: "more_messages",
          sessionId,
          messages: slice,
          hasMore: start > 0,
          newBeforeIndex: start,
          totalCount: session.messages.length,
          displayHiddenTurns: stillHiddenTurns,
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
              // Slice from newStart to beforeIndex — only the older messages
              // the user doesn't have yet. Slicing to the end would duplicate
              // messages already in the webview.
              const newStart = Math.max(0, beforeIndex - limit)
              const endIdx = Math.min(beforeIndex, refreshed.messages.length)
              const olderSlice = refreshed.messages.slice(newStart, endIdx)
              const stillHiddenTurns = computeMessageCounts(refreshed.messages.slice(0, newStart)).userTurns + computeMessageCounts(refreshed.messages.slice(0, newStart)).assistantTurns
              this.opts.postMessage({
                type: "more_messages",
                sessionId,
                messages: olderSlice,
                hasMore: newStart > 0,
                newBeforeIndex: newStart,
                totalCount: refreshed.messages.length,
                displayHiddenTurns: stillHiddenTurns,
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
        displayHiddenTurns: 0,
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
            // Close the tab BEFORE deleting from the store so the
            // onDidChangeSession handler in ChatProvider doesn't double-fire
            // the server delete (already done above) and so no orphaned tab
            // remains pointing at a session that no longer exists.
            this.opts.tabManager.closeTab(local.id)
            this.opts.sessionStore.delete(local.id)
            log.info(`Cleaned up extension session ${local.id} matching deleted server session ${serverId}`)
            break
          }
        }

        this.opts.postMessage({ type: "server_session_deleted", serverSessionId: serverId })
      } catch (err) {
        log.error(`Failed to delete server session ${serverId}`, err)
        this.opts.showErrorMessage(`OpenCode: Could not delete the server session — ${(err as Error).message}`)
      }
    }],
    ["preview_theme", async (_msg: Record<string, unknown>, _sessionId?: string) => {
      try {
        await this.opts.themeManager.previewTheme()
      } catch (err) {
        log.error("Theme preview failed", err)
        this.opts.showErrorMessage(`OpenCode: Could not preview the theme — ${(err as Error).message}.`)
      }
    }],
    ["get_theme_config", () => {
      this.opts.themeController.pushThemeConfigToWebview()
    }],
    ["update_theme_config", async (msg: Record<string, unknown>) => {
      await this.opts.themeController.handleUpdateThemeConfig(msg.theme)
    }],
    ["update_switch_workbench_theme", async (msg: Record<string, unknown>) => {
      await this.opts.themeController.handleSwitchWorkbenchTheme(msg.enabled === true)
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
    ["model_favorite", (msg: Record<string, unknown>) => {
      const modelId = msg.modelId as string
      this.opts.modelManager.toggleModelFavorite(modelId)
      this.pushModelListToWebview()
    }],
    ["chat_dir_change", (msg: Record<string, unknown>) => {
      const direction = msg.direction as string
      if (direction === "ltr" || direction === "rtl") {
        this.opts.persistChatDirection?.(direction)
      }
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
      // Revert ALL changes in this diff block (same as reject_diff).
      const filePath = typeof msg.path === "string" ? msg.path : undefined
      if (!filePath) return
      const ba = await this.getFileBeforeAfter(filePath, sessionId)
      if (!ba) return
      const wsRoot = this.opts.sessionStore.getSessionDirectory(sessionId ?? this.opts.sessionStore.activeId ?? "")
      if (!wsRoot) return
      const uri = this.resolveWorkspaceUri(filePath, wsRoot)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), ba.before)
        const applied = await vscode.workspace.applyEdit(edit)
        if (applied) await doc.save()
        this.opts.postMessage({ type: "diff_reverted", path: filePath, ok: applied, sessionId })
      } catch (err) {
        log.warn(`revert_diff failed for ${filePath}`, err)
        this.opts.postMessage({ type: "diff_reverted", path: filePath, ok: false, sessionId })
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

      const storedUsage = this.opts.sessionStore.getContextUsage(targetId)
      if (storedUsage) {
        this.opts.postMessage({ type: "context_usage", ...storedUsage, sessionId: targetId })
        return
      }

      const maxTokens = this.opts.contextMonitor.limit
      if (maxTokens > 0) {
        this.opts.postMessage({ type: "context_window_known", sessionId: targetId, maxTokens, source: "monitor" })
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
      const _days = typeof msg.days === "number" ? msg.days : 7
      
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
      if (!cliSessionId) return
      if (!this.opts.sessionManager.isRunning) return
      try {
        const raw = await this.opts.sessionManager.getSessionTodos(cliSessionId)
        const todos = normalizeTodoList(raw)
        log.debug(`get_todos: fetched ${todos.length} todos for session ${sessionId} (cli: ${cliSessionId})`)
        this.opts.postMessage({ type: "todos_update", todos, sessionId })
      } catch (err) {
        log.error("Failed to fetch todos", err)
        const message = err instanceof Error ? err.message : "Could not load tasks from the server."
        this.opts.postMessage({ type: "todos_error", message, sessionId })
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
        status: stats[path]?.status,
      }))
      this.opts.postMessage({ type: "changed_files_update", files, sessionId })
    }],
    ["get_file_diff", async (msg: Record<string, unknown>, sessionId?: string) => {
      // Per-file diff for the changed-files dropdown's inline expansion and edit-card diffs.
      // opencode applies edits server-side, so we read the file (with its diff) from the
      // server and normalize it into DiffLine[] for the webview. Falls back to local
      // baseline computation when the server returns no diff.
      const path = typeof msg.path === "string" ? msg.path : ""
      const toolId = typeof msg.toolId === "string" ? msg.toolId : undefined
      const sid = sessionId ?? this.opts.sessionStore.activeId ?? ""
      if (!path) return
      const respond = (lines: DiffLine[] | null, error?: string, opts?: { deleted?: boolean; truncated?: boolean }) =>
        this.opts.postMessage({ type: "file_diff_response", sessionId, path, lines, error, deleted: opts?.deleted, truncated: opts?.truncated })
      if (!this.opts.sessionManager.isRunning) {
        respond(null, "opencode server is not running")
        return
      }
      try {
        const directory = this.opts.sessionStore.getSessionDirectory(sid)
        const content = await this.opts.sessionManager.getFileContent(path, directory, toolId)
        const lines = sdkFileContentToDiffLines(content as SdkFileContentLike)
        
        // If server returned no diff, fall back to local baseline computation
        if (lines.length === 0 && directory) {
          const baselineContent = await getBaselineContent(sid, path, {
            sessionStore: this.opts.sessionStore,
            checkpointManager: this.opts.checkpointManager,
            execSync,
            log: { debug: (msg) => log.debug(msg), warn: (msg) => log.warn(msg), info: (msg) => log.info(msg) },
          })
          if (baselineContent) {
            // Read current file content
            let afterContent = ""
            try {
              const afterUri = this.resolveWorkspaceUri(path, directory)
              const doc = await vscode.workspace.openTextDocument(afterUri)
              afterContent = doc.getText()
            } catch {
              // File doesn't exist
            }
            // Compute local diff using getFileHunks (returns FileHunkSummary with unified diff lines)
            const hunks = getFileHunks(baselineContent, afterContent)
            const localLines = hunks.flatMap((hunk: FileHunkSummary) => {
              const out: DiffLine[] = []
              // Initialize line numbers from the hunk's starting positions
              let oldLine = hunk.oldStart
              let newLine = hunk.newStart
              for (const line of hunk.lines) {
                if (line.startsWith("+")) {
                  out.push({ type: "added", newLine: newLine++, content: line.slice(1) })
                } else if (line.startsWith("-")) {
                  out.push({ type: "removed", oldLine: oldLine++, content: line.slice(1) })
                } else if (line.startsWith(" ")) {
                  out.push({ type: "context", oldLine: oldLine++, newLine: newLine++, content: line.slice(1) })
                }
              }
              return out
            })
            if (localLines.length > 0) {
              respond(localLines)
              return
            }
          }
        }
        
        // Boundary check: cap payload size to prevent webview freezing on
        // very large diffs (e.g. whole-file rewrites of minified files).
        const MAX_DIFF_PAYLOAD_BYTES = 5 * 1024 * 1024
        const serialized = JSON.stringify(lines)
        if (serialized.length > MAX_DIFF_PAYLOAD_BYTES) {
          respond(lines.slice(0, 500), undefined, { truncated: true })
          return
        }
        respond(lines)
      } catch (err) {
        // SDK read failed — check if the file was deleted. If so, read git
        // baseline content and construct all-removed DiffLine[] so the user sees
        // what was removed rather than a silent failure.
        const wsRoot = this.opts.sessionStore.getSessionDirectory(sid)
        if (wsRoot) {
          try {
            const baselineContent = await getBaselineContent(sid, path, {
              sessionStore: this.opts.sessionStore,
              checkpointManager: this.opts.checkpointManager,
              execSync,
              log: { debug: (msg) => log.debug(msg), warn: (msg) => log.warn(msg), info: (msg) => log.info(msg) },
            })
            if (typeof baselineContent === "string" && baselineContent.length > 0) {
              // File exists in baseline but SDK read failed → likely deleted.
              const baselineLines = baselineContent.split("\n")
              const diffLines: DiffLine[] = baselineLines.map((line, i) => ({
                type: "removed" as const,
                oldLine: i + 1,
                content: line,
              }))
              respond(diffLines, undefined, { deleted: true })
              return
            }
          } catch {
            // Baseline lookup failed — truly unknown failure.
          }
        }
        log.warn(`get_file_diff failed for ${path}`, err)
        respond(null, err instanceof Error ? err.message : "Failed to load diff")
      }
    }],
    ["open_file", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawPath = msg.path as string | undefined
      if (!rawPath) return

      try {
        const { uri, lineNumber, columnNumber } = await this.resolveOpenFileTarget(rawPath, sessionId)
        const doc = await vscode.workspace.openTextDocument(uri)
        const options: vscode.TextDocumentShowOptions = {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        }
        if (lineNumber) {
          const col = columnNumber ? columnNumber - 1 : 0
          options.selection = new vscode.Range(lineNumber - 1, col, lineNumber - 1, col)
        }
        await vscode.window.showTextDocument(doc, options)
      } catch (err) {
        log.error(`Failed to open file: ${rawPath}`, err)
        this.opts.showErrorMessage(`OpenCode: Could not open the file — ${(err as Error).message}`)
      }
    }],
    ["open_folder", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawDir = msg.dir as string | undefined
      if (!rawDir) return
      try {
        const sid = sessionId ?? this.opts.sessionStore.activeId ?? ""
        const wsRoot = this.opts.sessionStore.getSessionDirectory(sid)
        const uri = wsRoot && !path.isAbsolute(rawDir)
          ? vscode.Uri.joinPath(vscode.Uri.file(wsRoot), rawDir)
          : vscode.Uri.file(rawDir)
        await vscode.commands.executeCommand("vscode.openFolder", uri)
      } catch (err) {
        log.error(`Failed to open folder: ${rawDir}`, err)
      }
    }],
    ["open_url", async (msg: Record<string, unknown>, _sessionId?: string) => {
      const rawUrl = msg.url as string | undefined
      if (!rawUrl) return
      try {
        const uri = vscode.Uri.parse(rawUrl)
        await this.opts.openExternal(uri)
      } catch (err) {
        log.error(`Failed to open URL: ${rawUrl}`, err)
      }
    }],
    ["reveal_in_explorer", async (msg: Record<string, unknown>, sessionId?: string) => {
      const rawPath = msg.path as string | undefined
      if (!rawPath) return
      try {
        const sid = sessionId ?? this.opts.sessionStore.activeId ?? ""
        const wsRoot = this.opts.sessionStore.getSessionDirectory(sid)
        const uri = wsRoot
          ? this.resolveWorkspaceUri(rawPath, wsRoot)
          : vscode.Uri.file(rawPath)
        await vscode.commands.executeCommand("revealInExplorer", uri)
      } catch (err) {
        log.error(`Failed to reveal in explorer: ${rawPath}`, err)
      }
    }],
    ["open_context_window_override_dialog", async () => {
      // The webview posts this when the user clicks the "set limit" affordance in
      // the context-usage display. Route it to the registered VS Code command so
      // the native input box appears. Defensive: a command failure must never
      // break the webview message pump.
      try {
        await vscode.commands.executeCommand("opencode-harness.setContextWindowOverride")
      } catch (err) {
        log.error("Failed to open context-window override dialog", err)
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
      const query = (msg.query as string | undefined) || ""
      try {
        const all = await this.resolveAllSkills()
        // Fuzzy match (name fuzzily, description by substring), ranked
        // best-first — same matcher as the slash dropdown + commands palette,
        // so "review" finds "code-reviewer" and the search isn't startswith-
        // or substring-only. Empty query returns the full list unchanged.
        const results = rankByFuzzy(all, query, (s) => s.name, (s) => s.description)
        this.opts.postMessage({ type: "skills_search_results", results, query })
      } catch (err) {
        log.error("Failed to search skills", err)
        this.opts.postMessage({ type: "skills_search_results", results: [], query })
      }
    }],
    ["get_subagent_activities", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const tab = this.opts.tabManager.getTab(sessionId)
      const cliSessionId = tab?.cliSessionId
      if (!cliSessionId) return
      try {
        const children = await this.opts.sessionManager.sessionClient.getChildSessions(cliSessionId)
        // Cross-reference the live tracker so we can mark a child as
        // "running" even though the SDK Session type has no status field.
        // Tracker key is `subagent:<toolId>`, value carries childSessionId
        // when known; we match by childSessionId OR by direct id match.
        const liveByChildId = new Map<string, { status: string; currentActivity?: string; error?: string }>()
        const liveBySubagentKey = new Map<string, { status: string; currentActivity?: string; error?: string }>()
        for (const live of this.opts.streamCoordinator.getSubagentSnapshot(sessionId)) {
          const entry = { status: live.status, currentActivity: live.currentActivity, error: live.error }
          if (live.childSessionId) liveByChildId.set(live.childSessionId, entry)
          liveBySubagentKey.set(live.id, entry)
        }
        const activities: unknown[] = []
        for (const rawChild of children) {
          if (!rawChild || typeof rawChild !== "object") continue
          const child = rawChild as ChildSessionLike
          const childSid = asNonEmptyString(child.id)
          if (!childSid) continue
          const time = child.time as { created?: number; updated?: number; archived?: number } | undefined
          const title = typeof child.title === "string" ? child.title : ""
          const summary = child.summary as { additions?: number; deletions?: number; files?: number } | undefined
          let parentId = ""
          if (child.parentID && typeof child.parentID === "string") {
            parentId = child.parentID as string
          }

          // Determine real status: tracker first (live source of truth),
          // then SDK `time.archived` (completed/failed), default "running"
          // (child session is in-flight on the server).
          const live = liveByChildId.get(childSid)
          const status = live?.status
            ?? (time?.archived ? "completed" : "running")
          const isLive = status === "running" || status === "queued" || status === "waiting" || status === "unknown" || status === "pending"

          const activity: Record<string, unknown> = {
            id: childSid,
            name: title || "subagent",
            status,
            summary: summary ? `${summary.additions ?? 0}+ / ${summary.deletions ?? 0}- (${summary.files ?? 0} files)` : undefined,
            createdAt: time?.created,
            updatedAt: time?.updated,
            sessionId: childSid,
            parentSessionId: parentId,
            isLive,
            currentActivity: live?.currentActivity,
            error: live?.error,
          }
          activities.push(activity)
        }
        // Also include tracker-only subagents (live, no SDK child yet).
        for (const live of this.opts.streamCoordinator.getSubagentSnapshot(sessionId)) {
          if (live.childSessionId && children.some((c) => {
            if (!c || typeof c !== "object") return false
            const sid = (c as ChildSessionLike).id
            return typeof sid === "string" && sid === live.childSessionId
          })) continue
          activities.push({
            id: live.id,
            name: live.agentName || "subagent",
            status: live.status,
            summary: undefined,
            createdAt: live.startedAt,
            updatedAt: live.updatedAt,
            sessionId: live.childSessionId,
            parentSessionId: cliSessionId,
            isLive: live.status === "running" || live.status === "queued" || live.status === "waiting" || live.status === "unknown",
            currentActivity: live.currentActivity,
            error: live.error,
          })
        }
        this.opts.postMessage({ type: "subagent_activities", activities, sessionId })
      } catch (err) {
        log.error(`Failed to get subagent activities for ${cliSessionId}`, err)
        this.opts.postMessage({ type: "subagent_activities", activities: [], sessionId })
      }
    }],
    ["get_subagent_detail", async (msg: Record<string, unknown>, sessionId?: string) => {
      const subagentId = msg.subagentId as string | undefined
      if (!sessionId || !subagentId) return
      const cliSessionId = this.opts.tabManager.getTab(sessionId)?.cliSessionId
      if (!cliSessionId) return
      try {
        const children = await this.opts.sessionManager.sessionClient.getChildSessions(cliSessionId)
        const authorizedChild = findAuthorizedSubagentChild(children, cliSessionId, subagentId)
        if (!authorizedChild) {
          this.opts.postMessage({
            type: "webview_request_error",
            requestType: "get_subagent_detail",
            sessionId,
            error: "Subagent does not belong to the active session.",
            reason: "unauthorized_subagent",
          })
          return
        }
        const sessionData = await this.opts.sessionManager.sessionClient.getSessionDetails(subagentId)
        const messages = await this.opts.sessionManager.sessionClient.getSessionMessages(subagentId).catch((err) => {
          log.warn(`Failed to fetch messages for subagent ${subagentId}`, err)
          return []
        })
        const time = sessionData.time as { created?: number; updated?: number; archived?: number } | undefined
        const title = typeof sessionData.title === "string" ? sessionData.title : ""
        const summary = sessionData.summary as { additions?: number; deletions?: number; files?: number } | undefined
        let parentId = ""
        if (sessionData.parentID && typeof sessionData.parentID === "string") {
          parentId = sessionData.parentID as string
        }
        // Cross-reference live tracker so the detail view shows real status
        // for an in-flight subagent instead of always "completed".
        const live = this.opts.streamCoordinator
          .getSubagentSnapshot(sessionId)
          .find((s) => s.childSessionId === subagentId || s.id === subagentId)
        const status = live?.status ?? (time?.archived ? "completed" : "running")
        const isLive = status === "running" || status === "queued" || status === "waiting" || status === "unknown"
        const detail: Record<string, unknown> = {
          id: subagentId,
          sessionId: subagentId,
          parentSessionId: parentId,
          agentName: title || live?.agentName || "subagent",
          status,
          title,
          createdAt: time?.created,
          updatedAt: time?.updated,
          summary: title,
          result: summary ? `${summary.additions ?? 0} additions, ${summary.deletions ?? 0} deletions` : undefined,
          messages: messages.map((m: { info?: { role?: string; id?: string; time?: { created?: number } }; parts?: Array<{ type: string; text?: string }> }) => {
            const role = m.info?.role ?? "assistant"
            const text = (m.parts ?? []).map((p: { type: string; text?: string }) => p.type === "text" ? (p.text ?? "") : "").filter(Boolean).join("\n")
            return { role, text, timestamp: m.info?.time?.created }
          }),
          toolCalls: [],
          commands: [],
          fileChanges: [],
          isLive,
          currentActivity: live?.currentActivity,
          error: live?.error,
          unreadActivityCount: live?.unreadActivityCount ?? 0,
        }
        // Forward to any open popout panels first, then the main webview.
        const popoutConsumed = this.opts.postSubagentDetailToPopouts(detail, subagentId)
        if (!popoutConsumed) {
          this.opts.postMessage({ type: "subagent_detail", sessionId, subagentId, detail })
        } else {
          // Still post to main webview so inline detail view updates too
          this.opts.postMessage({ type: "subagent_detail", sessionId, subagentId, detail })
        }
      } catch (err) {
        log.error(`Failed to get subagent detail for ${subagentId}`, err)
        this.opts.postMessage({
          type: "webview_request_error", sessionId,
          error: `Failed to load subagent detail: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }],
    ["cancel_subagent", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      const subagentId = msg.subagentId as string | undefined
      if (!subagentId) return
      const cliSessionId = this.opts.tabManager.getTab(sessionId)?.cliSessionId
      if (!cliSessionId) return
      log.info(`Cancel subagent ${subagentId} in session ${sessionId}`)
      try {
        const children = await this.opts.sessionManager.sessionClient.getChildSessions(cliSessionId)
        const authorizedChild = findAuthorizedSubagentChild(children, cliSessionId, subagentId)
        if (!authorizedChild) {
          this.opts.postMessage({
            type: "webview_request_error",
            requestType: "cancel_subagent",
            sessionId,
            error: "Subagent does not belong to the active session.",
            reason: "unauthorized_subagent",
          })
          return
        }
        await this.opts.sessionManager.sessionClient.abortSession(subagentId)
        log.info(`Subagent ${subagentId} aborted`)
      } catch (err) {
        log.error(`Failed to cancel subagent ${subagentId}`, err)
        this.opts.postMessage({
          type: "webview_request_error",
          requestType: "cancel_subagent",
          sessionId,
          error: err instanceof Error ? err.message : "Failed to cancel subagent",
        })
      }
    }],
    ["mark_subagent_read", (_msg: Record<string, unknown>, _sessionId?: string) => {
      // No-op in the host: read state is managed in the webview.
      // Host-side, this could be used to reset unread counts for SSE tracking.
    }],
    ["open_subagent_detail", (msg: Record<string, unknown>, sessionId?: string) => {
      // Popout button: open the active subagent's detail in a dedicated VS Code
      // editor webview panel. The webview now sends the parent sessionId AND
      // the active subagentId (tracked from the last panel click or live
      // subagent_update), so we can hand both to the host's panel creator.
      const subagentId = typeof msg.subagentId === "string" ? msg.subagentId : ""
      if (!sessionId || !subagentId) {
        log.warn(`open_subagent_detail: missing sessionId=${sessionId} or subagentId=${subagentId}`)
        return
      }
      try {
        const popoutId = this.opts.openSubagentDetailPanel(sessionId, subagentId)
        if (!popoutId) {
          log.warn(`open_subagent_detail: host refused to open panel for ${subagentId}`)
          return
        }
        log.info(`open_subagent_detail: opened popout panel ${popoutId} for subagent ${subagentId}`)
      } catch (err) {
        log.error(`open_subagent_detail: failed to open panel for ${subagentId}`, err)
      }
    }],
    ["webview_error", (msg: Record<string, unknown>) => {
      const message = typeof msg.message === "string" ? msg.message : "Unknown webview error"
      log.error(`Webview fatal error: ${message}`)
    }],
    ["remove_from_queue", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.itemId !== "string") return
      this.opts.hostQueue.remove(sessionId, msg.itemId)
      this.postQueueState(sessionId)
    }],
    ["edit_queue_item", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.itemId !== "string" || typeof msg.text !== "string") return
      this.opts.hostQueue.edit(sessionId, msg.itemId, msg.text)
      this.postQueueState(sessionId)
    }],
    ["reorder_queue", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.fromIndex !== "number" || typeof msg.toIndex !== "number") return
      this.opts.hostQueue.reorder(sessionId, msg.fromIndex, msg.toIndex)
      this.postQueueState(sessionId)
    }],
    ["retry_queue_item", (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.itemId !== "string") return
      this.opts.hostQueue.retry(sessionId, msg.itemId)
      this.postQueueState(sessionId)
    }],
    ["send_queue_item", async (msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId || typeof msg.itemId !== "string") return
      const item = this.opts.hostQueue.peek(sessionId)
      if (!item || item.id !== msg.itemId) return
      // Remove the item from the queue and send it immediately
      this.opts.hostQueue.remove(sessionId, msg.itemId)
      this.drainQueuedPrompt(sessionId, item)
    }],
    ["request_queue_state", (msg: Record<string, unknown>, sessionId?: string) => {
      // If a specific session is requested, send state for that session.
      // Otherwise, send state for all sessions that have items.
      if (sessionId) {
        this.postQueueState(sessionId)
      } else {
        const requestedSid = msg.sessionId as string | undefined
        if (requestedSid) {
          this.postQueueState(requestedSid)
        } else {
          // No session specified — push state for every session with queue items
          for (const sid of this.opts.hostQueue.getActiveSessionIds()) {
            this.postQueueState(sid)
          }
        }
      }
    }],
    ["resume_queue", (_msg: Record<string, unknown>, sessionId?: string) => {
      if (!sessionId) return
      this.drainQueue(sessionId, "completed")
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
        // Queue is the safe default while streaming. Only an explicit "interrupt"
        // aborts the current turn; legacy/unknown modes (e.g. the removed "append")
        // coerce to queue so user input is never dropped or unexpectedly destructive.
        const steerMode: "interrupt" | "queue" = msg.mode === "interrupt" ? "interrupt" : "queue"
        const steerPrompt = {
          id: `steer-${crypto.randomUUID()}`,
          text,
          attachments: validated,
          mode: steerMode,
          timestamp: Date.now(),
          sessionId,
          userMessageId: msg.userMessageId as string | undefined,
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

  constructor(private opts: WebviewEventRouterOptions) {
    this.ptyRouter = new PtyRouter({
      sessionManager: opts.sessionManager,
      postMessage: opts.postMessage,
    })
    for (const [key, handler] of this.ptyRouter.getHandlers()) {
      this.webviewHandlers.set(key, handler as (msg: Record<string, unknown>, sessionId?: string) => void | Promise<void>)
    }
  }

  /**
   * Initialize the router: restore host queue state and wire queue drain callback.
   * Call once after construction.
   */
  public initialize(): void {
    this.opts.hostQueue.restore()
    this.opts.streamCoordinator.onQueueDrain = (tabId, reason) => this.drainQueue(tabId, reason)
  }

  /**
   * Drain the host queue for a session after a stream completes.
   * If queue.drainAfterAbort is false (default) and reason is "aborted", skip.
   */
  private drainQueue(sessionId: string, reason?: string): void {
    if (!this.opts.hostQueue.hasQueued(sessionId)) return

    // Remove any stuck "sending" items back to "queued" for recovery
    this.opts.hostQueue.markStuckSendingAsQueued(sessionId)

    // If aborted and drainAfterAbort is not set, skip
    if (reason === "aborted" && !this.drainAfterAbort) {
      // Still push the state so UI shows queued items with a hint
      this.postQueueState(sessionId)
      return
    }

    const next = this.opts.hostQueue.dequeue(sessionId)
    if (!next) {
      this.postQueueState(sessionId)
      return
    }

    log.info(`Draining host queue for ${sessionId}: sending queued prompt ${next.id}`)
    this.opts.postMessage({ type: "prompt_queued", sessionId, itemId: next.id })

    // Send the queued prompt as a startPrompt call — bypasses promptsInFlight
    this.drainQueuedPrompt(sessionId, next)
  }

  /**
   * Send a queued prompt directly via StreamCoordinator, bypassing the promptsInFlight guard.
   * Records the user message in SessionStore so it survives reloads.
   * Reuses the userMessageId stored on the QueuedPrompt at queue-time if available,
   * so the message already appended by handleQueue is updated in-place, not duplicated.
   */
  private async drainQueuedPrompt(sessionId: string, item: {
    id: string
    text: string
    attachments: import("./webview/types").Attachment[]
    isSteerPrompt?: boolean
    userMessageId?: string
  }): Promise<void> {
    try {
      const userMessageId = item.userMessageId || generateUserMessageId()
      const clientRequestId = `queued-${item.id}`
      const textBlocks: Block[] = item.text.trim() ? [{ type: "text", text: item.text }] : []
      const imageBlocks: Block[] = (item.attachments || []).map((a: { data: string; mimeType: string }) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }))
      const currentTabForMode = this.opts.tabManager.getTab(sessionId)
      const userMsg: import("./types").ChatMessage = {
        role: "user",
        id: userMessageId,
        blocks: [...textBlocks, ...imageBlocks],
        timestamp: Date.now(),
        sessionId,
        mode: currentTabForMode?.mode,
      }
      this.opts.sessionStore.appendMessage(sessionId, userMsg)
      this.opts.postMessage({ type: "add_message", sessionId, message: userMsg })
      await this.opts.streamCoordinator.startPrompt({
        tabId: sessionId,
        text: item.text,
        callbacks: {
          postMessage: (m) => this.opts.postMessage(m),
          postRequestError: (m) => this.opts.postRequestError(m),
        },
        attachments: item.attachments,
        identity: { userMessageId, clientRequestId },
      })
      this.opts.hostQueue.confirmCompleted(sessionId, item.id)
      this.postQueueState(sessionId)
    } catch (err) {
      log.error(`Failed to send queued prompt ${item.id}: ${err}`)
      this.opts.hostQueue.markFailed(sessionId, item.id, err instanceof Error ? err.message : String(err))
      this.postQueueState(sessionId)
      this.opts.postRequestError(`Failed to send queued prompt: ${err instanceof Error ? err.message : String(err)}`, sessionId)
    }
  }

  /**
   * Push the current queue state to the webview for UI updates.
   */
  private postQueueState(sessionId: string): void {
    const items = this.opts.hostQueue.getAll(sessionId).map((item, index) => ({
      id: item.id,
      text: item.text,
      state: item.state === "sending" ? "sending" as const
        : item.state === "completed" ? "completed" as const
        : item.state === "failed" ? "failed" as const
        : "queued" as const,
      attachments: item.attachments || [],
      isSteerPrompt: item.isSteerPrompt,
      createdAt: item.createdAt,
      error: item.error,
      position: index,
      estimatedTokens: Math.ceil(item.text.length / 4),
    }))
    this.opts.postMessage({ type: "queue_state", sessionId, items })
  }

  /** Whether the host queue should drain after abort — reads from HostPromptQueue */
  private get drainAfterAbort(): boolean {
    return this.opts.hostQueue.drainAfterAbort
  }

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
    "init_state", "stream_start", "stream_end", "stream_tool_start", "stream_tool_partial", "stream_tool_end",
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
   *
   * NOTE: Only image MIME types are supported as base64 attachments. Document files
   * (text/markdown, text/plain, etc.) are decoded and injected into the prompt text
   * by the webview before sending, so they never reach this validation path.
   */
  // NOTE: SVG (image/svg+xml) is kept in the allowlist for consistency, but the
  // webview treats it as a document attachment (decoded & injected as text) so it
  // never reaches the server as a file part — the server's Image.normalize cannot
  // decode SVG with a raster decoder.
  private static readonly ATTACHMENT_MIME_ALLOWLIST = new Set([
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml",
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

  /**
   * Resolve a changed file's before (git baseline) / after (current workspace)
   * content — the source for hunk computation and reverts. Uses session-aware
   * baseline resolution via SessionBaselineResolver.
   */
  private async getFileBeforeAfter(filePath: string, sessionId?: string): Promise<{ before: string; after: string } | null> {
    const sid = sessionId ?? this.opts.sessionStore.activeId ?? ""
    const wsRoot = this.opts.sessionStore.getSessionDirectory(sid)
    if (!wsRoot) return null

    // Resolve baseline content via SessionBaselineResolver
    const before = await getBaselineContent(sid, filePath, {
      sessionStore: this.opts.sessionStore,
      checkpointManager: this.opts.checkpointManager,
      execSync,
      log: { debug: (msg) => log.debug(msg), warn: (msg) => log.warn(msg), info: (msg) => log.info(msg) },
    })

    let after = ""
    try {
      const doc = await vscode.workspace.openTextDocument(this.resolveWorkspaceUri(filePath, wsRoot))
      after = doc.getText()
    } catch {
      // File deleted / unreadable — after stays "".
    }
    return { before, after }
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

  private async resolveOpenFileTarget(rawPath: string, sessionId?: string): Promise<{ uri: vscode.Uri; lineNumber?: number; columnNumber?: number }> {
    const parsed = this.parseOpenFileTarget(rawPath)
    const roots = this.getOpenFileRoots(sessionId)
    const filePath = this.expandHomePath(parsed.filePath)

    if (path.isAbsolute(filePath)) {
      const absolutePath = path.resolve(filePath)
      const realPath = this.resolveRealPath(absolutePath)
      if (roots.length > 0 && !roots.some(root => this.isPathInsideRoot(realPath, root))) {
        log.warn(`Opening "${rawPath}" which is outside the session workspace`)
      }
      const uri = vscode.Uri.file(realPath)
      await this.assertOpenableFile(uri, rawPath)
      return { uri, lineNumber: parsed.lineNumber, columnNumber: parsed.columnNumber }
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
        return { uri, lineNumber: parsed.lineNumber, columnNumber: parsed.columnNumber }
      }
    }

    throw new Error(`File "${parsed.filePath}" was not found under the session workspace or open workspace folders`)
  }

  private parseOpenFileTarget(rawPath: string): { filePath: string; lineNumber?: number; columnNumber?: number } {
    // Strip a file:// scheme prefix and decode to a filesystem path — model
    // output may emit file:// URIs for absolute paths.
    let working = rawPath
    if (/^file:\/\//i.test(working)) {
      try {
        working = vscode.Uri.parse(working).fsPath
      } catch {
        // fall through with the raw string
      }
    }

    // Form 1: #L42 or #L42:7 fragment (existing, extended with column)
    const fragmentIdx = working.indexOf("#")
    if (fragmentIdx >= 0) {
      const fragment = working.slice(fragmentIdx + 1)
      const m = fragment.match(/^L(\d+)(?::(\d+))?$/i)
      if (m) {
        const line = Number.parseInt(m[1] ?? "0", 10)
        const col = m[2] ? Number.parseInt(m[2], 10) : undefined
        return {
          filePath: working.slice(0, fragmentIdx),
          lineNumber: line > 0 ? line : undefined,
          columnNumber: col && col > 0 ? col : undefined,
        }
      }
    }

    // Form 2: trailing :LINE or :LINE:COL (Cursor / Claude Code style).
    // Only treat as a line ref when the prefix looks like a file path
    // (contains a path separator or a dotted extension), to avoid false
    // positives like "localhost:8080" or "package:12".
    const trailing = working.match(/^(.+?):(\d+)(?::(\d+))?$/)
    if (trailing) {
      const filePath = trailing[1] ?? ""
      if (filePath && (/[\\/]/.test(filePath) || /\.[A-Za-z0-9]{1,8}$/.test(filePath))) {
        const line = Number.parseInt(trailing[2] ?? "0", 10)
        const col = trailing[3] ? Number.parseInt(trailing[3], 10) : undefined
        return {
          filePath,
          lineNumber: line > 0 ? line : undefined,
          columnNumber: col && col > 0 ? col : undefined,
        }
      }
    }

    return { filePath: working }
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
      .map(root => this.resolveRealPath(path.resolve(root)))
      .filter(root => {
        const key = this.normalizeFsPath(root)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  /**
   * Resolve a filesystem path to its canonical form by following symlinks.
   * This ensures that workspace boundary checks compare canonical paths,
   * not lexical ones — a symlinked workspace root (e.g. /home/user/proj →
   * /data/projects/proj) would otherwise cause valid in-workspace files to
   * be rejected because path.resolve() does NOT resolve symlinks.
   *
   * Falls back to path.resolve() when the file doesn't exist yet (new files,
   * deleted files, permission issues) — in that case there's no symlink to
   * follow, so the lexical path is the best we can do.
   */
  private resolveRealPath(filePath: string): string {
    try {
      return realpathSync(filePath)
    } catch {
      return path.resolve(filePath)
    }
  }

  private isPathInsideRoot(filePath: string, rootPath: string): boolean {
    const realFile = this.resolveRealPath(filePath)
    const realRoot = this.resolveRealPath(rootPath)
    const relative = path.relative(realRoot, realFile)
    return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  }

  /**
   * Resolve a file path (absolute or relative) to a VS Code Uri against the
   * workspace root. Absolute paths are used directly (with realpath
   * resolution); relative paths are joined with wsRoot. This fixes the bug
   * where `vscode.Uri.joinPath(wsRoot, absolutePath)` creates a broken path
   * like `/wsRoot//absolute/path`.
   */
  private resolveWorkspaceUri(filePath: string, wsRoot: string): vscode.Uri {
    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(this.resolveRealPath(filePath))
    }
    return vscode.Uri.joinPath(vscode.Uri.file(wsRoot), filePath)
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
      this.opts.statePush.pushCommandListToWebview(customCommands, true)
      return
    }
    try {
      const [commands, skills] = await Promise.all([
        this.opts.sessionManager.listCommands(),
        this.opts.sessionManager.listSkills(),
      ])
      this.opts.statePush.pushCommandListToWebview([...customCommands, ...commands, ...skills])
    } catch (err) {
      log.warn("Failed to list commands", err)
      this.opts.statePush.pushCommandListToWebview(customCommands, true)
    }
  }

  private async resolveAllSkills(): Promise<Array<{ id: string; name: string; description: string; category: string; enabled: boolean }>> {
    // Dedup by a composite key (source-prefix + id) so a local skill with the
    // same name as a server agent is NOT silently dropped — they are distinct
    // skills with independent toggle state.
    const seen = new Set<string>()
    const skills: Array<{ id: string; name: string; description: string; category: string; enabled: boolean }> = []
    const prefs = this.opts.skillPreferences

    // API agents (server-managed, only when server is up)
    if (this.opts.sessionManager.isRunning) {
      try {
        const directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        const agents = await this.opts.sessionManager.listAgents(directory)
        for (const a of agents) {
          const key = `server:${a.name}`
          if (seen.has(key)) continue
          seen.add(key)
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
        const key = `local:${s.id}`
        if (seen.has(key)) continue
        seen.add(key)
        skills.push({ id: s.id, name: s.name, description: s.description, category: s.category, enabled: prefs.isEnabled(s.id) })
      }
    } catch (err) {
      log.warn("Failed to scan local skills", err)
    }

    return skills
  }
}
