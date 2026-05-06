import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const source = readFileSync(resolve(__dirname, "ChatProvider.ts"), "utf8")

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
    assert.ok(source.includes("private flushChunkBuffer("), "must have flushChunkBuffer")
    assert.ok(source.includes("private postRequestError("), "must have postRequestError")
  })

  void it("contains VALID_WEBVIEW_TYPES static set with known message types", () => {
    assert.ok(source.includes("static readonly VALID_WEBVIEW_TYPES"), "VALID_WEBVIEW_TYPES must exist")
    assert.ok(source.includes("send_prompt"), "must include send_prompt")
    assert.ok(source.includes("accept_diff"), "must include accept_diff")
    assert.ok(source.includes("reject_diff"), "must include reject_diff")
    assert.ok(source.includes("webview_ready"), "must include webview_ready")
  })

  void it("contains chunk batching and prompt-in-flight guards", () => {
    assert.ok(source.includes("promptsInFlight = new Set"), "promptInFlight guard must exist")
    assert.ok(source.includes("private chunkBatcher = new ChunkBatcher"), "chunkBatcher must exist")
    assert.ok(source.includes("import { ChunkBatcher } from"), "ChunkBatcher must be imported")
    assert.ok(source.includes("private earlyMessageQueue"), "earlyMessageQueue must exist")
  })

  void it("imports ChatMessage and Block from ./types", () => {
    assert.ok(source.includes("import { ChatMessage, Block } from \"./types\""), "must import ChatMessage from types")
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
    assert.ok(source.includes('msg.type === "send_prompt"'), "must handle send_prompt")
    assert.ok(source.includes('msg.type === "mention_search"'), "must handle mention_search")
    assert.ok(source.includes("text.length > 50000"), "must reject oversized prompts")
    assert.ok(source.includes("query.length > 500"), "must reject oversized mention queries")
  })

  void it("delegates auto compaction to AutoCompactor", () => {
    assert.ok(source.includes("private autoCompactIfIdle("), "must have autoCompactIfIdle method")
    assert.ok(source.includes("this.autoCompactor.tryCompactIfNeeded"), "must delegate to AutoCompactor")
  })

  void it("delegates slash commands to ChatCommands", () => {
    assert.ok(source.includes("chatCommands.clear("), "must delegate clear to ChatCommands")
    assert.ok(source.includes("chatCommands.cost("), "must delegate cost to ChatCommands")
    assert.ok(source.includes("chatCommands.continue("), "must delegate continue to ChatCommands")
    assert.ok(source.includes("chatCommands.help("), "must delegate help to ChatCommands")
  })

  void it("contains toUserErrorMessage with common error patterns", () => {
    assert.ok(source.includes("private toUserErrorMessage("), "must have toUserErrorMessage")
    assert.ok(source.includes("server not running"), "must handle server not running errors")
    assert.ok(source.includes("timeout|did not start"), "must handle timeout errors")
  })

  void it("contains edit_message handler for message editing", () => {
    assert.ok(source.includes('"edit_message"'), "must include edit_message in VALID_WEBVIEW_TYPES")
    assert.ok(source.includes("handleEditMessage("), "must have handleEditMessage method")
    assert.ok(source.includes("edit_message_prefill"), "must send edit_message_prefill to webview")
  })

  void it("handles_image_paste_with_base64_encoding", () => {
    assert.ok(source.includes('"attach_image"'), "VALID_WEBVIEW_TYPES must include attach_image")
    assert.ok(source.includes("attach_image"), "handleWebviewMessage must have attach_image case")
    assert.ok(source.includes("handleAttachImage("), "must have handleAttachImage method")
    assert.ok(source.includes('type: "image"'), "must create image block type")
    assert.ok(source.includes("data"), "must pass base64 data to image block")
    assert.ok(source.includes("mimeType"), "must pass mimeType to image block")
  })

  void it("handles_image_file_attachment", () => {
    assert.ok(source.includes("handleAttachImage"), "handleAttachImage method must exist")
    assert.ok(source.includes("appendMessage"), "must persist image message via appendMessage")
    assert.ok(source.includes('type: "message"'), "must send message to webview with image")
  })

  void it("contains mapToolType for type categorization", () => {
    assert.ok(source.includes("private mapToolType("), "must have mapToolType")
    assert.ok(source.includes('return "write"'), "must classify write tools")
    assert.ok(source.includes('return "exec"'), "must classify exec tools")
    assert.ok(source.includes('return "read"'), "must classify read tools")
  })

  void it("stream_end_triggers_notification_when_webview_not_visible", () => {
    assert.ok(source.includes("notifyTurnComplete"), "must have notifyTurnComplete method")
    assert.ok(source.includes('"OpenCode turn complete"'), "must show turn complete notification")
    assert.ok(source.includes('"Open Chat"'), "must have Open Chat button action")
  })

  void it("auto_mode_shows_one_time_confirmation", () => {
    assert.ok(source.includes("showAutoModeConfirmation"), "must have showAutoModeConfirmation method")
    assert.ok(source.includes("Auto mode will apply all changes without asking"), "must show auto mode warning")
    assert.ok(source.includes('"auto"'), "must handle auto mode")
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
    assert.ok(source.includes("resolveCustomPromptVariables("), "must have resolveCustomPromptVariables")
  })

  // ---- Regression: premature stream finalization (session.idle bug) ----

  void it("session_status handler must NOT call finalizeStream on idle", () => {
    // Extract the session_status handler block from the source.
    // It must not contain a finalizeStream() call inside it.
    const sessionStatusIdx = source.indexOf('"session_status"')
    assert.ok(sessionStatusIdx >= 0, "session_status handler must exist")

    // Find the closing bracket of this handler (next handler entry starts a new array element)
    const serverStatusIdx = source.indexOf('"server_status"', sessionStatusIdx)
    assert.ok(serverStatusIdx > sessionStatusIdx, "server_status handler must follow session_status")

    const sessionStatusBlock = source.slice(sessionStatusIdx, serverStatusIdx)
    assert.ok(
      !sessionStatusBlock.includes("finalizeStream"),
      "session_status handler must NOT call finalizeStream — session.idle fires during " +
      "normal lifecycle (e.g. after async prompt accept) and causes premature stream finalization"
    )
  })

  void it("server_status handler must NOT call finalizeStream on idle", () => {
    const serverStatusIdx = source.indexOf('"server_status"')
    assert.ok(serverStatusIdx >= 0, "server_status handler must exist")

    const permissionIdx = source.indexOf('"permission_request"', serverStatusIdx)
    assert.ok(permissionIdx > serverStatusIdx, "permission_request handler must follow server_status")

    const serverStatusBlock = source.slice(serverStatusIdx, permissionIdx)
    assert.ok(
      !serverStatusBlock.includes("finalizeStream"),
      "server_status handler must NOT call finalizeStream — same reason as session_status"
    )
  })

  void it("message_complete handler is the sole trigger for finalizeStream", () => {
    // message_complete must call finalizeStream
    const msgCompleteIdx = source.indexOf('"message_complete"')
    assert.ok(msgCompleteIdx >= 0, "message_complete handler must exist")

    const sessionStatusIdx = source.indexOf('"session_status"', msgCompleteIdx)
    assert.ok(sessionStatusIdx > msgCompleteIdx, "session_status must follow message_complete")

    const msgCompleteBlock = source.slice(msgCompleteIdx, sessionStatusIdx)
    assert.ok(
      msgCompleteBlock.includes("finalizeStream"),
      "message_complete handler must call finalizeStream — it is the sole correct finalization trigger"
    )
  })
})
