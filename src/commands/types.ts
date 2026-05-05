import * as vscode from "vscode"
import { SessionStore } from "../session/SessionStore"
import { SessionManager } from "../session/SessionManager"
import { ModelManager } from "../model/ModelManager"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { CheckpointManager } from "../checkpoint/CheckpointManager"
import { CliDiagnostics } from "../diagnostics/CliDiagnostics"
import { ThemeManager } from "../theme/ThemeManager"
import { TerminalBridge } from "../terminal/TerminalBridge"
import { SessionExporter } from "../session/SessionExporter"

export interface CommandContext {
  vscodeContext: vscode.ExtensionContext
  sessionStore: SessionStore
  sessionManager: SessionManager
  modelManager: ModelManager
  rateLimitMonitor: RateLimitMonitor
  checkpointManager: CheckpointManager
  cliDiagnostics: CliDiagnostics
  themeManager: ThemeManager
  terminalBridge: TerminalBridge
  sessionExporter: SessionExporter
}

export type CommandHandler = (context: CommandContext) => void | Promise<void>

export interface CommandRegistration {
  command: string
  handler: CommandHandler
}
