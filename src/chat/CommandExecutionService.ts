import * as vscode from "vscode"
import type { TabManager } from "./TabManager"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { StatePushService } from "./StatePushService"
import type { SessionManager } from "../session/SessionManager"
import type { SessionStore } from "../session/SessionStore"
import type { PromptManager } from "../prompts/PromptManager"
import type { ChatCommands } from "./ChatCommands"
import type { ChatMessage, Block } from "./types"
import { parseModelRef } from "../utils/tokenCounter"
import { log } from "../utils/outputChannel"

export interface CommandExecOptions {
  tabManager: TabManager
  streamCoordinator: StreamCoordinator
  statePush: StatePushService
  sessionManager: SessionManager
  sessionStore: SessionStore
  promptManager: PromptManager
  chatCommands: ChatCommands
  showWarningMessage: (msg: string) => void
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
  sendPromptToWebview: (text: string, autoSend: boolean) => void
}

export class CommandExecutionService {
  constructor(private opts: CommandExecOptions) {}

  async handleExecuteCommand(sessionId?: string, command?: string, args?: string): Promise<void> {
    if (!sessionId || !command) return

    const rawCommand = command.trim()
    const commandName = rawCommand.replace(/^\//, "").toLowerCase()

    if (await this.handleLocalSlashCommand(sessionId, commandName, args)) {
      return
    }

    const customPrompt = this.opts.promptManager.getPrompt(commandName)
    if (customPrompt) {
      const resolved = await this.resolveCustomPromptVariables(commandName)
      if (resolved) {
        this.opts.sendPromptToWebview(resolved, true)
      }
      return
    }

    const tab = this.opts.tabManager.getTab(sessionId)
    if (!tab) {
      this.opts.postRequestError("Cannot execute command: no active session", sessionId)
      return
    }

    if (!this.opts.sessionManager.isRunning) {
      this.opts.postRequestError("Cannot execute command: server not running", sessionId)
      return
    }

    if (!tab.cliSessionId) {
      try {
        const cliSessionId = await this.opts.sessionManager.ensureSession(undefined, `Tab ${sessionId.slice(0, 8)}`)
        this.opts.tabManager.setCliSessionId(sessionId, cliSessionId)
        this.opts.sessionStore.updateCliSessionId(sessionId, cliSessionId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create server session"
        this.opts.postRequestError(`Cannot execute command: ${msg}`, sessionId)
        return
      }
    }

    await this.executeRemoteCommand(tab, sessionId, commandName, args)
  }

  async handleLocalSlashCommand(sessionId: string, commandName: string, args?: string): Promise<boolean> {
    switch (commandName) {
      case "clear":
        await this.handleClear(sessionId)
        return true
      case "cost":
        await this.handleCost(sessionId)
        return true
      case "continue":
        await this.handleContinue(sessionId)
        return true
      case "help":
        this.handleHelp(sessionId)
        return true
      case "methodology":
        this.opts.chatCommands.methodology(sessionId, args ?? "", (m) => this.opts.postMessage(m))
        return true
      case "diagnose:generation":
        this.opts.chatCommands.diagnoseGeneration()
        return true
      default:
        return false
    }
  }

  async abortCurrentSession(): Promise<void> {
    const activeTab = this.opts.tabManager.getActiveTab()
    const activeId = activeTab?.id
    if (activeId) {
      await this.opts.streamCoordinator.abort(activeId, {
        postMessage: (m) => this.opts.postMessage(m),
        postRequestError: (m) => this.opts.postRequestError(m),
      })
    }
  }

  private async handleClear(sessionId: string): Promise<void> {
    await this.opts.chatCommands.clear(sessionId,
      (m) => this.opts.postMessage(m),
      (m) => this.opts.postRequestError(m)
    )
  }

  private async handleCost(sessionId: string): Promise<void> {
    await this.opts.chatCommands.cost(sessionId, (m) => this.opts.postMessage(m))
  }

  private async handleContinue(sessionId: string): Promise<void> {
    this.opts.chatCommands.continue(sessionId, (m) => this.opts.postRequestError(m))
  }

  private handleHelp(sessionId: string): void {
    this.opts.chatCommands.help(sessionId, (m) => this.opts.postMessage(m))
  }

  private async executeRemoteCommand(
    tab: NonNullable<ReturnType<TabManager["getTab"]>>,
    sessionId: string,
    commandName: string,
    args?: string
  ): Promise<void> {
    // Echo the command as a user message so the transcript shows what was run,
    // matching CLI behavior. Without this the assistant output appears with no
    // prior context — the user's typed command was already cleared from the
    // input bar by the webview dispatcher.
    const echoText = args ? `/${commandName} ${args}` : `/${commandName}`
    const userEcho: ChatMessage = {
      role: "user",
      id: `cmd-echo-${crypto.randomUUID()}`,
      blocks: [{ type: "text", text: echoText }],
      timestamp: Date.now(),
      sessionId,
    }
    this.opts.sessionStore.appendMessage(sessionId, userEcho)
    this.opts.postMessage({ type: "message", sessionId, message: userEcho })

    try {
      const _modelRef = tab.model ? parseModelRef(tab.model) : undefined
      const result = await this.opts.sessionManager.sendCommand(tab.cliSessionId!, commandName, args)

      const blocks = this.parseCommandResult(result, sessionId)

      if (blocks.length > 0) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          blocks,
          timestamp: Date.now(),
          sessionId,
        }
        this.opts.sessionStore.appendMessage(sessionId, assistantMsg)
      }

      this.opts.postMessage({
        type: "stream_end",
        sessionId,
        messageId: `cmd-${crypto.randomUUID()}`,
        blocks,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command execution failed"
      log.error("Command execution failed", err)
      this.opts.postRequestError(message, sessionId)
    }
  }

  private parseCommandResult(result: unknown, _sessionId: string): Block[] {
    const blocks: Block[] = []
    const parts = (result as { parts?: unknown[] }).parts || []
    for (const part of parts) {
      const p = part as { type?: string; text?: string; tool?: string; state?: { output?: string; error?: string } }
      if (p.type === "text" && p.text) {
        blocks.push({ type: "text", text: p.text })
      } else if (p.type === "tool") {
        blocks.push({
          type: "tool_call",
          toolName: p.tool || "unknown",
          result: p.state?.output ?? p.state?.error ?? "",
          state: p.state?.error ? "error" : "completed",
        })
      }
    }
    return blocks
  }

  private async resolveCustomPromptVariables(name: string): Promise<string | null> {
    const editor = vscode.window.activeTextEditor
    const variables: Record<string, string> = {
      selection: editor ? editor.document.getText(editor.selection) : "",
      file: editor ? vscode.workspace.asRelativePath(editor.document.uri) : "",
      language: editor ? editor.document.languageId : "",
    }

    try {
      variables.clipboard = await vscode.env.clipboard.readText()
    } catch {
      variables.clipboard = ""
    }

    return this.opts.promptManager.resolvePrompt(name, variables)
  }
}
