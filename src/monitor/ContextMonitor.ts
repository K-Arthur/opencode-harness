import * as vscode from "vscode"
import { estimateContextTokens } from "../utils/tokenCounter"

export interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
}

export class ContextMonitor {
  private currentTokens = 0
  private tokenLimit = 100000
  private onContextChangedEmitter = new vscode.EventEmitter<ContextUsage>()

  readonly onContextChanged = this.onContextChangedEmitter.event

  constructor() {
  }

  /**
   * Update the token limit dynamically based on the active model.
   */
  setTokenLimit(limit: number): void {
    if (limit > 0 && limit !== this.tokenLimit) {
      this.tokenLimit = limit
      // Re-evaluate current usage with new limit
      this.updateTokens(this.currentTokens)
    }
  }

  /**
   * Read the autoCompact setting from VS Code configuration.
   */
  getAutoCompactSetting(): "ask" | "auto" | "off" {
    const config = vscode.workspace.getConfiguration("opencode")
    const value = config.get<string>("autoCompact", "ask")
    if (value === "auto" || value === "off") return value
    return "ask"
  }

  updateTokens(tokensUsed: number): void {
    this.currentTokens = tokensUsed
    const usage: ContextUsage = {
      percent: Math.min(100, Math.round((this.currentTokens / this.tokenLimit) * 100)),
      tokens: this.currentTokens,
      maxTokens: this.tokenLimit,
    }
    this.onContextChangedEmitter.fire(usage)
  }

  showWarning(message: string): void {
    vscode.window.showWarningMessage(message)
  }

  dispose(): void {
    this.onContextChangedEmitter.dispose()
  }
}
