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

  void it("has expected private methods and key patterns", () => {
    assert.ok(source.includes("private async handleWebviewMessage("), "must have handleWebviewMessage")
    assert.ok(source.includes("private handleServerEvent("), "must have handleServerEvent")
    assert.ok(source.includes("private postMessage("), "must have postMessage")
    assert.ok(source.includes("private postRequestError("), "must have postRequestError")
  })

  void it("contains VALID_WEBVIEW_TYPES static set with known message types", () => {
    assert.ok(source.includes("static readonly VALID_WEBVIEW_TYPES") || eventRouterSource.includes("static readonly VALID_WEBVIEW_TYPES"), "VALID_WEBVIEW_TYPES must exist")
    assert.ok(source.includes("send_prompt") || eventRouterSource.includes("send_prompt"), "must include send_prompt")
    assert.ok(source.includes("accept_diff") || eventRouterSource.includes("accept_diff"), "must include accept_diff")
    assert.ok(source.includes("reject_diff") || eventRouterSource.includes("reject_diff"), "must include reject_diff")
    assert.ok(source.includes("webview_ready") || eventRouterSource.includes("webview_ready"), "must include webview_ready")
  })

  void it("contains chunk batching and prompt-in-flight guards", () => {
    assert.ok(source.includes("promptsInFlight = new Set") || eventRouterSource.includes("promptsInFlight = new Set"), "promptInFlight guard must exist")
    assert.ok(source.includes("private chunkBatcher = new ChunkBatcher"), "chunkBatcher must exist")
    assert.ok(source.includes("import { ChunkBatcher } from"), "ChunkBatcher must be imported")
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

  void it("contains message validation guards for send_prompt and mention_search", () => {
    assert.ok(source.includes('msg.type === "send_prompt"') || eventRouterSource.includes('"send_prompt"'), "must handle send_prompt")
    assert.ok(source.includes('msg.type === "mention_search"') || eventRouterSource.includes('"mention_search"'), "must handle mention_search")
    assert.ok(source.includes("text.length > 50000") || eventRouterSource.includes("text.length > 50000"), "must reject oversized prompts")
    assert.ok(source.includes("query.length > 500") || eventRouterSource.includes("query.length > 500"), "must reject oversized mention queries")
  })

  void it("delegates auto compaction to AutoCompactor", () => {
    assert.ok(source.includes("private autoCompactIfIdle("), "must have autoCompactIfIdle method")
    assert.ok(source.includes("this.autoCompactor.tryCompactIfNeeded"), "must delegate to AutoCompactor")
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
    assert.ok(source.includes("notifyTurnComplete"), "must have notifyTurnComplete method")
    assert.ok(source.includes('"OpenCode turn complete"'), "must show turn complete notification")
    assert.ok(source.includes('"Open Chat"'), "must have Open Chat button action")
  })

  void it("auto_mode_shows_one_time_confirmation", () => {
    assert.ok(source.includes("showAutoModeConfirmation"), "must have showAutoModeConfirmation method")
    assert.ok(source.includes("Auto mode will apply all changes without asking"), "must show auto mode warning")
    assert.ok(source.includes('"auto"') || eventRouterSource.includes('"auto"'), "must handle auto mode")
    assert.ok(source.includes("hasAutoModeConfirmed"), "must have hasAutoModeConfirmed check")
  })

  void it("auto_mode_confirmation_suppressible", () => {
    assert.ok(source.includes("Don't show again"), "must have Don't show again option")
    assert.ok(source.includes("AUTO_MODE_CONFIRMED_KEY"), "must use globalState key for persistence")
    assert.ok(source.includes("globalState.update"), "must persist confirmation to globalState")
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

  void it("has command handler methods", () => {
    assert.ok(source.includes("handleExecuteCommand("), "must have handleExecuteCommand")
    assert.ok(source.includes("handleListCommands("), "must have handleListCommands")
    assert.ok(source.includes("handleClearCommand("), "must have handleClearCommand")
    assert.ok(source.includes("handleCostCommand("), "must have handleCostCommand")
    assert.ok(source.includes("handleContinueCommand("), "must have handleContinueCommand")
    assert.ok(source.includes("handleHelpCommand("), "must have handleHelpCommand")
  })

  void it("has banner and auto-mode methods", () => {
    assert.ok(source.includes("handleCompactBannerAction("), "must have handleCompactBannerAction")
    assert.ok(source.includes("hasAutoModeConfirmed("), "must have hasAutoModeConfirmed")
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
    /msg\.mode\s+as\s+string/.test(block),
    "change_mode handler must read mode from msg.mode (the webview sends mode, not tools)"
  )
  assert.ok(
    !block.includes("msg.tools"),
    "change_mode handler must not derive mode from msg.tools — webview never sends that"
  )
})

void it("change_mode passes msg.mode to tabManager.setMode and sessionStore.updateMode", () => {
  const block = findChangeModeBlock(source.indexOf('["change_mode"') >= 0 ? source : eventRouterSource)
  assert.ok(
    /tabManager\.setMode\(sessionId,\s*mode\)/.test(block),
    "must call tabManager.setMode(sessionId, mode)"
  )
  assert.ok(
    /sessionStore\.updateMode\(sessionId,\s*mode\)/.test(block),
    "must call sessionStore.updateMode(sessionId, mode)"
  )
})

void it("change_mode triggers auto-mode confirmation when mode is auto", () => {
  const block = findChangeModeBlock(source.indexOf('["change_mode"') >= 0 ? source : eventRouterSource)
  assert.ok(
    /mode\s*===\s*"auto"/.test(block) && block.includes("hasAutoModeConfirmed"),
    "auto mode must reach the confirmation check (block.mode === 'auto' branch must be reachable)"
  )
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

void it("pushes rate-limit state to the webview for the quota bar", () => {
  assert.ok(source.includes("rateLimitMonitor.onStateChanged"), "must subscribe to rate-limit state changes")
  const statePushSource = readFileSync(resolve(__dirname, "StatePushService.ts"), "utf8")
  assert.ok(statePushSource.includes('type: "rate_limit_state"'), "must post rate_limit_state messages")
  assert.ok(source.includes("getSerializableState"), "must serialize rate-limit state before posting")
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
    block.includes("restoredTabsHydrated = false"),
    "must reset restoredTabsHydrated so the next pushInitStateToWebview re-reads persisted tab IDs"
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
    eventRouterSource.includes("parseOpenFileTarget") && eventRouterSource.includes('fragment.match(/^L(\\d+)/i)'),
    "shared opener must parse #L12 line fragments"
  )
  assert.ok(
    eventRouterSource.includes("this.opts.sessionStore.get(sessionId)?.workspacePath"),
    "shared opener must prefer the stored session workspace path"
  )
  assert.ok(
    eventRouterSource.includes("isPathInsideRoot") && eventRouterSource.includes("outside the session workspace"),
    "shared opener must reject out-of-workspace file opens"
  )
})
