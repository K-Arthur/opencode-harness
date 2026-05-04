import * as vscode from "vscode"
import { SessionManager } from "../../session/SessionManager"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"

export interface RouteContext {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string) => void
}

export class MessageRouter {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly modelManager: ModelManager
  ) {}

  async handleMentionSearch(query: string, context: RouteContext): Promise<void> {
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

    context.postMessage({ type: "mention_results", items })
  }

  async handleListSessions(sessionStore: any, context: RouteContext): Promise<void> {
    context.postMessage({
      type: "session_list",
      sessions: sessionStore.list().map((s: any) => ({
        id: s.id,
        title: s.name,
        time: s.lastActiveAt,
        messageCount: s.messages.length,
        cost: s.cost || 0,
      })),
    })
  }

  async handleAcceptPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    try {
      await this.sessionManager.respondToPermission(sessionId, permissionId, response)
      log.info(`Permission ${permissionId} responded with: ${response}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      log.error("Failed to respond to permission", e)
      vscode.window.showWarningMessage(`Could not respond to permission: ${message}`)
    }
  }

  getModelList(context: RouteContext): void {
    const models = this.modelManager.models.map((m) => ({
      id: m.id,
      provider: m.provider,
      displayName: m.displayName,
    }))
    context.postMessage({ type: "model_list", items: models })
  }
}
