import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { SessionManager } from "../session/SessionManager"
import { ContextEngine } from "../context/ContextEngine"
import { DiffApplier } from "../diff/DiffApplier"
import { ContextMonitor } from "../monitor/ContextMonitor"
import { estimateContextTokens } from "../utils/tokenCounter"

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  blocks: Block[]
  timestamp: number
  sessionId: string
  id?: string
}

export interface Block {
  type: string
  [key: string]: unknown
}

export class ChatProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private diffApplier = new DiffApplier()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
    private readonly contextEngine: ContextEngine,
    private readonly contextMonitor: ContextMonitor
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
        case "accept_permission":
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

    this.sessionManager.onEvent((event) => {
      this.handleServerEvent(event)
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
    html = html.replace("<script src=\"main.js\"></script>", `<script>${js}</script>`)
    return html
  }

  private async handleSendPrompt(text: string): Promise<void> {
    if (!this.sessionManager.isRunning) {
      try { await this.sessionManager.start() } catch (e) {
        vscode.window.showErrorMessage(`Could not start OpenCode. ${(e as Error).message} Make sure 'opencode' is installed and on your PATH.`)
        return
      }
    }

    const ctxPkg = await this.contextEngine.gatherContext()
    this.contextMonitor.updateTokens(estimateContextTokens(ctxPkg))
    const session = await this.sessionManager.createSession()

    const contextText = `<context>
Open files: ${ctxPkg.openFiles.map(f => `${f.path} (${f.language})`).join(", ") || "none"}
Git branch: ${ctxPkg.gitStatus.branch}
Diagnostics: ${ctxPkg.diagnostics.length} files with errors or warnings
</context>`

    this.postMessage({
      type: "message",
      message: {
        role: "user",
        blocks: [{ type: "text", text }],
        timestamp: Date.now(),
        sessionId: session.id,
      },
    })

    this.postMessage({ type: "stream_start", messageId: `resp-${session.id}` })

    const response = await this.sessionManager.sendPrompt(session.id, [
      { type: "text", text: contextText } as never,
      { type: "text", text } as never,
    ])

    const parts = response.parts || []

    const blocks: Block[] = []
    for (const part of parts) {
      if ((part as { type: string }).type === "text") {
        const textContent = (part as { text: string }).text
        blocks.push({ type: "text", text: textContent })
        this.postMessage({ type: "stream_chunk", messageId: `resp-${session.id}`, text: textContent })
      }
    }

    const textParts = parts.filter((p: unknown) => (p as { type: string }).type === "text") as { text?: string }[]
    const edits = this.diffApplier.parseCodeBlocks(textParts as unknown as { type: string; text?: string }[])
    for (const edit of edits) {
      const diffText = await this.diffApplier.generateDiff(edit.filePath, edit.proposedContent)
      blocks.push({ type: "diff_block", id: edit.blockId, filePath: edit.filePath, diffText, messageId: String(response.info?.id || "") })
    }

    this.postMessage({ type: "stream_end", messageId: `resp-${session.id}`, blocks })
  }

  private postMessage(msg: Record<string, unknown>): void {
    this._view?.webview.postMessage(msg)
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

    this.postMessage({ type: "mention_results", items })
  }

  private async handleListSessions(): Promise<void> {
    if (!this.sessionManager.isRunning) return
    const sessions = await this.sessionManager.listSessions()
    this.postMessage({
      type: "session_list",
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, time: s.time })),
    })
  }

  private async handleResumeSession(sessionId: string): Promise<void> {
    if (!this.sessionManager.isRunning) return
    this.postMessage({ type: "clear_messages" })
    const messages = await this.sessionManager.getMessages(sessionId)
    for (const m of messages) {
      this.postMessage({
        type: "message",
        message: {
          role: (m.info as { role?: string })?.role || "assistant",
          blocks: (m.parts || []).map((p: unknown) => ({
            type: (p as { type: string }).type === "text" ? "text" : (p as { type: string }).type,
            text: (p as { text?: string }).text || "",
          })),
          timestamp: Date.now(),
          sessionId,
        },
      })
    }
  }

  private async handleAcceptDiff(_messageId: string, _blockId: string): Promise<void> {
    vscode.window.showInformationMessage("Diff accepted and applied.")
  }

  private handleServerEvent(event: { type: string; data?: unknown }): void {
    if (!this._view) return
    const data = event.data as Record<string, unknown> | undefined

    switch (event.type) {
      case "tool_start":
        this.postMessage({
          type: "message",
          message: {
            role: "system",
            blocks: [{
              type: "tool_call",
              toolType: this.mapToolType((data?.tool as string) || ""),
              toolName: data?.tool || "unknown",
              args: JSON.stringify(data?.input || {}),
            }],
            timestamp: Date.now(),
            sessionId: (data?.sessionID as string) || "",
          },
        })
        break

      case "tool_end":
        break

      case "skill_load":
        this.postMessage({
          type: "message",
          message: {
            role: "system",
            blocks: [{
              type: "skill_badge",
              skillName: data?.skill || "unknown",
              description: data?.description || "",
            }],
            timestamp: Date.now(),
            sessionId: "",
          },
        })
        break

      case "thinking":
        this.postMessage({
          type: "message",
          message: {
            role: "system",
            blocks: [{ type: "thinking", text: data?.text || "" }],
            timestamp: Date.now(),
            sessionId: "",
          },
        })
        break
    }
  }

  private mapToolType(tool: string): string {
    if (!tool) return "read"
    const t = tool.toLowerCase()
    if (t.includes("edit") || t.includes("write") || t.includes("create") || t.includes("apply")) return "write"
    if (t.includes("bash") || t.includes("exec") || t.includes("run") || t.includes("command")) return "exec"
    return "read"
  }
}
