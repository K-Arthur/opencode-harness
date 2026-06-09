import * as vscode from "vscode"
import { SessionManager } from "../session/SessionManager"
import { SessionStore } from "../session/SessionStore"
import { CommandExecutionService } from "./CommandExecutionService"
import { TabManager } from "./TabManager"

export interface SlashCommandServiceDeps {
  sessionManager: SessionManager
  sessionStore: SessionStore
  commandExec: CommandExecutionService
  tabManager: TabManager
  postMessage: (msg: Record<string, unknown>) => void
  getActiveSessionId: () => string | undefined
}

export class SlashCommandService {
  constructor(private deps: SlashCommandServiceDeps) {}

  async runSlashCommandOnActiveTab(commandName: string): Promise<void> {
    const sid = this.deps.tabManager.getActiveTab()?.id
    if (!sid) {
      vscode.window.showInformationMessage("Open a chat session before running this command.")
      return
    }
    await this.deps.commandExec.handleLocalSlashCommand(sid, commandName)
  }

  openCommandsPalette(): void {
    this.deps.postMessage({ type: "open_commands_palette" })
  }

  async handleClearCommand(sessionId: string): Promise<void> {
    await this.deps.commandExec.handleLocalSlashCommand(sessionId, "clear")
  }

  async handleCostCommand(sessionId: string): Promise<void> {
    await this.deps.commandExec.handleLocalSlashCommand(sessionId, "cost")
  }

  async handleContinueCommand(sessionId: string): Promise<void> {
    await this.deps.commandExec.handleLocalSlashCommand(sessionId, "continue")
  }

  async abortCurrentSession(): Promise<void> {
    return this.deps.commandExec.abortCurrentSession()
  }

  handleHelpCommand(sessionId: string): void {
    void this.deps.commandExec.handleLocalSlashCommand(sessionId, "help")
  }
}
