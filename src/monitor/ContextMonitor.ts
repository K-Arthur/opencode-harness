import * as vscode from "vscode"
import { estimateContextTokens } from "../utils/tokenCounter"

export class ContextMonitor {
  private statusBarItem: vscode.StatusBarItem
  private currentTokens = 0
  private tokenLimit = 100000

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.statusBarItem.name = "OpenCode Harness Context"
    this.statusBarItem.command = "opencode-harness.openChat"
    this.render()
    this.statusBarItem.show()
  }

  updateTokens(tokensUsed: number): void {
    this.currentTokens = tokensUsed
    this.render()
  }

  private render(): void {
    const percentage = Math.min(100, Math.round((this.currentTokens / this.tokenLimit) * 100))
    const icon = percentage < 50 ? "\u25C9" : percentage < 75 ? "\u25CE" : "\u25CF"
    this.statusBarItem.text = `${icon} OC ${percentage}%`
    this.statusBarItem.tooltip = `OpenCode Harness — ~${Math.round(this.currentTokens / 1000)}k / ${Math.round(this.tokenLimit / 1000)}k tokens`
    if (percentage > 90) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
    } else if (percentage > 75) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
    } else {
      this.statusBarItem.backgroundColor = undefined
    }
  }

  showWarning(message: string): void {
    vscode.window.showWarningMessage(message)
  }

  dispose(): void {
    this.statusBarItem.dispose()
  }
}
