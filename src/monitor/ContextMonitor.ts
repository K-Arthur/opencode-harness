import * as vscode from "vscode"

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimateContextTokens(pkg: { openFiles: { content: string; path: string }[]; terminalOutput?: { text: string }; diagnostics?: unknown; gitStatus?: unknown; workspaceTree?: unknown; projectConfigs?: unknown[] }): number {
  let total = 0
  for (const file of pkg.openFiles) {
    total += estimateTokens(file.content)
    total += estimateTokens(file.path)
  }
  if (pkg.terminalOutput) total += estimateTokens(pkg.terminalOutput.text)
  total += estimateTokens(JSON.stringify(pkg.diagnostics ?? {}))
  total += estimateTokens(JSON.stringify(pkg.gitStatus ?? {}))
  total += estimateTokens(JSON.stringify(pkg.workspaceTree ?? {}))
  total += estimateTokens(JSON.stringify(pkg.projectConfigs ?? []))
  return total
}

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
