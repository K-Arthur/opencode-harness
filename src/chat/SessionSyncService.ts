import { SessionStore } from "../session/SessionStore"
import { SessionManager } from "../session/SessionManager"
import { ModelManager } from "../model/ModelManager"
import { McpServerManager } from "../mcp/McpServerManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { StatePushService } from "./StatePushService"
import { MessageRouter } from "./handlers/MessageRouter"
import { SessionLifecycleService } from "./SessionLifecycleService"

export interface SessionSyncDeps {
  sessionStore: SessionStore
  modelManager: ModelManager
  sessionManager: SessionManager
  sessionLifecycle: SessionLifecycleService
  mcpServerManager: McpServerManager
  rateLimitMonitor: RateLimitMonitor
  statePush: StatePushService
  messageRouter: MessageRouter
  postMessage: (msg: Record<string, unknown>) => void
  getActiveTabId: () => string | undefined
}

export class SessionSyncService {
  constructor(private deps: SessionSyncDeps) {}

  syncActiveSession(): void {
    return this.deps.sessionLifecycle.syncActiveSession()
  }

  pushModelToWebview(model?: string): void {
    this.deps.statePush.pushModelToWebview(model || this.deps.modelManager.model)
  }

  pushModelListToWebview(): void {
    this.deps.messageRouter.getModelList({
      postMessage: (m) => this.deps.statePush.postMessage(m),
      postRequestError: (m) => this.deps.statePush.postRequestError(m),
    })
  }

  pushMcpServersToWebview(): void {
    this.deps.mcpServerManager.refresh()
    const servers = this.deps.mcpServerManager.getServers()
    this.deps.statePush.pushMcpServersToWebview(servers)
  }

  pushRateLimitStateToWebview(): void {
    this.deps.statePush.pushRateLimitStateToWebview(this.deps.rateLimitMonitor.getSerializableState())
  }
}
