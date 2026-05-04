import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export class TerminalBridge {
  private capturedOutput = ""

  constructor() {
    log.info("Terminal bridge initialized")
  }

  log(level: string, message: string): void {
    // Guard against non-string message values
    if (typeof message !== "string") {
      message = String(message ?? "")
    }
    const redacted = this.redactSecrets(message)
    if (level.toLowerCase() === "error") log.error(redacted)
    else if (level.toLowerCase() === "warn") log.warn(redacted)
    else log.info(redacted)
  }

  private redactSecrets(message: string): string {
    return message
      // Redact known API key / secret prefixes (sk-, AKIA, ghp_, gho_, glpat-, xox[bpas]-)
      .replace(/\b(?:sk-|AKIA|ghp_|gho_|glpat-|xox[bpas]-)[A-Za-z0-9_\-]{10,}\b/g, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      // Redact common password/secret assignment patterns
      .replace(/(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"']{4,}/gi, (m) => m.split(/[:=]/)[0] + "= [REDACTED]")
      // Redact connection strings (mongodb://, postgresql://, mysql://, etc.)
      .replace(/(?:mongodb|postgres(?:ql)?|mysql|redis|amqp|ftp|jdbc)[+a-z]*:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION]")
  }

  async captureTerminalSelection(): Promise<string> {
    try {
      const terminals = vscode.window.terminals
      const activeTerminal = vscode.window.activeTerminal || terminals[0]
      if (!activeTerminal) {
        vscode.window.showWarningMessage("No active terminal found.")
        return ""
      }
      activeTerminal.show()
      const selection = await vscode.env.clipboard.readText()
      if (selection) {
        this.capturedOutput = selection
        vscode.window.showInformationMessage("Terminal output captured. Use @terminal in chat to include it.")
      }
      return selection
    } catch (err) {
      log.error("Failed to capture terminal selection", err)
      vscode.window.showErrorMessage("Could not read clipboard. Ensure clipboard access is permitted.")
      return ""
    }
  }

  getCapturedOutput(): string { return this.capturedOutput }

  clearCapturedOutput(): void { this.capturedOutput = "" }

  show(): void { log.outputChannel.show() }

  dispose(): void {}
}
