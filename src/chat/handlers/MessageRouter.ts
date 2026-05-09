import * as vscode from "vscode"
import { SessionManager } from "../../session/SessionManager"
import { SessionStore } from "../../session/SessionStore"
import { ModelManager } from "../../model/ModelManager"
import { log } from "../../utils/outputChannel"

export interface RouteContext {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string) => void
}

/**
 * Exhaustive check guard — throws at runtime and helps TS catch
 * unhandled event types at compile time when used with a `never` param.
 */
function _exhaustiveCheck(param: never, context?: RouteContext): never {
  const payload = typeof param === "string" ? param : JSON.stringify(param)
  const truncated = payload.length > 500 ? payload.slice(0, 500) + "…" : payload
  const msg = `Unrecognized event type: ${truncated}`
  log.warn("Unrecognized SSE event type", { payload: truncated })
  if (context) {
    context.postMessage({
      type: "stream:error",
      error: { code: "unrecognized_event", message: msg, detail: truncated },
    })
  }
  throw new Error(msg)
}

/**
 * All SSE event types from @opencode-ai/sdk that must be handled.
 * If you add a new event type to the SDK, add it here AND to the switch below.
 * The _exhaustiveCheck at the end will catch any missing mappings.
 */
type KnownSseEventType =
  | "stream_start"
  | "stream_token"
  | "stream_chunk"
  | "stream_end"
  | "stream_error"
  | "tool_start"
  | "tool_update"
  | "tool_end"
  | "diff"
  | "thinking"
  | "text"
  | "error"
  | "session_start"
  | "session_end"
  | "model_change"
  | "compaction"

export class MessageRouter {
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingMentionResolve: (() => void) | null = null

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly modelManager: ModelManager
  ) {}

  /**
   * Route an SSE event from the opencode server to a webview message.
   * Every known event.type maps to exactly one WebviewMessage type.
   * Unknown events are logged and produce a stream:error message.
   */
  routeSseEvent(
    event: { type: string; [key: string]: unknown },
    context: RouteContext
  ): void {
    const { type } = event

    // Map every SDK event type to exactly one webview message type
    switch (type as KnownSseEventType) {
      case "stream_start":
        context.postMessage(event)
        break
      case "stream_token":
        context.postMessage(event)
        break
      case "stream_chunk":
        context.postMessage(event)
        break
      case "stream_end":
        context.postMessage(event)
        break
      case "stream_error":
        context.postMessage(event)
        break
      case "tool_start":
        context.postMessage(event)
        break
      case "tool_update":
        context.postMessage(event)
        break
      case "tool_end":
        context.postMessage(event)
        break
      case "diff":
        context.postMessage(event)
        break
      case "thinking":
        context.postMessage(event)
        break
      case "text":
        context.postMessage(event)
        break
      case "error":
        context.postMessage(event)
        break
      case "session_start":
        context.postMessage(event)
        break
      case "session_end":
        context.postMessage(event)
        break
      case "model_change":
        context.postMessage(event)
        break
      case "compaction":
        context.postMessage(event)
        break
      default:
        // This must be `never` for TS to catch new SDK event types
        _exhaustiveCheck(type as never, context)
    }
  }

  async handleMentionSearch(query: string, context: RouteContext): Promise<void> {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer)
      this.pendingMentionResolve?.()
    }

    return new Promise((resolve) => {
      this.pendingMentionResolve = resolve
      this.searchDebounceTimer = setTimeout(async () => {
        this.searchDebounceTimer = null
        this.pendingMentionResolve = null
        await this.executeMentionSearch(query, context)
        resolve()
      }, 300)
    })
  }

  private async executeMentionSearch(query: string, context: RouteContext): Promise<void> {
    const items: { prefix: string; display: string; description: string }[] = []
    const lower = query.toLowerCase()

    // Handle special mention types
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

    // Build proper glob pattern for path-aware search
    // If query contains path separator, search for path; otherwise match filename
    let glob: string
    const trimmedQuery = query.replace(/^@/, '')

    if (query.includes("/")) {
      // Path-based search: match files under the specified path prefix
      glob = `**/${query}*`
    } else if (trimmedQuery.length > 0) {
      // Filename-based search
      glob = `**/*${trimmedQuery}*`
    } else {
      // Empty query - show common files (limit to avoid performance issues)
      glob = `**/*`
    }

    try {
      const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", 50)

      for (const file of files) {
        const relative = vscode.workspace.asRelativePath(file)
        if (!relative) continue

        // Filter by actual path match if query contains path separators
        if (trimmedQuery.includes('/')) {
          if (!relative.toLowerCase().includes(trimmedQuery.toLowerCase())) continue
        }

        items.push({ prefix: "@file:", display: relative, description: "File" })
      }
    } catch (err) {
      log.warn("Mention file search failed", err)
    }

    context.postMessage({ type: "mention_results", items })
  }

  async handleListSessions(sessionStore: any, context: RouteContext): Promise<void> {
    // Match opencode CLI: only surface sessions belonging to the current
    // workspace. Sessions whose workspace is unknown (created before we
    // started capturing it) are kept so they remain reachable.
    const folders = vscode.workspace.workspaceFolders
    const currentDir = folders && folders.length > 0 ? folders[0]!.uri.fsPath : undefined
    const all = sessionStore.list().filter((s: any) => {
      if (!currentDir) return true
      if (!s.workspacePath) return true
      return s.workspacePath === currentDir
    })
    context.postMessage({
      type: "session_list",
      sessions: all.map((s: any) => ({
        id: s.id,
        title: SessionStore.displayName(s),
        time: s.lastActiveAt,
        messageCount: s.messages.length,
        cost: s.cost || 0,
        workspacePath: s.workspacePath,
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
      supportsVariants: m.supportsVariants,
    }))
    context.postMessage({ type: "model_list", items: models, model: this.modelManager.model })
  }

  dispose(): void {}
}
