import * as vscode from "vscode"

export class TerminalBridge {
  private outputChannel: vscode.OutputChannel
  private capturedOutput = ""

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("OpenCode Harness", { log: true })
    this.outputChannel.appendLine("[OpenCode Harness] Terminal bridge initialized")
  }

  log(level: string, message: string): void {
    const timestamp = new Date().toISOString()
    this.outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${this.redactSecrets(message)}`)
  }

  private redactSecrets(message: string): string {
    return message
      .replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
  }

  async captureTerminalSelection(): Promise<string> {
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
  }

  getCapturedOutput(): string { return this.capturedOutput }

  clearCapturedOutput(): void { this.capturedOutput = "" }

  show(): void { this.outputChannel.show() }

  dispose(): void { this.outputChannel.dispose() }
}
