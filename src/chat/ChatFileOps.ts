import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export class ChatFileOps {
  /** Insert code at cursor position in the active editor */
  async insertAtCursor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage("No active editor to insert code into.")
      return
    }
    await editor.edit((editBuilder) => {
      for (const selection of editor.selections) {
        editBuilder.replace(selection, code)
      }
    })
  }

  /** Create a new file from a code block and open it in the editor */
  async createFromCode(code: string, language: string): Promise<void> {
    const ext = ChatFileOps.extensionForLanguage(language)
    const defaultUri = vscode.Uri.file(`untitled${ext}`)
    const uri = await vscode.window.showSaveDialog({ defaultUri, filters: { "All Files": ["*"] } })
    if (!uri) return
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(code, "utf8"))
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc)
    } catch (err) {
      log.error("Failed to create file from code block", err)
      vscode.window.showErrorMessage("Failed to create file: " + ((err as Error).message || "unknown error"))
    }
  }

  /** Map a language identifier to its file extension */
  static extensionForLanguage(language: string): string {
    const map: Record<string, string> = {
      javascript: ".js", typescript: ".ts", python: ".py", rust: ".rs",
      go: ".go", bash: ".sh", json: ".json", css: ".css", html: ".html",
      sql: ".sql", java: ".java", cpp: ".cpp", yaml: ".yaml", xml: ".xml",
      markdown: ".md", text: ".txt",
    }
    return map[language?.toLowerCase()] || `.${language || "txt"}`
  }
}
