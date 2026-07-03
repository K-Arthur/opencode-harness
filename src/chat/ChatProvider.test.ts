import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const source = readFileSync(resolve(__dirname, "ChatProvider.ts"), "utf8")
const utilsSource = readFileSync(resolve(__dirname, "chatUtils.ts"), "utf8")
const lifecycleSource = readFileSync(resolve(__dirname, "SessionLifecycleService.ts"), "utf8")
const commandExecSource = readFileSync(resolve(__dirname, "CommandExecutionService.ts"), "utf8")
const eventRouterSource = readFileSync(resolve(__dirname, "WebviewEventRouter.ts"), "utf8")
const validatorSource = readFileSync(resolve(__dirname, "WebviewMessageValidator.ts"), "utf8")
const backfillSource = readFileSync(resolve(__dirname, "BackfillService.ts"), "utf8")
const modePolicySource = readFileSync(resolve(__dirname, "modePolicy.ts"), "utf8")
const rateLimitMonitorSource = readFileSync(resolve(__dirname, "../monitor/RateLimitMonitor.ts"), "utf8")
const providerManagementSource = readFileSync(resolve(__dirname, "ProviderManagementService.ts"), "utf8")

void describe("ChatProvider.ts", () => {
  void it("exports ChatProvider class with correct interfaces", () => {
    assert.ok(source.includes("export class ChatProvider"), "ChatProvider class must be exported")
    assert.ok(
      source.includes("implements vscode.WebviewViewProvider, vscode.Disposable"),
      "ChatProvider must implement WebviewViewProvider and Disposable"
    )
  })

  void it("has expected public methods", () => {
    assert.ok(source.includes("resolveWebviewView("), "must have resolveWebviewView method")
    assert.ok(source.includes("sendPromptToWebview("), "must have sendPromptToWebview method")
    assert.ok(source.includes("dispose()"), "must have dispose method")
  })

  void it("wires setupVoiceInput to the local tool setup planner", () => {
    assert.ok(source.includes("buildVoiceSetupPlan"), "setupVoiceInput must build the recorder/STT setup plan")
    assert.ok(source.includes("selectRecorderPlan"), "setupVoiceInput must detect the local recorder")
    assert.ok(source.includes("selectTranscriberPlan"), "setupVoiceInput must detect the local STT engine")
    assert.ok(source.includes("createTerminal(\"OpenCode Voice Setup\")"), "setupVoiceInput must offer runnable setup in a terminal")
    assert.ok(!source.includes("voice_open_settings"), "setupVoiceInput must not post the removed dead settings message")
  })

  void it("has expected private methods and key patterns", () => {
    assert.ok(source.includes("private async handleWebviewMessage("), "must have handleWebviewMessage")
    assert.ok(source.includes("private handleServerEvent("), "must have handleServerEvent")
    assert.ok(/\s*postMessage\(/.test(source), "must have postMessage")
    assert.ok(source.includes("private postRequestError("), "must have postRequestError")
  })

  void it("suppresses the expected abort error for an intentionally-aborted tab", () => {
    // The server emits MessageAbortedError on the SSE stream a beat after Stop /
    // interrupt-and-send. The server_error handler must swallow it (no error card,
    // no state teardown) for the tab that was just aborted, before any postRequestError.
    assert.ok(source.includes("isAbortErrorValue(raw)"), "server_error must classify abort-category errors")
    assert.ok(
      source.includes("this.streamCoordinator.wasIntentionallyAborted("),
      "server_error must consult the intentional-abort window",
    )
    const handlerIdx = source.indexOf('["server_error"')
    const suppressIdx = source.indexOf("wasIntentionallyAborted(", handlerIdx)
    const postErrorIdx = source.indexOf("this.postRequestError(", handlerIdx)
    assert.ok(handlerIdx >= 0 && suppressIdx > handlerIdx, "suppression check must live in the server_error handler")
    assert.ok(suppressIdx < postErrorIdx, "abort suppression must run BEFORE postRequestError")
    assert.ok(
      utilsSource.includes("export function isAbortErrorValue("),
      "isAbortErrorValue must be a shared chatUtils helper",
    )
  })

  void it("warms the server lazily when the chat view is resolved (R3)", () => {
    assert.ok(source.includes("setServerWarmup("), "must expose setServerWarmup for the host to wire lazy start")
    const resolveIdx = source.indexOf("resolveWebviewView(")
    assert.ok(resolveIdx >= 0, "resolveWebviewView must exist")
    const resolveBody = source.slice(resolveIdx, resolveIdx + 1200)
    assert.ok(
      resolveBody.includes("this.serverWarmup?.()"),
      "resolveWebviewView must invoke the warm-up hook so opening the view spawns the server",
    )
  })

  void it("correlates abort suppression by the server message id carried on the event", () => {
    // Timing-independent correlation: the handler must extract the server message id
    // from the event payload and pass it to wasIntentionallyAborted so a late abort
    // error is suppressed regardless of how long after the abort it lands.
    const handlerIdx = source.indexOf('["server_error"')
    assert.ok(handlerIdx >= 0, "server_error handler must exist")
    const handlerBody = source.slice(handlerIdx, handlerIdx + 2000)
    assert.ok(
      /messageId\??:\s*unknown/.test(handlerBody) && handlerBody.includes("data?.messageId"),
      "must read messageId off the server_error event data",
    )
    assert.ok(
      handlerBody.includes("wasIntentionallyAborted(abortTabId, serverMessageId)"),
      "must pass the extracted serverMessageId into wasIntentionallyAborted",
    )
  })

  void it("treats tool_update as a high-frequency server event", () => {
    assert.ok(
      source.includes('event.type === "tool_update"'),
      "tool_update bursts must use high-frequency buffering/logging rules",
    )
  })

  void it("contains VALID_WEBVIEW_TYPES static set with known message types", () => {
    assert.ok(source.includes("static readonly VALID_WEBVIEW_TYPES") || eventRouterSource.includes("static readonly VALID_WEBVIEW_TYPES"), "VALID_WEBVIEW_TYPES must exist")
    assert.ok(source.includes("send_prompt") || eventRouterSource.includes("send_prompt"), "must include send_prompt")
    assert.ok(source.includes("accept_diff") || eventRouterSource.includes("accept_diff"), "must include accept_diff")
    assert.ok(source.includes("reject_diff") || eventRouterSource.includes("reject_diff"), "must include reject_diff")
    assert.ok(source.includes("webview_ready") || eventRouterSource.includes("webview_ready"), "must include webview_ready")
  })

  void it("contains unified host/chunk batching and prompt-in-flight guards", () => {
    assert.ok(source.includes("promptsInFlight = new Set") || eventRouterSource.includes("promptsInFlight = new Set"), "promptInFlight guard must exist")
    assert.ok(source.includes("private messageBatcher = this.createHostMessageBatcher()"), "single messageBatcher must exist")
    assert.ok(source.includes("import { HostMessageBatcher } from"), "HostMessageBatcher must be imported")
    assert.ok(!source.includes("import { ChunkBatcher } from"), "ChatProvider must not keep a second chunk batcher import")
    assert.ok(source.includes("private earlyMessageQueue") || eventRouterSource.includes("earlyMessageQueue"), "earlyMessageQueue must exist")
  })

  void it("imports ChatMessage and Block from ./types", () => {
    assert.ok(source.includes("import { ChatMessage } from \"./types\"") || source.includes("import { ChatMessage, Block } from \"./types\""), "must import ChatMessage from types")
  })

  void it("imports and uses MessageRouter for model and permission routing", () => {
    assert.ok(source.includes("import { MessageRouter } from \"./handlers/MessageRouter\""), "must import MessageRouter")
    assert.ok(source.includes("new MessageRouter("), "must instantiate MessageRouter")
  })

  void it("imports and uses ChatCommands for slash command handling", () => {
    assert.ok(source.includes("import { ChatCommands } from \"./ChatCommands\""), "must import ChatCommands")
    assert.ok(source.includes("new ChatCommands("), "must instantiate ChatCommands")
  })

  void it("imports and uses AutoCompactor for automatic context compaction", () => {
    assert.ok(source.includes("import { AutoCompactor } from \"./AutoCompactor\""), "must import AutoCompactor")
    assert.ok(source.includes("new AutoCompactor("), "must instantiate AutoCompactor")
  })

  void it("imports and uses ChatFileOps for file and cursor operations", () => {
    assert.ok(source.includes("import { ChatFileOps } from \"./ChatFileOps\""), "must import ChatFileOps")
  })

  void it("imports and uses WorkspaceFileIndex for workspace file indexing", () => {
    assert.ok(source.includes("import { WorkspaceFileIndex } from \"./WorkspaceFileIndex\""), "ChatProvider must import WorkspaceFileIndex")
    assert.ok(source.includes("new WorkspaceFileIndex("), "ChatProvider must instantiate WorkspaceFileIndex")
    assert.ok(source.includes("workspaceFileIndex.watch()"), "ChatProvider must start watching workspace file changes")
  })

  void it("tracks the active editor and posts active_file messages", () => {
    assert.ok(
      source.includes("import { ActiveFileTracker } from \"./ActiveFileTracker\""),
      "ChatProvider must import ActiveFileTracker",
    )
    assert.ok(
      source.includes("new ActiveFileTracker("),
      "ChatProvider must instantiate ActiveFileTracker",
    )
    assert.ok(
      source.includes("this.activeFileTracker.start()"),
      "ChatProvider must start the ActiveFileTracker in resolveWebviewView",
    )
    assert.ok(
      source.includes('type: "active_file"') || source.includes("ActiveFileTracker"),
      "ChatProvider must delegate active_file tracking to ActiveFileTracker",
    )
  })

  void it("delegates message validation guards for send_prompt and mention_search", () => {
    assert.ok(source.includes('msg.type === "send_prompt"') || eventRouterSource.includes('"send_prompt"'), "must handle send_prompt")
    assert.ok(source.includes('msg.type === "mention_search"') || eventRouterSource.includes('"mention_search"'), "must handle mention_search")
    assert.ok(eventRouterSource.includes("validateWebviewMessage"), "WebviewEventRouter must delegate validation")
    assert.ok(validatorSource.includes("text.length > 1_000_000"), "must reject oversized prompts")
    assert.ok(
      validatorSource.includes('invalidOptionalString(msg, "query", "Rejected oversized mention search query", deps, 500)'),
      "must reject oversized mention queries"
    )
  })

  void it("delegates auto compaction to AutoCompactor", () => {
    // The earlier autoCompactIfIdle() wrapper was dead code (declared but
    // never called) so we removed it; the only real trigger path is the
    // contextMonitor.onContextChanged listener invoking tryCompactIfNeeded
    // directly.
    assert.ok(source.includes("this.autoCompactor.tryCompactIfNeeded"), "must delegate to AutoCompactor")
    assert.ok(source.includes("onContextChanged"), "must trigger auto compaction from context-usage events")
    // Cross-tab safety: the trigger must pass the firing sessionId so a
    // background tab's >=80% event can't compact the active tab.
    assert.match(
      source,
      /tryCompactIfNeeded\s*\([\s\S]{0,400}sessionId:\s*usage\.sessionId/,
      "tryCompactIfNeeded must be called with the firing usage.sessionId for cross-tab safety",
    )
  })

  void it("delegates slash commands to ChatCommands", () => {
    assert.ok(source.includes("chatCommands.clear(") || commandExecSource.includes("chatCommands.clear("), "must delegate clear to ChatCommands")
    assert.ok(source.includes("chatCommands.cost(") || commandExecSource.includes("chatCommands.cost("), "must delegate cost to ChatCommands")
    assert.ok(source.includes("chatCommands.continue(") || commandExecSource.includes("chatCommands.continue("), "must delegate continue to ChatCommands")
    assert.ok(source.includes("chatCommands.help(") || commandExecSource.includes("chatCommands.help("), "must delegate help to ChatCommands")
  })

  void it("routes local slash commands before server commands", () => {
    assert.ok(source.includes("handleLocalSlashCommand(") || commandExecSource.includes("handleLocalSlashCommand("), "must check local slash commands first")
    assert.ok(source.includes("case \"cost\"") || commandExecSource.includes("case \"cost\""), "must handle /cost locally")
    assert.ok(source.includes("case \"clear\"") || commandExecSource.includes("case \"clear\""), "must handle /clear locally")
    assert.ok(source.includes("sendCommand(tab.cliSessionId!, commandName") || commandExecSource.includes("sendCommand(tab.cliSessionId!, commandName"), "server commands must be sent without a leading slash")
  })

  void it("contains toUserErrorMessage with common error patterns", () => {
    assert.ok(source.includes("private toUserErrorMessage("), "must have toUserErrorMessage")
    assert.ok(source.includes("server not running") || utilsSource.includes("server not running"), "must handle server not running errors")
    assert.ok(source.includes("timeout|did not start") || utilsSource.includes("timeout|did not start"), "must handle timeout errors")
  })

  void it("contains edit_message handler for message editing", () => {
    assert.ok(source.includes('"edit_message"') || eventRouterSource.includes('"edit_message"'), "must include edit_message in VALID_WEBVIEW_TYPES")
    assert.ok(source.includes("handleEditMessage("), "must have handleEditMessage method")
    assert.ok(source.includes("edit_message_prefill"), "must send edit_message_prefill to webview")
  })

  void it("handles_image_paste_with_base64_encoding", () => {
    assert.ok(source.includes('"attach_image"') || eventRouterSource.includes('"attach_image"'), "VALID_WEBVIEW_TYPES must include attach_image")
    assert.ok(source.includes("attach_image") || eventRouterSource.includes("attach_image"), "handleWebviewMessage must have attach_image case")
    assert.ok(source.includes("handleAttachImage("), "must have handleAttachImage method")
    assert.ok(source.includes('type: "image"') || eventRouterSource.includes('type: "image"'), "must create image block type")
    assert.ok(source.includes("data") || eventRouterSource.includes("data"), "must pass base64 data to image block")
    assert.ok(source.includes("mimeType") || eventRouterSource.includes("mimeType"), "must pass mimeType to image block")
  })

  void it("handles_image_file_attachment", () => {
    assert.ok(source.includes("handleAttachImage"), "handleAttachImage method must exist")
    assert.ok(source.includes("appendMessage") || eventRouterSource.includes("appendMessage"), "must persist image message via appendMessage")
    assert.ok(source.includes('type: "message"'), "must send message to webview with image")
  })

  void it("guards file and image attachments with security checks", () => {
    assert.ok(source.includes("checkFileSecurity") || lifecycleSource.includes("checkFileSecurity"), "must check attached files for sensitive or risky content")
    assert.ok(source.includes('"Attach All"') || lifecycleSource.includes('"Attach All"'), "must allow explicit override for risky file attachments")
    assert.ok(source.includes('"Review Files"') || lifecycleSource.includes('"Review Files"'), "must allow reviewing risky file attachments")
    assert.ok(source.includes("10 * 1024 * 1024") || lifecycleSource.includes("10 * 1024 * 1024"), "must reject images larger than 10MB")
  })

  void it("contains mapToolType for type categorization", () => {
    assert.ok(source.includes("private mapToolType("), "must have mapToolType")
    assert.ok(source.includes('return "write"') || utilsSource.includes('return "write"'), "must classify write tools")
    assert.ok(source.includes('return "exec"') || utilsSource.includes('return "exec"'), "must classify exec tools")
    assert.ok(source.includes('return "read"') || utilsSource.includes('return "read"'), "must classify read tools")
  })

  void it("stream_end_triggers_notification_when_webview_not_visible", () => {
    // notifyTurnComplete was replaced by notifyTurnOutcome which distinguishes
    // success/error, shows session title, and sends a webview toast.
    assert.ok(
      source.includes("notifyTurnOutcome") || source.includes("notifyTurnComplete"),
      "must have turn-complete or turn-outcome notification method"
    )
    assert.ok(
      source.includes('"Open Chat"') || source.includes("'Open Chat'"),
      "must have Open Chat button action in VS Code notification"
    )
    assert.ok(
      source.includes("showInformationMessage") && source.includes("showErrorMessage"),
      "must show info for success and error for failures"
    )
  })

  // Switching to Auto is treated as consent — the native warning modal was
  // removed (it blocked the workbench on Linux and gated the switch). No
  // confirmation prompt, no persisted "confirmed" flag, no AutoModeService.
  void it("auto_mode_switches_without_confirmation", () => {
    assert.ok(!source.includes("AutoModeService"), "AutoModeService must be removed")
    assert.ok(!source.includes("hasAutoModeConfirmed"), "host must not gate auto mode behind a confirmation flag")
    assert.ok(!source.includes("showAutoModeConfirmation"), "host must not show an auto-mode confirmation modal")
    assert.ok(!eventRouterSource.includes("showAutoModeConfirmation"), "router must not call an auto-mode confirmation modal")
    assert.ok(!eventRouterSource.includes("hasAutoModeConfirmed"), "router must not gate the change_mode handler on a confirmation flag")
  })

  void it("has session lifecycle methods", () => {
    assert.ok(source.includes("ensureLocalTab("), "must have ensureLocalTab")
    assert.ok(source.includes("handleResumeSession("), "must have handleResumeSession")
    assert.ok(source.includes("syncActiveSession("), "must have syncActiveSession")
    assert.ok(source.includes("handleCompactSession("), "must have handleCompactSession")
  })

  void it("has file and attachment methods", () => {
    assert.ok(source.includes("handleAttachFiles("), "must have handleAttachFiles")
    assert.ok(source.includes("handleInsertAtCursor("), "must have handleInsertAtCursor")
    assert.ok(source.includes("handleCreateFileFromCode("), "must have handleCreateFileFromCode")
    assert.ok(source.includes("languageExtension("), "must have languageExtension")
  })

  void it("has webview state push methods", () => {
    assert.ok(source.includes("pushThemeToWebview("), "must have pushThemeToWebview")
    assert.ok(source.includes("pushModelToWebview("), "must have pushModelToWebview")
    assert.ok(source.includes("pushModelListToWebview("), "must have pushModelListToWebview")
    assert.ok(source.includes("pushInitStateToWebview("), "must have pushInitStateToWebview")
    assert.ok(source.includes("pushAllStateToWebview("), "must have pushAllStateToWebview")
    assert.ok(source.includes("pushCommandListToWebview("), "must have pushCommandListToWebview")
  })

  void it("pushes chat font config to webview", () => {
    assert.ok(source.includes("pushChatFontConfigToWebview("), "must have pushChatFontConfigToWebview")
    assert.ok(source.includes('type: "chat_font_config"'), "must post chat_font_config message")
    assert.ok(source.includes("opencode.chat"), "must read opencode.chat configuration")
    assert.ok(source.includes("Math.max(8, Math.min(32"), "must clamp font size to 8-32")
  })

  void it("persists and restores chat text direction (RTL/LTR)", () => {
    assert.ok(source.includes("CHAT_DIRECTION_KEY"), "must define CHAT_DIRECTION_KEY")
    assert.ok(source.includes("persistChatDirection("), "must have persistChatDirection method")
    assert.ok(source.includes("pushChatDirectionToWebview("), "must have pushChatDirectionToWebview method")
    assert.ok(source.includes('type: "chat_dir_config"'), "must post chat_dir_config message")
    assert.ok(source.includes("opencode-harness.chatDirection"), "must use the chatDirection globalState key")
  })

  void it("pushVisibleStateToWebview uses lightweight sync instead of re-sending init_state", () => {
    const idx = source.indexOf("private pushVisibleStateToWebview(")
    assert.ok(idx >= 0, "pushVisibleStateToWebview must exist")
    const block = source.slice(idx, source.indexOf("private replayLiveStreamsToWebview", idx))
    assert.ok(block.includes("this.messageBatcher.flush()"), "visibility sync must flush queued messages")
    assert.ok(block.includes("this.pushModelToWebview()"), "visibility sync must refresh model state")
    assert.ok(block.includes("this.pushRateLimitStateToWebview()"), "visibility sync must refresh rate-limit state")
    assert.ok(block.includes("this.applyContextWindowFor()"), "visibility sync must refresh context window state")
    assert.ok(block.includes("this.pushContextUsageForSession(activeSessionId)"), "visibility sync must refresh current context usage")
    assert.ok(block.includes("this.replayLiveStreamsToWebview()"), "visibility sync must replay live streams")
    assert.ok(
      !block.includes("this.streamCoordinator.clearReplayDedup()"),
      "visibility sync must NOT clear replay dedup — only webview_ready should do that"
    )
    assert.ok(!block.includes("pushAllStateToWebview"), "visibility sync must not send a full init_state refresh")
    assert.ok(!block.includes("pushInitStateToWebview"), "visibility sync must not send a full init_state refresh")
  })

  void it("has command handler methods", () => {
    assert.ok(source.includes("handleExecuteCommand("), "must have handleExecuteCommand")
    // The user-initiated list_commands flow now lives in WebviewEventRouter
    // (single source of truth for webview-message routing). ChatProvider
    // still owns the silent MCP-driven refresh path.
    assert.ok(
      source.includes("refreshCommandListQuietly("),
      "ChatProvider must own the silent command-list refresh (used by MCP tools-changed)",
    )
    assert.ok(source.includes("handleClearCommand("), "must have handleClearCommand")
    assert.ok(source.includes("handleCostCommand("), "must have handleCostCommand")
    assert.ok(source.includes("handleContinueCommand("), "must have handleContinueCommand")
    assert.ok(source.includes("handleHelpCommand("), "must have handleHelpCommand")
  })

  void it("has banner methods", () => {
    assert.ok(source.includes("handleCompactBannerAction("), "must have handleCompactBannerAction")
  })

  void it("has custom prompt variable resolution", () => {
    assert.ok(source.includes("resolveCustomPromptVariables(") || commandExecSource.includes("resolveCustomPromptVariables("), "must have resolveCustomPromptVariables")
  })

  // ---- Regression: premature stream finalization (session.idle bug) ----

  void it("session_status idle finalize is gated on waitingForCompletion", () => {
    // session_status handler may invoke finalizeStream as a fallback when
    // waitingForCompletion is true (recovers from missed message_complete events).
    // It must not finalize unconditionally — that would prematurely end normal lifecycle idles.
    const sessionStatusIdx = source.indexOf('"session_status"')
    assert.ok(sessionStatusIdx >= 0, "session_status handler must exist")

    const serverStatusIdx = source.indexOf('"server_status"', sessionStatusIdx)
    assert.ok(serverStatusIdx > sessionStatusIdx, "server_status handler must follow session_status")

    const sessionStatusBlock = source.slice(sessionStatusIdx, serverStatusIdx)
    if (sessionStatusBlock.includes("finalizeStream")) {
      assert.ok(
        sessionStatusBlock.includes("waitingForCompletion"),
        "session_status finalizeStream must be gated on waitingForCompletion to avoid premature finalization"
      )
    }
  })

  void it("server_status idle finalize is gated on waitingForCompletion", () => {
    const serverStatusIdx = source.indexOf('"server_status"')
    assert.ok(serverStatusIdx >= 0, "server_status handler must exist")

    const permissionIdx = source.indexOf('"permission_request"', serverStatusIdx)
    assert.ok(permissionIdx > serverStatusIdx, "permission_request handler must follow server_status")

    const serverStatusBlock = source.slice(serverStatusIdx, permissionIdx)
    if (serverStatusBlock.includes("finalizeStream")) {
      assert.ok(
        serverStatusBlock.includes("waitingForCompletion"),
        "server_status finalizeStream must be gated on waitingForCompletion"
      )
    }
  })

  void it("message_complete handler triggers guarded stream finalization", () => {
    const msgCompleteIdx = source.indexOf('"message_complete"')
    assert.ok(msgCompleteIdx >= 0, "message_complete handler must exist")

    const sessionStatusIdx = source.indexOf('"session_status"', msgCompleteIdx)
    assert.ok(sessionStatusIdx > msgCompleteIdx, "session_status must follow message_complete")

    const msgCompleteBlock = source.slice(msgCompleteIdx, sessionStatusIdx)
    assert.ok(
      msgCompleteBlock.includes("maybeFinalizeStream"),
      "message_complete handler must call maybeFinalizeStream so tool-only interim messages do not close the turn"
    )
  })

  void it("handles connect_provider from the model manager modal", () => {
    assert.ok(source.includes('"connect_provider"') || eventRouterSource.includes('"connect_provider"'), "VALID_WEBVIEW_TYPES must include connect_provider")
    assert.ok(source.includes('["connect_provider"') || eventRouterSource.includes('["connect_provider"'), "webviewHandlers must handle connect_provider")
    assert.ok(source.includes("handleConnectProvider"), "must route provider connection actions through a handler")
  })

  void it("host-created empty active sessions are included in init_state so welcome new session opens a tab", () => {
    const idx = source.indexOf("private pushInitStateToWebview(")
    assert.ok(idx >= 0, "pushInitStateToWebview must exist")
    const block = source.slice(idx, source.indexOf("private pushAllStateToWebview", idx))
    assert.ok(
      block.includes("storeActive") && block.includes("restorable.push(storeActive"),
      "pushInitStateToWebview must include the active SessionStore session even when it has no messages"
    )
  })

  void it("close_tab deletes opened-but-unused empty sessions from SessionStore", () => {
    const idx = source.indexOf('["close_tab"')
    assert.ok(idx >= 0 || eventRouterSource.indexOf('["close_tab"') >= 0, "close_tab handler must exist")
    const src = idx >= 0 ? source : eventRouterSource
    const actualIdx = src.indexOf('["close_tab"')
    const block = src.slice(actualIdx, src.indexOf('["switch_tab"', actualIdx))
    assert.ok(block.includes("deleteIfEmpty"), "close_tab must call sessionStore.deleteIfEmpty for empty sessions")
    assert.ok(block.includes("closeTab(sessionId)"), "close_tab must still close the visual tab")
  })

  void it("close_tab clears SessionStore active state when the last active tab is closed", () => {
    const idx = eventRouterSource.indexOf('["close_tab"')
    assert.ok(idx >= 0, "close_tab handler must exist")
    const block = eventRouterSource.slice(idx, eventRouterSource.indexOf('["switch_tab"', idx))

    assert.ok(block.includes("wasActive"), "close_tab must capture whether the closing tab was active")
    assert.ok(block.includes("tabManager.getActiveId()"), "close_tab must inspect the next open tab after close")
    assert.ok(block.includes("sessionStore.clearActive()"), "close_tab must clear active session when no open tab remains")
  })

  void it("pushInitStateToWebview scopes restored open tabs to the current workspace", () => {
    const idx = source.indexOf("private pushInitStateToWebview(")
    assert.ok(idx >= 0, "pushInitStateToWebview must exist")
    const block = source.slice(idx, source.indexOf("private pushAllStateToWebview", idx))
    assert.ok(block.includes("isSessionInCurrentWorkspace"), "restored tabs must be filtered by workspace")
    assert.ok(block.includes("restoreOpenTabs"), "restoring open tabs must be guarded by the configuration setting")
  })

  void it("pushInitStateToWebview de-dupes restored tab aliases that point at the same CLI session", () => {
    const idx = source.indexOf("private pushInitStateToWebview(")
    assert.ok(idx >= 0, "pushInitStateToWebview must exist")
    const block = source.slice(idx, source.indexOf("private pushAllStateToWebview", idx))
    assert.ok(block.includes("markRestorableSession"), "restored sessions must be marked through a single alias-aware helper")
    assert.ok(block.includes("aliasToSessionId"), "restored active tab aliases must resolve to canonical session ids")
    assert.ok(block.includes("tab.cliSessionId"), "open tabs must be de-duped by CLI session id as well as local tab id")
  })

  void it("pushInitStateToWebview does not auto-select a closed historical active session", () => {
    const idx = source.indexOf("private pushInitStateToWebview(")
    assert.ok(idx >= 0, "pushInitStateToWebview must exist")
    const block = source.slice(idx, source.indexOf("private pushAllStateToWebview", idx))

    assert.ok(
      !block.includes("this.sessionStore.getActive()"),
      "init restore must not call getActive(), because getActive() auto-selects history and can reopen a closed tab",
    )
    assert.ok(
      block.includes("this.sessionStore.activeId") && block.includes("this.sessionStore.get("),
      "init restore should only read the explicitly active session id",
    )
  })

  void it("handles personalized theme customizer messages", () => {
    assert.ok(source.includes('"get_theme_config"') || eventRouterSource.includes('"get_theme_config"'), "VALID_WEBVIEW_TYPES must include get_theme_config")
    assert.ok(source.includes('"update_theme_config"') || eventRouterSource.includes('"update_theme_config"'), "VALID_WEBVIEW_TYPES must include update_theme_config")
    assert.ok(source.includes("pushThemeConfigToWebview") || lifecycleSource.includes("pushThemeConfigToWebview"), "must send current theme config to the webview")
    assert.ok(source.includes("handleUpdateThemeConfig") || eventRouterSource.includes("handleUpdateThemeConfig"), "must persist customized theme config")
  })
})

// ── change_mode: webview-driven mode selection ─────────────────────
// The webview sends { type: "change_mode", mode: "plan" | "build" | "auto", sessionId }.
// The handler must use msg.mode directly. Plan-mode tool-disabling is done
// in StreamCoordinator.startPrompt, not here.

function findChangeModeBlock(src: string): string {
  const changeIdx = src.indexOf('["change_mode"')
  const setModelIdx = src.indexOf('["set_model"', changeIdx)
  return src.slice(changeIdx, setModelIdx)
}

void it("change_mode handler reads mode from msg.mode", () => {
  const changeIdx = source.indexOf('["change_mode"')
  assert.ok(changeIdx >= 0 || eventRouterSource.indexOf('["change_mode"') >= 0, "change_mode handler must exist")
  const block = findChangeModeBlock(changeIdx >= 0 ? source : eventRouterSource)
  assert.ok(
    /normalizeSessionMode\(msg\.mode\)/.test(block),
    "change_mode handler must read and validate mode from msg.mode (the webview sends mode, not tools)"
  )
  assert.ok(
    !block.includes("msg.tools"),
    "change_mode handler must not derive mode from msg.tools — webview never sends that"
  )
})

void it("change_mode delegates to applySessionMode", () => {
  const block = findChangeModeBlock(source.indexOf('["change_mode"') >= 0 ? source : eventRouterSource)
  assert.ok(
    /applySessionMode\(sessionId,\s*mode\)/.test(block),
    "change_mode handler must delegate to applySessionMode (extracted to ChatProvider)"
  )
})

void it("applySessionMode calls tabManager.setMode and sessionStore.updateMode", () => {
  assert.ok(
    /tabManager\.setMode\(sessionId,\s*normalized\)/.test(source),
    "applySessionMode must call tabManager.setMode(sessionId, normalized)"
  )
  assert.ok(
    /sessionStore\.updateMode\(sessionId,\s*normalized\)/.test(source),
    "applySessionMode must call sessionStore.updateMode(sessionId, normalized)"
  )
})

void it("change_mode switches to auto without a confirmation gate", () => {
  const block = findChangeModeBlock(source.indexOf('["change_mode"') >= 0 ? source : eventRouterSource)
  assert.ok(
    !block.includes("hasAutoModeConfirmed") && !block.includes("showAutoModeConfirmation"),
    "switching to auto must not be gated behind a confirmation modal (consent model)"
  )
  assert.ok(
    /applySessionMode\(sessionId,\s*mode\)/.test(block),
    "auto switch must still apply the mode via applySessionMode"
  )
})

void it("accept_permission rejects mutating requests while the session is in plan mode", () => {
  const acceptIdx = eventRouterSource.indexOf('["accept_permission"')
  assert.ok(acceptIdx >= 0, "accept_permission handler must exist")
  const block = eventRouterSource.slice(acceptIdx, eventRouterSource.indexOf('["mention_search"', acceptIdx))
  assert.ok(block.includes("isPlanModeSession(sessionId)"), "accept_permission must check the session mode")
  assert.ok(block.includes("shouldRejectPlanPermissionResponse"), "plan-mode permission responses must be filtered by permission metadata")
  assert.ok(block.includes('"reject"'), "plan-mode permission requests must be rejected")
  assert.ok(block.includes("handleAcceptPermission"), "permission rejection must be sent back to the server")
})

void it("accept_permission allows plan document permission responses in plan mode", () => {
  assert.ok(
    eventRouterSource.includes("resolvePlanPermission") &&
      modePolicySource.includes('startsWith(".opencode/plans/")') &&
      modePolicySource.includes('endsWith(".md")'),
    "plan mode must allow OpenCode's .opencode/plans/*.md permission exception through the shared policy"
  )
})

void it("server permission requests reject mutating plan-mode requests before reaching the webview", () => {
  const permissionIdx = source.indexOf('["permission_request"')
  assert.ok(permissionIdx >= 0, "permission_request server handler must exist")
  const block = source.slice(permissionIdx, source.indexOf('["permission_replied"', permissionIdx))
  assert.ok(block.includes('currentTab?.mode === "plan"'), "server permission handler must inspect plan mode")
  assert.ok(block.includes("shouldAutoRejectPlanPermission"), "server permission handler must filter by permission metadata")
  assert.ok(block.includes("respondToPermission") && block.includes('"reject"'), "plan-mode server permissions must be rejected")
  assert.ok(block.indexOf("respondToPermission") < block.indexOf("postMessage"), "plan-mode rejection must happen before posting permission UI")
})

void it("server permission requests are auto-approved in auto mode without prompting", () => {
  const permissionIdx = source.indexOf('["permission_request"')
  assert.ok(permissionIdx >= 0, "permission_request server handler must exist")
  const block = source.slice(permissionIdx, source.indexOf('["permission_replied"', permissionIdx))
  assert.ok(block.includes('currentTab?.mode === "auto"'), "server permission handler must inspect auto mode")
  assert.ok(block.includes("respondToPermission") && block.includes('"once"'), "auto-mode server permissions must be approved once")
  assert.ok(block.indexOf('currentTab?.mode === "auto"') < block.indexOf("postMessage"), "auto-mode approval must happen before posting permission UI")
})

void it("server permission requests forward type and pattern metadata to the webview", () => {
  const permissionIdx = source.indexOf('["permission_request"')
  assert.ok(permissionIdx >= 0, "permission_request server handler must exist")
  const block = source.slice(permissionIdx, source.indexOf('["permission_replied"', permissionIdx))
  assert.ok(block.includes("permissionType"), "permission type must be forwarded for response-time filtering")
  assert.ok(block.includes("pattern"), "permission pattern must be forwarded for scoped approvals")
  assert.ok(block.includes("metadata"), "permission metadata must be forwarded for UI context")
})

// ── restore_checkpoint: must respect boolean return value ─────────────────
// CheckpointManager.restore() returns Promise<boolean> — false on failure.
// The handler must forward ok=false to the webview when restore returns false
// instead of always sending ok:true.

function findRestoreCheckpointBlock(src: string): string {
  const idx = src.indexOf('["restore_checkpoint"')
  const nextHandlerIdx = src.indexOf('["delete_server_session"', idx)
  return src.slice(idx, nextHandlerIdx > idx ? nextHandlerIdx : idx + 800)
}

void it("restore_checkpoint handler checks boolean return from checkpointManager.restore", () => {
  const idx = source.indexOf('["restore_checkpoint"')
  assert.ok(idx >= 0 || eventRouterSource.indexOf('["restore_checkpoint"') >= 0, "restore_checkpoint handler must exist in webviewHandlers")
  const block = findRestoreCheckpointBlock(idx >= 0 ? source : eventRouterSource)
  const lifecycleBlock = lifecycleSource
  assert.ok(
    /const\s+ok\s*=\s*await\s+this\.checkpointManager\.restore/.test(block) ||
    /ok\s*=\s*await\s+this\.checkpointManager\.restore/.test(block) ||
    /const\s+ok\s*=\s*await\s+this\.opts\.checkpointManager\.restore/.test(block) ||
    /ok\s*=\s*await\s+this\.opts\.checkpointManager\.restore/.test(block),
    "handler must capture the boolean return: const ok = await this.checkpointManager.restore(...)"
  )
  assert.ok(
    /postMessage\(\{[^}]*ok\b/.test(block),
    "handler must forward the ok value in postMessage"
  )
})

void it("restore_checkpoint does not hard-code ok:true — uses the captured boolean", () => {
  const block = findRestoreCheckpointBlock(source.indexOf('["restore_checkpoint"') >= 0 ? source : eventRouterSource)
  assert.ok(
    !block.includes("ok: true"),
    "handler must not hard-code ok: true — it must use the captured boolean from restore()"
  )
})

void it("restore_checkpoint response includes checkpointId and sessionId", () => {
  const block = findRestoreCheckpointBlock(source.indexOf('["restore_checkpoint"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("checkpointId"), "checkpoint_restored payload must include checkpointId")
  assert.ok(block.includes("sessionId"), "checkpoint_restored payload must include sessionId")
})

void it("file_edited server events register changed files in backend store before posting", () => {
  const idx = source.indexOf('["file_edited"')
  assert.ok(idx >= 0, "file_edited server-event handler must exist")
  const blockEnd = source.indexOf('["thinking"', idx)
  const block = source.slice(idx, blockEnd > idx ? blockEnd : idx + 2000)
  assert.ok(block.includes("sessionStore.addChangedFiles"), "backend handler must persist all changed files")
  assert.ok(block.indexOf("sessionStore.addChangedFiles") < block.indexOf("postMessage"), "backend store must update before webview post")
  assert.ok(!block.includes("if (!tab?.isStreaming) return"), "backend changed-file registration must not be streaming-only")
})

void it("sessionless file_edited events are credited to streaming tab, with active CLI-session fallback", () => {
  // Session-exclusivity: a file.edited event with no sessionID can't be
  // attributed by the server. The primary signal is a uniquely streaming tab.
  // After a compaction/resume cycle the local streaming flag may briefly be
  // false, so we also allow attributing to the active tab when it has a CLI
  // session (the server-side run is still attached). We still refuse to credit
  // an idle tab that has no active CLI session, preserving the original guard
  // against external tools polluting the changed-files dropdown.
  // When multiple sessions are streaming, we prefer the active tab if it's
  // one of them; otherwise we DROP rather than guess (guessing causes
  // cross-session contamination in the file changes dropdown).
  const idx = source.indexOf("private resolveSessionlessFileEditTab(")
  assert.ok(idx >= 0, "resolveSessionlessFileEditTab must exist")
  const block = source.slice(idx, idx + 2200)
  assert.ok(block.includes('event.type !== "file_edited"'), "guards to file_edited events")
  assert.ok(block.includes("getAllTabs().filter"), "must inspect streaming tabs")
  assert.ok(block.includes("liveTabs.length === 1"), "attribute uniquely streaming tab")
  assert.ok(block.includes("liveTabs.length > 1"), "must handle multiple streaming tabs")
  assert.ok(block.includes("liveTabs.includes(activeTab)"), "must prefer active tab among streaming")
  assert.ok(block.includes("getActiveTab()"), "must check active tab as fallback")
  assert.ok(block.includes("activeTab?.cliSessionId"), "active-tab fallback must require a CLI session")
  assert.ok(block.includes("Dropping sessionless file_edited"), "must log+drop ambiguous/idle sessionless edits")
})

// ── resume_server_session: open any server session from the modal ─────────
// Users need to click a server session in the unified modal and have it open.
// The backend must handle resume_server_session, create a local session entry
// via sessionStore.importOneServerSession, and call handleResumeSession.

function findResumeServerSessionBlock(src: string): string {
  const idx = src.indexOf('["resume_server_session"')
  return idx >= 0 ? src.slice(idx, idx + 1500) : ""
}

void it("resume_server_session is in VALID_WEBVIEW_TYPES", () => {
  assert.ok(
    source.includes('"resume_server_session"') || eventRouterSource.includes('"resume_server_session"'),
    "VALID_WEBVIEW_TYPES must include resume_server_session"
  )
})

void it("resume_server_session handler exists in webviewHandlers", () => {
  assert.ok(
    source.includes('["resume_server_session"') || eventRouterSource.includes('["resume_server_session"'),
    "webviewHandlers must have a resume_server_session entry"
  )
})

void it("resume_server_session calls importOneServerSession on sessionStore", () => {
  const block = findResumeServerSessionBlock(source.indexOf('["resume_server_session"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("resume_server_session"), "resume_server_session handler must exist")
  assert.ok(
    block.includes("importOneServerSession"),
    "handler must call sessionStore.importOneServerSession to create/find the local session"
  )
})

void it("resume_server_session calls handleResumeSession with the local session id", () => {
  const block = findResumeServerSessionBlock(source.indexOf('["resume_server_session"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("resume_server_session"), "resume_server_session handler must exist")
  assert.ok(
    block.includes("handleResumeSession"),
    "handler must call handleResumeSession to load the session into a tab"
  )
})

void it("resume_server_session offers to open the workspace folder when directory differs", () => {
  const block = findResumeServerSessionBlock(source.indexOf('["resume_server_session"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("resume_server_session"), "resume_server_session handler must exist")
  assert.ok(
    block.includes("vscode.openFolder") || block.includes("openFolder") || block.includes("showOpenFolderDialog") || source.includes("showOpenFolderDialog"),
    "handler must offer to open the session's workspace folder when it differs from the current one"
  )
})

// ── list_server_sessions: must show ALL sessions, not just current workspace ──
// Filtering by workspace was preventing users from seeing their CLI sessions
// from other projects. All non-subagent sessions must be returned.

function findListServerSessionsBlock(src: string): string {
  const idx = src.indexOf('["list_server_sessions"')
  return idx >= 0 ? src.slice(idx, idx + 1500) : ""
}

void it("list_server_sessions does not filter by isInCurrentWorkspace", () => {
  const block = findListServerSessionsBlock(source.indexOf('["list_server_sessions"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("list_server_sessions"), "list_server_sessions handler must exist")
  assert.ok(
    !block.includes("isInCurrentWorkspace"),
    "list_server_sessions must NOT filter by isInCurrentWorkspace — all sessions must be shown"
  )
})

void it("list_server_sessions includes isCurrentWorkspace flag in each mapped session", () => {
  const block = findListServerSessionsBlock(source.indexOf('["list_server_sessions"') >= 0 ? source : eventRouterSource)
  assert.ok(block.includes("list_server_sessions"), "list_server_sessions handler must exist")
  assert.ok(
    block.includes("isCurrentWorkspace"),
    "each mapped session must include isCurrentWorkspace flag for the UI to badge other-workspace sessions"
  )
})

// ── model selector on welcome screen ────────────────────────────────────────

void it("set_model handler persists to modelManager even without sessionId", () => {
  const src = source.indexOf('["set_model"') >= 0 ? source : eventRouterSource
  const idx = src.indexOf('["set_model"')
  assert.ok(idx >= 0, "set_model handler must exist")
  const block = src.slice(idx, idx + 300)
  assert.ok(
    block.includes("modelManager.setModel("),
    "set_model must call modelManager.setModel so global model is updated even when no session is active"
  )
})

void it("ensureLocalTab refreshes existing tab model and mode", () => {
  const chatProviderBlock = source.slice(
    source.indexOf("private ensureLocalTab("),
    source.indexOf("private async handleResumeSession(", source.indexOf("private ensureLocalTab(")),
  )
  const lifecycleSource = readFileSync(resolve(__dirname, "SessionLifecycleService.ts"), "utf8")
  const lifecycleBlock = lifecycleSource.slice(
    lifecycleSource.indexOf("private ensureLocalTab("),
    lifecycleSource.indexOf("async openSessionInWebview", lifecycleSource.indexOf("private ensureLocalTab(")),
  )

  for (const block of [chatProviderBlock, lifecycleBlock]) {
    assert.ok(block.includes("const tab ="), "ensureLocalTab must inspect an existing tab")
    assert.ok(block.includes("setModel(sessionId, nextModel)"), "existing tab model must be refreshed")
    assert.ok(block.includes("setMode(sessionId, nextMode)"), "existing tab mode must be refreshed")
  }
})

void it("pushes rate-limit state to the webview for the quota bar", () => {
  assert.ok(source.includes("rateLimitMonitor.onStateChanged"), "must subscribe to rate-limit state changes")
  const statePushSource = readFileSync(resolve(__dirname, "StatePushService.ts"), "utf8")
  assert.ok(statePushSource.includes('type: "rate_limit_state"'), "must post rate_limit_state messages")
  assert.ok(source.includes("pushRateLimitStateToWebview") || rateLimitMonitorSource.includes("getSerializableState"), "must serialize rate-limit state before posting")
})

// ── sessions_recovered: server session recovery after startup ────────────────
// After the server recovers persisted sessions, the webview must be told to
// re-render with the now-populated session list. The handler lives in
// serverEventHandlers and resets restoredTabsHydrated so the next
// pushInitStateToWebview re-reads persisted tab IDs from globalState.

void it("sessions_recovered handler exists in serverEventHandlers", () => {
  assert.ok(source.includes('["sessions_recovered"'), "serverEventHandlers must have a sessions_recovered entry")
})

void it("sessions_recovered resets restoredTabsHydrated and calls pushInitStateToWebview", () => {
  const handlerIdx = source.indexOf('["sessions_recovered"')
  assert.ok(handlerIdx >= 0, "sessions_recovered handler must exist")
  const handleServerIdx = source.indexOf("private handleServerEvent(", handlerIdx)
  assert.ok(handleServerIdx > handlerIdx, "handleServerEvent must follow sessions_recovered handler")
  const block = source.slice(handlerIdx, handleServerIdx)
  assert.ok(
    block.includes("backfillService.setHydrated(false)"),
    "must reset backfill hydration so the next pushInitStateToWebview re-reads persisted tab IDs"
  )
  assert.ok(
    block.includes("pushInitStateToWebview()"),
    "must call pushInitStateToWebview to re-push init_state with recovered sessions"
  )
})

void it("sessions_recovered sends session_list_update (not session_list) to refresh webview modal data", () => {
  const handlerIdx = source.indexOf('["sessions_recovered"')
  assert.ok(handlerIdx >= 0, "sessions_recovered handler must exist")
  const handleServerIdx = source.indexOf("private handleServerEvent(", handlerIdx)
  assert.ok(handleServerIdx > handlerIdx, "handleServerEvent must follow sessions_recovered handler")
  const block = source.slice(handlerIdx, handleServerIdx)
  // Must use session_list_update so the webview refreshes cached data
  // WITHOUT opening the modal (which would be a jarring side-effect).
  assert.ok(
    block.includes('type: "session_list_update"'),
    "must send session_list_update to silently refresh webview session data cache"
  )
  assert.ok(
    !block.includes('type: "session_list"'),
    "must NOT send session_list (which opens the modal)"
  )
  assert.ok(
    block.includes("this.sessionStore.list()"),
    "must get current session list from store to build the update"
  )
})

void it("open_file resolves through the centralized session-aware opener", () => {
  const idx = eventRouterSource.indexOf('["open_file"')
  assert.ok(idx >= 0, "open_file handler must exist")
  const block = eventRouterSource.slice(idx, idx + 500)
  assert.ok(
    block.includes("resolveOpenFileTarget(rawPath, sessionId)"),
    "open_file handler must use the shared resolver with the active session id"
  )
  assert.ok(
    eventRouterSource.includes("parseOpenFileTarget"),
    "shared opener must exist"
  )
  const hasLineFragment = eventRouterSource.includes('fragment.match(/^L(\\d+)')
  const hasColumnFragment = eventRouterSource.includes('fragment.match(/^L(\\d+)(?::(\\d+))?$')
  assert.ok(hasColumnFragment || hasLineFragment, "shared opener must parse #L12 line fragments (with optional column)")
  const hasTrailingLine = eventRouterSource.includes('trailing.match(/^(.+?):(\\d+)(?::(\\d+))?$/)') ||
    eventRouterSource.includes('trailing = working.match')
  assert.ok(hasTrailingLine, "shared opener must support :LINE and :LINE:COL trailing line refs")
  assert.ok(
    eventRouterSource.includes("this.opts.sessionStore.get(sessionId)?.workspacePath"),
    "shared opener must prefer the stored session workspace path"
  )
  assert.ok(
    eventRouterSource.includes("isPathInsideRoot") && eventRouterSource.includes("outside the session workspace"),
    "shared opener must reject out-of-workspace file opens"
  )
})

// --- Session message freshness regression tests ---

void it("backfillTabIfNeeded does not skip sessions that already have messages unless needsBackfill is false", () => {
  const idx = backfillSource.indexOf("async backfillTabIfNeeded(")
  assert.ok(idx >= 0, "backfillTabIfNeeded must exist")
  const block = backfillSource.slice(idx, idx + 1200)
  assert.ok(
    block.includes("session.messages.length > 0") && block.includes("needsBackfill"),
    "backfillTabIfNeeded must only skip sessions with messages when needsBackfill is not set — stale sessions must be refreshed"
  )
  assert.ok(
    !block.includes("session.messages.length > 0) {") && !block.includes("session.messages.length > 0)\n"),
    "backfillTabIfNeeded must not have a bare messages.length > 0 early return — must also check needsBackfill"
  )
})

void it("backfillTabIfNeeded does not query the server for webview-local placeholder ids", () => {
  const idx = backfillSource.indexOf("async backfillTabIfNeeded(")
  assert.ok(idx >= 0, "backfillTabIfNeeded must exist")
  const block = backfillSource.slice(idx, idx + 1600)
  assert.ok(
    block.includes("isLocalPlaceholderSessionId(session.cliSessionId)"),
    "webview-local session-* ids are not server ids and must not be backfilled"
  )
})

void it("backfill retry budget allows at least 4 retries over 30 seconds", () => {
  const delaysIdx = backfillSource.indexOf("BACKFILL_RETRY_DELAYS_MS")
  assert.ok(delaysIdx >= 0, "BACKFILL_RETRY_DELAYS_MS must exist")
  const lineStart = backfillSource.lastIndexOf("\n", delaysIdx) + 1
  const lineEnd = backfillSource.indexOf("\n", delaysIdx)
  const line = backfillSource.slice(lineStart, lineEnd)
  const count = (line.match(/\d+/g) || []).length
  assert.ok(count >= 4, `BACKFILL_RETRY_DELAYS_MS must have at least 4 retry delays, found ${count}: ${line.trim()}`)
})

void it("handleResumeSession does not destructively close tabs on empty backfill", () => {
  const idx = lifecycleSource.indexOf("async handleResumeSession(")
  assert.ok(idx >= 0, "handleResumeSession must exist")
  const lifecycleBlock = lifecycleSource.slice(lifecycleSource.indexOf("async handleResumeSession("), lifecycleSource.indexOf("async handleAttachFiles("))
  assert.ok(
    !lifecycleBlock.includes("closeTab"),
    "handleResumeSession must NOT call closeTab when backfill returns 0 messages"
  )
  assert.ok(
    !lifecycleBlock.includes("applyBackfilledMessages(session.id, [])"),
    "handleResumeSession must NOT call applyBackfilledMessages with empty array"
  )
})

// --- Fix E: request_more_messages falls through to server ---

void it("request_more_messages handler fetches from server when local is exhausted", () => {
  const idx = eventRouterSource.indexOf('["request_more_messages"')
  assert.ok(idx >= 0, "request_more_messages handler must exist")
  const block = eventRouterSource.slice(idx, idx + 2000)
  assert.ok(
    block.includes("sessionManager.getSessionMessages") || block.includes("sessionManager.isRunning"),
    "request_more_messages must attempt server fetch when local messages are exhausted"
  )
})

// --- Fix F: refresh_session_messages handler exists ---

void it("refresh_session_messages handler exists and fetches from server", () => {
  const idx = eventRouterSource.indexOf('["refresh_session_messages"')
  assert.ok(idx >= 0, "refresh_session_messages handler must exist in WebviewEventRouter")
  const block = eventRouterSource.slice(idx, idx + 1500)
  assert.ok(
    block.includes("getSessionMessages"),
    "refresh_session_messages must call getSessionMessages to fetch fresh data"
  )
  assert.ok(
    block.includes("applyBackfilledMessages"),
    "refresh_session_messages must apply backfilled messages to session store"
  )
  assert.ok(
    block.includes("session_messages_refreshed"),
    "refresh_session_messages must post session_messages_refreshed response to webview"
  )
})

// --- Perf: parallelized session backfill ---

void it("BACKFILL_CONCURRENCY is declared with a bounded value", () => {
  const idx = backfillSource.indexOf("BACKFILL_CONCURRENCY")
  assert.ok(idx >= 0, "BACKFILL_CONCURRENCY must be declared on BackfillService")
  const lineStart = backfillSource.lastIndexOf("\n", idx) + 1
  const lineEnd = backfillSource.indexOf("\n", idx)
  const line = backfillSource.slice(lineStart, lineEnd)
  const numMatch = line.match(/=\s*(\d+)/)
  assert.ok(numMatch, `BACKFILL_CONCURRENCY must be assigned a number, found: ${line.trim()}`)
  const value = parseInt(numMatch[1] ?? "0", 10)
  assert.ok(value >= 2 && value <= 16, `BACKFILL_CONCURRENCY=${value} must be between 2 and 16 to balance parallelism vs server load`)
})

void it("backfillRecoveredSessions processes sessions in parallel chunks", () => {
  const fnIdx = backfillSource.indexOf("async backfillRecoveredSessions(")
  assert.ok(fnIdx >= 0, "backfillRecoveredSessions must exist")
  const fnEnd = backfillSource.indexOf("scheduleBackfillRetry(", fnIdx)
  assert.ok(fnEnd > fnIdx, "scheduleBackfillRetry must follow backfillRecoveredSessions")
  const block = backfillSource.slice(fnIdx, fnEnd)

  assert.ok(
    block.includes("Promise.allSettled"),
    "backfillRecoveredSessions must use Promise.allSettled to run requests concurrently"
  )
  assert.ok(
    block.includes("BACKFILL_CONCURRENCY"),
    "backfillRecoveredSessions must consume BACKFILL_CONCURRENCY to bound parallel requests"
  )
  assert.ok(
    !/for\s*\(\s*const\s+session\s+of\s+sessionsNeedingBackfill\s*\)\s*{/.test(block),
    "backfillRecoveredSessions must NOT use a serial for...of loop directly over sessionsNeedingBackfill"
  )
})

void it("backfillRecoveredSessions guards in-progress and skips local placeholder ids", () => {
  const fnIdx = backfillSource.indexOf("async backfillRecoveredSessions(")
  assert.ok(fnIdx >= 0, "backfillRecoveredSessions must exist")
  const fnEnd = backfillSource.indexOf("scheduleBackfillRetry(", fnIdx)
  const block = backfillSource.slice(fnIdx, fnEnd)

  assert.ok(
    block.includes("backfillInProgress.has(session.id)"),
    "must check backfillInProgress before adding (concurrency-safe Set guard)"
  )
  assert.ok(
    block.includes("backfillInProgress.add(session.id)"),
    "must mark session as in-progress before awaiting"
  )
  assert.ok(
    block.includes("backfillInProgress.delete(session.id)"),
    "must clear in-progress flag in a finally block"
  )
  assert.ok(
    block.includes("selectPendingBackfill(sessions)"),
    "must skip local placeholder ids (now delegated to selectPendingBackfill, which filters them out)"
  )
})

void describe("ChatProvider token accounting — host source of truth", () => {
  void it("step_finish posts step_tokens with cumulative totals from SessionStore", () => {
    const start = source.indexOf('["step_finish"')
    assert.ok(start >= 0, "step_finish handler must exist")
    const block = source.slice(start, source.indexOf("}],", start))
    assert.ok(
      block.includes("cumulative:"),
      "step_tokens must carry cumulative session totals so the webview can SET instead of accumulate (idempotent on replay)",
    )
    assert.ok(
      block.includes("cumulativeCost:"),
      "step_tokens must carry the cumulative session cost",
    )
  })
})

// ── question.asked surfacing (Sprint 0 / B1) ────────────────────────────────
// The opencode server can emit question.asked / question.v2.asked WITHOUT a
// matching tool part (question invoked outside a tool-call context). In that
// case, the only host event that fires is the normalized `question_asked`
// (no `tool_start` with name "question" ever arrives). The webview's question
// bar is populated exclusively via the `question_asked` host message — so if
// the host only posts `{type:"message"}` from `ensureQuestionBlock`, the bar
// stays empty and the user cannot answer. ensureQuestionBlock MUST also post
// `{type:"question_asked", block, messageId}` so the existing webview handler
// at main.ts (~line 4132) fires and calls questionBar.addQuestion.

void describe("ChatProvider question.asked surfacing (B1)", () => {
  void it("ensureQuestionBlock posts question_asked in addition to the transcript message", () => {
    const idx = source.indexOf("private ensureQuestionBlock(")
    assert.ok(idx >= 0, "ensureQuestionBlock must exist")
    // Slice a generous window — the method body is small but contains the postMessage calls.
    const block = source.slice(idx, idx + 1600)
    assert.ok(
      block.includes('type: "question_asked"'),
      "ensureQuestionBlock must post {type:\"question_asked\"} so non-tool-context questions reach the question bar (B1)",
    )
    assert.ok(
      block.includes('type: "message"'),
      "ensureQuestionBlock must STILL post {type:\"message\"} so the transcript pointer card renders",
    )
    // Order check: the transcript message must post first (so the block is in
    // history before the bar attempts to bind to it by messageId), then the
    // question_asked dispatch.
    const msgIdx = block.indexOf('type: "message"')
    const askedIdx = block.indexOf('type: "question_asked"')
    assert.ok(msgIdx >= 0 && askedIdx >= 0 && msgIdx < askedIdx, "post {type:\"message\"} before {type:\"question_asked\"}")
  })

  void it("question_asked dispatch carries the question block and messageId", () => {
    const idx = source.indexOf("private ensureQuestionBlock(")
    const block = source.slice(idx, idx + 1600)
    const askedIdx = block.indexOf('type: "question_asked"')
    assert.ok(askedIdx >= 0, "question_asked post must exist")
    // Look at the postMessage argument shape right after the question_asked type marker.
    const slice = block.slice(askedIdx, askedIdx + 400)
    assert.ok(slice.includes("block"), "question_asked payload must include the question block")
    assert.ok(
      slice.includes("messageId") || slice.includes("messageId:"),
      "question_asked payload must include messageId so the bar can bind to the right transcript bubble",
    )
    assert.ok(slice.includes("sessionId"), "question_asked payload must include sessionId")
  })

  void it("wires refreshModels callback to ProviderManagementService", () => {
    assert.ok(
      source.includes("refreshModels: () => this.modelManager.refreshModels"),
      "ChatProvider must pass refreshModels callback to ProviderManagementService"
    )
  })

  void it("ProviderManagementService calls refreshModels after handleConnectProviderKey success", () => {
    const idx = providerManagementSource.indexOf("async handleConnectProviderKey")
    const block = providerManagementSource.slice(idx, idx + 1000)
    assert.ok(
      block.includes("await this.deps.refreshModels()"),
      "handleConnectProviderKey must call refreshModels after successful auth.set"
    )
  })

  void it("ProviderManagementService calls refreshModels after handleAddProvider success", () => {
    const idx = providerManagementSource.indexOf("async handleAddProvider")
    const block = providerManagementSource.slice(idx, idx + 400)
    assert.ok(
      block.includes("await this.deps.refreshModels()"),
      "handleAddProvider must call refreshModels after successful upsertConfig"
    )
  })

  void it("ProviderManagementService calls refreshModels after handleCompleteProviderOAuth success", () => {
    const idx = providerManagementSource.indexOf("async handleCompleteProviderOAuth")
    const block = providerManagementSource.slice(idx, idx + 1000)
    assert.ok(
      block.includes("await this.deps.refreshModels()"),
      "handleCompleteProviderOAuth must call refreshModels after successful callback"
    )
  })

  // Issue 1: error_cleared must be posted after reconnect to dismiss stale banners
  void it("posts error_cleared envelope after event_stream_reconnected", () => {
    const idx = source.indexOf('"event_stream_reconnected"')
    assert.ok(idx >= 0, "must have event_stream_reconnected handler")
    const blockEnd = source.indexOf('"sessions_recovered"', idx)
    const block = source.slice(idx, blockEnd > idx ? blockEnd : idx + 5000)
    assert.ok(
      block.includes('"error_cleared"'),
      "event_stream_reconnected handler must post error_cleared to dismiss stale banners",
    )
  })

  void it("posts error_cleared envelope after server_connected", () => {
    const idx = source.indexOf('"server_connected"')
    assert.ok(idx >= 0, "must have server_connected handler")
    const block = source.slice(idx, idx + 1000)
    assert.ok(
      block.includes('"error_cleared"'),
      "server_connected handler must post error_cleared to dismiss stale banners",
    )
  })

  // Issue 4: max-reconnect failure must produce a structured, actionable error
  void it("detects max reconnect attempts and maps to EVENT_STREAM_FAILED error context", () => {
    assert.ok(
      source.includes("EVENT_STREAM_FAILED"),
      "must define EVENT_STREAM_FAILED error code for max-reconnect failure",
    )
    assert.ok(
      source.includes("max reconnect attempts reached"),
      "must detect the max-reconnect-attempts-reached message",
    )
    assert.ok(
      source.includes("restart the OpenCode server"),
      "must provide actionable guidance to restart the server",
    )
  })

  // Issue 4: isEventStreamTransportError must NOT match the terminal max-reconnect failure
  void it("isEventStreamTransportError excludes max reconnect attempts reached", () => {
    const fnIdx = source.indexOf("private isEventStreamTransportError")
    assert.ok(fnIdx >= 0, "must have isEventStreamTransportError method")
    const fnBlock = source.slice(fnIdx, fnIdx + 500)
    assert.ok(
      fnBlock.includes("max reconnect"),
      "isEventStreamTransportError must check for 'max reconnect' to exclude terminal failure",
    )
  })
})
