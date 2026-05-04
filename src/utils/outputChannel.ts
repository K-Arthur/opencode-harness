import * as vscode from "vscode"

/**
 * Centralised output channel for the OpenCode Harness extension.
 * Every module should log through this instead of console.log / console.error
 * so that all activity is visible in the "OpenCode Harness" output channel.
 */
class OutputChannelService {
  private channel: vscode.OutputChannel

  constructor() {
    this.channel = vscode.window.createOutputChannel("OpenCode Harness")
  }

  get outputChannel(): vscode.OutputChannel {
    return this.channel
  }

  info(message: string): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [INFO] ${message}`)
  }

  warn(message: string, err?: unknown): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [WARN] ${message}`)
    if (err instanceof Error) {
      this.channel.appendLine(`  ${err.stack || err.message}`)
    } else if (err !== undefined) {
      this.channel.appendLine(`  ${String(err)}`)
    }
  }

  error(message: string, err?: unknown): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [ERROR] ${message}`)
    if (err instanceof Error) {
      this.channel.appendLine(`  ${err.stack || err.message}`)
    } else if (err !== undefined) {
      this.channel.appendLine(`  ${String(err)}`)
    }
  }

  debug(message: string): void {
    const ts = new Date().toISOString()
    this.channel.appendLine(`[${ts}] [DEBUG] ${message}`)
  }

  show(): void {
    this.channel.show(true)
  }

  dispose(): void {
    this.channel.dispose()
  }
}

/** Singleton instance – created once during activation. */
export const log = new OutputChannelService()