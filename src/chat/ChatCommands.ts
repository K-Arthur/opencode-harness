import * as vscode from "vscode"
import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { TabManager } from "./TabManager"
import { StreamCoordinator } from "./handlers/StreamCoordinator"
import { log } from "../utils/outputChannel"

export class ChatCommands {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly sessionManager: SessionManager,
    private readonly tabManager: TabManager,
    private readonly streamCoordinator: StreamCoordinator,
  ) {}

  /** /clear: clear tab messages, create new server session, preserve old session in history */
  async clear(sessionId: string, postMessage: (msg: Record<string, unknown>) => void,
    postRequestError: (msg: string) => void): Promise<void> {
    const tab = this.tabManager.getTab(sessionId)
    if (!tab) return

    // Abort any active streaming
    if (tab.isStreaming) {
      await this.streamCoordinator.abort(sessionId, { postMessage, postRequestError })
    }

    // Clear messages client-side
    postMessage({ type: "clear_messages", sessionId })

    // Preserve existing session in history — keep the SessionStore record
    // but clear its messages array for a fresh start
    this.sessionStore.truncateMessages(sessionId, 0)

    // Create a new server-side session for the same tab
    if (this.sessionManager.isRunning) {
      try {
        const newSess = await this.sessionManager.createSession()
        tab.cliSessionId = newSess.id
        this.sessionStore.updateCliSessionId(sessionId, newSess.id)
        log.info(`Created new CLI session for tab ${sessionId}: ${newSess.id}`)
      } catch (err) {
        log.warn("Failed to create new CLI session for clear command", err)
        tab.cliSessionId = undefined
      }
    }
  }

  /** /cost: request cost from server and show as system-message */
  async cost(sessionId: string, postMessage: (msg: Record<string, unknown>) => void): Promise<void> {
    const tab = this.tabManager.getTab(sessionId)
    const session = this.sessionStore.get(sessionId)
    const localCost = session?.cost ?? 0

    let serverCost: number | undefined
    if (tab?.cliSessionId && this.sessionManager.isRunning) {
      try {
        const serverSess = await this.sessionManager.getSession(tab.cliSessionId)
        const cost = (serverSess as Record<string, unknown>)?.cost
        if (typeof cost === "number") {
          serverCost = cost
        }
      } catch {
        // Fall through to local cost
      }
    }

    const displayCost = serverCost ?? localCost
    const source = serverCost !== undefined ? "server" : "local"
    postMessage({
      type: "message",
      sessionId,
      message: {
        role: "system",
        id: `cost-${crypto.randomUUID()}`,
        blocks: [{ type: "text", text: `Session cost (${source} figures): $${displayCost.toFixed(4)}` }],
        timestamp: Date.now(),
        sessionId,
      },
    })
  }

  /** /continue: resume most recently closed session */
  continue(sessionId: string, postRequestError: (msg: string) => void): void {
    // Find most recently closed session (has messages, not the current active or this tab)
    const sessions = this.sessionStore.list()
    const recentlyClosed = sessions.find(
      (s) => s.id !== this.sessionStore.activeId && s.id !== sessionId && s.messages.length > 0
    )
    if (recentlyClosed) {
      vscode.commands.executeCommand("opencode-harness.openStoredSession", recentlyClosed.id)
    } else {
      postRequestError("No previous sessions to continue.")
    }
  }

  /** /help: send command list as system-message with markdown table */
  help(sessionId: string, postMessage: (msg: Record<string, unknown>) => void): void {
    const table = [
      "| Command | Description |",
      "|---------|-------------|",
      "| `/clear` | Clear conversation and start fresh server session |",
      "| `/model {id}` | Switch the active model |",
      "| `/cost` | Show session cost (server figures) |",
      "| `/new` | Open a new session tab |",
      "| `/export` | Export the conversation |",
      "| `/compact` | Compact session context |",
      "| `/continue` | Resume most recently closed session |",
      "| `/help` | Show this help table |",
    ].join("\n")

    postMessage({
      type: "message",
      sessionId,
      message: {
        role: "system",
        id: `help-${crypto.randomUUID()}`,
        blocks: [{ type: "text", text: `Available slash commands:\n\n${table}` }],
        timestamp: Date.now(),
        sessionId,
      },
    })
  }

  dispose(): void {}
}
