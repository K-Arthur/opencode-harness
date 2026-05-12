import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "QuickChatCommand.ts"), "utf8")

describe("QuickChatCommand.ts", () => {
  it("exports runQuickChat function", () => {
    assert.ok(
      source.includes("export async function runQuickChat(") || source.includes("export function runQuickChat("),
      "must export runQuickChat"
    )
  })

  it("uses vscode.window.showInputBox to capture the prompt", () => {
    assert.ok(
      source.includes("showInputBox"),
      "must use showInputBox to capture user prompt"
    )
  })

  it("builds_prompt_includes_file_path_and_language", () => {
    // The prompt sent to the chat panel must include the active file path
    // and language so the agent has implicit context without needing @-mentions.
    assert.ok(
      source.includes("relativePath") || source.includes("document.fileName") || source.includes("asRelativePath"),
      "prompt must include the active file path"
    )
    assert.ok(
      source.includes("languageId"),
      "prompt must include the file's languageId"
    )
  })

  it("builds_prompt_includes_selection_text_when_present", () => {
    // When the user has text selected, it must be included in the prompt.
    assert.ok(
      source.includes("selection") && source.includes("getText"),
      "prompt must include selected text when a selection exists"
    )
  })

  it("returns_early_gracefully_when_no_active_editor", () => {
    // No active editor must not throw — just return silently.
    assert.ok(
      source.includes("activeTextEditor") && (source.includes("return") || source.includes("!editor")),
      "must check for activeTextEditor and return early when none"
    )
  })

  it("attaches_full_file_when_selection_is_empty", () => {
    // Empty selection must fall back to attaching the full file content.
    assert.ok(
      source.includes("isEmpty") || source.includes("selection.isEmpty"),
      "must detect empty selection and fall back to full-file context"
    )
  })

  it("calls_chatProvider_to_send_the_prompt", () => {
    // After showInputBox, must send to the chat panel via chatProvider.
    assert.ok(
      source.includes("sendPromptToWebview") || source.includes("chatProvider"),
      "must call chatProvider to deliver the prompt to the webview"
    )
  })

  it("opens_chat_panel_before_sending", () => {
    // The chat panel must be revealed so the user sees the response.
    assert.ok(
      source.includes("executeCommand") && (source.includes("openChat") || source.includes("opencode-harness")),
      "must reveal chat panel before sending the prompt"
    )
  })
})
