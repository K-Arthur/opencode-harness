import * as vscode from "vscode"
import { RateLimitMonitor } from "../monitor/RateLimitMonitor"
import { CliDiagnostics } from "../diagnostics/CliDiagnostics"
import { SessionManager } from "../session/SessionManager"
import { log } from "../utils/outputChannel"

export function registerShowRateLimitsCommand(
  context: vscode.ExtensionContext,
  rateLimitMonitor: RateLimitMonitor
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.showRateLimits", async () => {
      try {
        await rateLimitMonitor.showDetail()
      } catch (err) {
        log.error("Failed to show rate limits", err)
      }
    })
  )
}

export function registerCheckCliCommand(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  cliDiagnostics: CliDiagnostics
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.checkCli", async () => {
      try {
        const ok = await cliDiagnostics.check(sessionManager.isRunning ? sessionManager.currentPort : undefined)
        if (ok) {
          vscode.window.showInformationMessage("OpenCode CLI is working correctly.")
        } else {
          vscode.window.showErrorMessage("OpenCode CLI check failed. See 'OpenCode Harness' output channel for details.")
        }
      } catch (err) {
        log.error("CLI diagnostics command failed", err)
        vscode.window.showErrorMessage("Failed to run CLI diagnostics. Check the OpenCode output channel for details.")
      }
    })
  )
}
