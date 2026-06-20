import type { TabManager } from "./TabManager"
import type { SessionStore } from "../session/SessionStore"

export interface StatePushServiceOptions {
  postMessage: (msg: Record<string, unknown>) => void
  tabManager: TabManager
  sessionStore: SessionStore
  getThemeConfig?: () => Record<string, unknown>
  getTheme?: () => string | undefined
}

export class StatePushService {
  constructor(private opts: StatePushServiceOptions) {}

  postMessage(msg: Record<string, unknown>): void {
    this.opts.postMessage(msg)
  }

  postRequestError(message: string, sessionId?: string): void {
    this.opts.postMessage({ type: "request_error", sessionId, message })
  }

  pushModelToWebview(model?: string): void {
    this.opts.postMessage({ type: "model_update", model })
  }

  pushModelListToWebview(): void {
    this.opts.postMessage({ type: "model_list" })
  }

  pushMcpServersToWebview(servers?: unknown[]): void {
    this.opts.postMessage({ type: "mcp_servers", servers })
  }

  pushRateLimitStateToWebview(state?: unknown): void {
    this.opts.postMessage({ type: "rate_limit_state", state })
  }

  pushThemeConfigToWebview(): void {
    const config = this.opts.getThemeConfig?.()
    this.opts.postMessage({ type: "theme_config", config })
  }

  pushCommandListToWebview(commands: { name: string; description?: string; template?: string; source?: string; agent?: string }[], partial?: boolean): void {
    // Trim payload to avoid exceeding HostMessageBatcher's maxPayloadBytes (256KB).
    // Send only: name, description (fallback to truncated template ~140 chars), source, agent, isCustom.
    // Drop full template bodies which can be very large (e.g., methodology skills).
    const trimmed = commands.map(cmd => {
      const description = cmd.description ?? (cmd.template ? cmd.template.slice(0, 140) + (cmd.template.length > 140 ? "..." : "") : undefined)
      return {
        name: cmd.name,
        description,
        source: cmd.source,
        agent: cmd.agent,
        isCustom: cmd.source === "custom",
      }
    })
    this.opts.postMessage({ type: "command_list", commands: trimmed, partial })
  }

  pushAllStateToWebview(): void {
    this.opts.postMessage({ type: "push_all_state" })
  }

  pushVisibleStateToWebview(): void {
    this.opts.postMessage({ type: "push_visible_state" })
  }

  pushThemeToWebview(): void {
    const theme = this.opts.getTheme?.()
    this.opts.postMessage({ type: "theme", theme })
  }
}
