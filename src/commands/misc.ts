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
          vscode.window.showInformationMessage("OpenCode CLI is working correctly. You can start using the extension.")
        } else {
          vscode.window.showErrorMessage("OpenCode CLI check failed. Try reinstalling with 'OpenCode: Install CLI' or check the output channel for details.")
        }
      } catch (err) {
        log.error("CLI diagnostics command failed", err)
        vscode.window.showErrorMessage("Could not run CLI diagnostics. Check the OpenCode output channel, then try again.")
      }
    })
  )
}

/**
 * Register the "OpenCode: Install CLI" command. Lets the user trigger the
 * opencode CLI install on demand (command palette, or the not-connected
 * affordance). On success, `onInstalled` is invoked to start the server.
 */
export function registerInstallCliCommand(
  context: vscode.ExtensionContext,
  installer: { install: () => Promise<boolean> },
  onInstalled: () => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.installCli", async () => {
      try {
        const ok = await installer.install()
        if (ok) {
          vscode.window.showInformationMessage("OpenCode CLI installed successfully. Starting the server…")
          onInstalled()
        }
      } catch (err) {
        log.error("Install CLI command failed", err)
        vscode.window.showErrorMessage("OpenCode CLI installation failed. Check the output channel for details, or try installing manually from https://opencode.ai/install")
      }
    })
  )
}

export function registerStopCommand(
  context: vscode.ExtensionContext,
  chatProvider: { abortCurrentSession: () => Promise<void> }
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.stop", async () => {
      try {
        await chatProvider.abortCurrentSession()
      } catch (err) {
        log.error("Stop command failed", err)
      }
    })
  )
}

/**
 * Register VS Code commands that map to the in-webview slash commands so they are also
 * invokable from the command palette. The handlers target the currently-active chat tab.
 */
export function registerSlashCommandShortcuts(
  context: vscode.ExtensionContext,
  chatProvider: {
    runSlashCommandOnActiveTab: (name: string) => Promise<void>
    openCommandsPalette: () => void
  }
): void {
  const map: Array<{ id: string; slash: string }> = [
    { id: "opencode-harness.clearSession",   slash: "clear" },
    { id: "opencode-harness.showCost",       slash: "cost" },
    { id: "opencode-harness.continueSession", slash: "continue" },
    { id: "opencode-harness.showHelp",       slash: "help" },
  ]
  for (const { id, slash } of map) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await chatProvider.runSlashCommandOnActiveTab(slash)
        } catch (err) {
          log.error(`${id} failed`, err)
        }
      })
    )
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openCommandsPalette", () => {
      try { chatProvider.openCommandsPalette() }
      catch (err) { log.error("openCommandsPalette failed", err) }
    })
  )
}
