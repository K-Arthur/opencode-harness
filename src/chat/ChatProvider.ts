import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { SessionManager } from "../session/SessionManager"
import { DiffApplier } from "../diff/DiffApplier"

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: unknown[]
  timestamp: number
  sessionId: string
  id?: string
}

export class ChatProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private diffApplier = new DiffApplier()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "chat", "webview"),
      ],
    }

    webviewView.webview.html = this.getWebviewContent()

    webviewView.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "send_prompt":
          await this.handleSendPrompt(msg.text as string)
          break
        case "change_mode":
          break
        case "abort":
          break
        case "accept_diff":
          await this.handleAcceptDiff(msg.messageId as string, msg.blockId as string)
          break
        case "reject_diff":
          break
        case "mention_search":
          await this.handleMentionSearch(msg.query as string)
          break
        case "list_sessions":
          await this.handleListSessions()
          break
        case "resume_session":
          await this.handleResumeSession(msg.sessionId as string)
          break
        case "new_session":
          vscode.commands.executeCommand("opencode-harness.newSession")
          break
      }
    })
  }

  private getWebviewContent(): string {
    const extRoot = this.context.extensionUri.fsPath
    const htmlPath = path.join(extRoot, "src", "chat", "webview", "index.html")
    const cssPath = path.join(extRoot, "src", "chat", "webview", "styles.css")
    const jsPath = path.join(extRoot, "src", "chat", "webview", "main.js")

    let html = fs.readFileSync(htmlPath, "utf8")
    const css = fs.readFileSync(cssPath, "utf8")
    const js = fs.readFileSync(jsPath, "utf8")

    html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
    html = html.replace('<script src="main.js"></script>', `<script>${js}</script>`)
    return html
  }

  private async handleSendPrompt(text: string): Promise<void> {
    if (!this.sessionManager.isRunning) {
      try { await this.sessionManager.start() } catch (e) {
        vscode.window.showErrorMessage(`Failed to start opencode: ${(e as Error).message}`)
        return
      }
    }

    const session = await this.sessionManager.createSession()
    const response = await this.sessionManager.sendPrompt(session.id, [
      { type: "text", text } as never,
    ])

    const parts = response.parts || []
    const textParts = parts.filter((p: unknown) => (p as { type: string }).type === "text") as { type: string; text?: string }[]

    // Build content blocks: text + diffs
    const contentBlocks: unknown[] = []
    for (const part of parts) {
      if ((part as { type: string }).type === "text") {
        contentBlocks.push({ type: "text", text: (part as { text: string }).text })
      }
    }

    // Parse code blocks and generate diffs
    const edits = this.diffApplier.parseCodeBlocks(textParts)
    for (const edit of edits) {
      const diffText = await this.diffApplier.generateDiff(edit.filePath, edit.proposedContent)
      contentBlocks.push({
        type: "diff_block",
        id: edit.blockId,
        filePath: edit.filePath,
        diffText,
        messageId: String(response.info?.id || ""),
      })
    }

    this._view?.webview.postMessage({
      type: "message",
      message: {
        role: "assistant",
        id: response.info?.id,
        content: contentBlocks,
        timestamp: Date.now(),
        sessionId: session.id,
      },
    })
  }

  private async handleMentionSearch(query: string): Promise<void> {
    const items: { prefix: string; display: string; description: string }[] = []
    const lower = query.toLowerCase()

    if ("file".startsWith(lower) || query.startsWith("file")) {
      items.push({ prefix: "@file:", display: "file", description: "Reference a file" })
    }
    if ("folder".startsWith(lower) || query.startsWith("folder")) {
      items.push({ prefix: "@folder:", display: "folder", description: "Reference a folder" })
    }
    if ("problems".startsWith(lower) || query.startsWith("problems")) {
      items.push({ prefix: "@problems:", display: "problems", description: "Workspace errors and warnings" })
    }
    if ("url".startsWith(lower) || query.startsWith("url")) {
      items.push({ prefix: "@url:", display: "url", description: "Fetch content from a URL" })
    }
    if ("terminal".startsWith(lower) || query.startsWith("terminal")) {
      items.push({ prefix: "@terminal:", display: "terminal", description: "Capture terminal output" })
    }

    const files = await vscode.workspace.findFiles(`**/*${query}*`, "**/node_modules/**", 5)
    for (const file of files) {
      const relative = vscode.workspace.asRelativePath(file)
      items.push({ prefix: "@file:", display: relative, description: "File" })
    }

    this._view?.webview.postMessage({ type: "mention_results", items })
  }

  private async handleListSessions(): Promise<void> {
    if (!this.sessionManager.isRunning) return
    const sessions = await this.sessionManager.listSessions()
    this._view?.webview.postMessage({
      type: "session_list",
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, time: s.time })),
    })
  }

  private async handleResumeSession(sessionId: string): Promise<void> {
    if (!this.sessionManager.isRunning) return
    const messages = await this.sessionManager.getMessages(sessionId)
    for (const m of messages) {
      this._view?.webview.postMessage({
        type: "message",
        message: {
          role: (m.info as { role?: string })?.role || "assistant",
          content: m.parts || [],
          timestamp: Date.now(),
          sessionId,
        },
      })
    }
  }

  private async handleAcceptDiff(_messageId: string, _blockId: string): Promise<void> {
    vscode.window.showInformationMessage("Diff accepted.")
  }
}
