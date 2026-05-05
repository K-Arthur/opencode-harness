import * as vscode from "vscode"
import { ThemeManager } from "../theme/ThemeManager"
import { TerminalBridge } from "../terminal/TerminalBridge"
import { log } from "../utils/outputChannel"

export function registerThemePreviewCommand(
  context: vscode.ExtensionContext,
  themeManager: ThemeManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.previewTheme", async () => {
      try {
        await themeManager.previewTheme()
      } catch (err) {
        log.error("Theme preview command failed", err)
        vscode.window.showErrorMessage("Failed to preview theme.")
      }
    })
  )
}

export function registerCaptureTerminalCommand(
  context: vscode.ExtensionContext,
  terminalBridge: TerminalBridge
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.captureTerminal", async () => {
      try {
        await terminalBridge.captureTerminalSelection()
      } catch (err) {
        log.error("Terminal capture command failed", err)
        vscode.window.showErrorMessage("Failed to capture terminal output.")
      }
    })
  )
}
