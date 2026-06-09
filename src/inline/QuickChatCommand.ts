import * as vscode from "vscode"
import type { ChatProvider } from "../chat/ChatProvider"
import { log } from "../utils/outputChannel"

export async function runQuickChat(chatProvider: ChatProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage("Open a file in the editor to use Quick Chat.")
    return
  }

  const document = editor.document
  const selection = editor.selection
  const languageId = document.languageId
  const relativePath = vscode.workspace.asRelativePath(document.fileName)

  const hasSelection = !selection.isEmpty
  const contextLabel = hasSelection ? `selection in ${relativePath}` : relativePath

  const userInput = await vscode.window.showInputBox({
    prompt: `Ask about ${contextLabel} (${languageId})`,
    placeHolder: hasSelection ? "What does this code do?" : "Ask anything about this file…",
    ignoreFocusOut: true,
  })

  if (!userInput || !userInput.trim()) return

  const selectedText = hasSelection
    ? document.getText(selection)
    : document.getText()

  const selectionInfo = hasSelection
    ? `Lines ${selection.start.line + 1}–${selection.end.line + 1}`
    : "Full file"

  const prompt = [
    `${userInput.trim()}`,
    ``,
    `\`\`\`${languageId} (${relativePath} — ${selectionInfo})`,
    selectedText,
    `\`\`\``,
  ].join("\n")

  try {
    await vscode.commands.executeCommand("opencode-harness.openChat")
    await vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    chatProvider.sendPromptToWebview(prompt, false)
  } catch (err) {
    log.error("Quick Chat failed", err)
    vscode.window.showErrorMessage("Quick Chat failed to open the chat panel.")
  }
}
