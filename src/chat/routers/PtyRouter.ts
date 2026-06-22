import type { PtyService } from "../../session/PtyService"
import type { SessionManager } from "../../session/SessionManager"
import { log } from "../../utils/outputChannel"

export interface PtyRouterDeps {
  sessionManager: Pick<SessionManager, "ptyService">
  postMessage: (msg: Record<string, unknown>) => void
}

export class PtyRouter {
  constructor(private deps: PtyRouterDeps) {}

  getHandlers(): Array<[string, (msg: Record<string, unknown>) => void | Promise<void>]> {
    return [
      ["pty_connect", (msg) => this.handleConnect(msg)],
      ["pty_cancel", (msg) => this.handleCancel(msg)],
      ["pty_send_input", (msg) => this.handleSendInput(msg)],
      ["pty_resize", (msg) => this.handleResize(msg)],
      ["pty_list", () => this.handleList()],
    ]
  }

  private async handleConnect(msg: Record<string, unknown>): Promise<void> {
    const ptyId = typeof msg.ptyId === "string" ? msg.ptyId : ""
    if (!ptyId) return
    try {
      const ticket = await this.deps.sessionManager.ptyService.getConnectToken(ptyId)
      await this.deps.sessionManager.ptyService.connectWebSocket(
        ptyId,
        ticket.ticket,
        (event) => {
          const data = typeof event.data === "string"
            ? event.data
            : event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : ""
          if (data) {
            this.deps.postMessage({ type: "pty_output", ptyId, data })
          }
        },
      )
      this.deps.postMessage({ type: "pty_connected", ptyId })
    } catch (err) {
      log.warn(`pty_connect failed for ${ptyId}: ${err instanceof Error ? err.message : String(err)}`)
      this.deps.postMessage({ type: "pty_error", ptyId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async handleCancel(msg: Record<string, unknown>): Promise<void> {
    const ptyId = typeof msg.ptyId === "string" ? msg.ptyId : ""
    if (!ptyId) return
    try {
      await this.deps.sessionManager.ptyService.removeSession(ptyId)
      this.deps.postMessage({ type: "pty_cancelled", ptyId })
    } catch (err) {
      log.warn(`pty_cancel failed for ${ptyId}: ${err instanceof Error ? err.message : String(err)}`)
      this.deps.postMessage({ type: "pty_error", ptyId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async handleSendInput(msg: Record<string, unknown>): Promise<void> {
    const ptyId = typeof msg.ptyId === "string" ? msg.ptyId : ""
    const data = typeof msg.data === "string" ? msg.data : ""
    if (!ptyId || !data) return
    try {
      await this.deps.sessionManager.ptyService.sendInput(ptyId, data)
    } catch (err) {
      log.warn(`pty_send_input failed for ${ptyId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleResize(msg: Record<string, unknown>): Promise<void> {
    const ptyId = typeof msg.ptyId === "string" ? msg.ptyId : ""
    const rows = typeof msg.rows === "number" ? msg.rows : 24
    const cols = typeof msg.cols === "number" ? msg.cols : 80
    if (!ptyId) return
    try {
      await this.deps.sessionManager.ptyService.setTerminalSize(ptyId, rows, cols)
    } catch (err) {
      log.warn(`pty_resize failed for ${ptyId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleList(): Promise<void> {
    try {
      const sessions = await this.deps.sessionManager.ptyService.listSessions()
      this.deps.postMessage({ type: "pty_sessions", sessions })
    } catch (err) {
      log.warn(`pty_list failed: ${err instanceof Error ? err.message : String(err)}`)
      this.deps.postMessage({ type: "pty_sessions", sessions: [] })
    }
  }
}