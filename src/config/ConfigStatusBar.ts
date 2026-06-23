import type * as vscode from "vscode"
import type { ConfigLoadStatus } from "../config/types"

/**
 * Status bar indicator for workspace config (opencode.jsonc) status.
 * Shows a green check when config is loaded, a warning when parse error,
 * and hides when no config file is found.
 */
export class ConfigStatusBar {
  private statusItem: vscode.StatusBarItem | undefined

  constructor(
    private readonly vscodeApi: typeof vscode,
    alignment?: vscode.StatusBarAlignment,
    private readonly priority: number = 97,
  ) {
    this.statusItem = undefined
    this._alignment = alignment ?? vscodeApi.StatusBarAlignment.Left
  }

  private _alignment: vscode.StatusBarAlignment

  /**
   * Create and show the status bar item. Called once during activation.
   */
  show(): void {
    if (this.statusItem) return
    this.statusItem = this.vscodeApi.window.createStatusBarItem(this._alignment, this.priority)
    this.statusItem.name = "OpenCode Config"
    this.statusItem.command = "opencode-harness.openConfigFile"
    this.statusItem.show()
  }

  /**
   * Update the status bar to reflect the current config load status.
   */
  update(status: ConfigLoadStatus, configPath?: string): void {
    if (!this.statusItem) return
    switch (status) {
      case "ok":
        this.statusItem.text = "$(settings-gear) config"
        this.statusItem.tooltip = configPath
          ? `Workspace config loaded: ${configPath}`
          : "Workspace config loaded"
        this.statusItem.backgroundColor = undefined
        break
      case "parse_error":
        this.statusItem.text = "$(warning) config!"
        this.statusItem.tooltip = configPath
          ? `Config parse error in ${configPath}. Click to open.`
          : "Config parse error. Click to open."
        this.statusItem.backgroundColor = new this.vscodeApi.ThemeColor("statusBarItem.warningBackground")
        break
      case "not_found":
        this.statusItem.text = "$(settings) no config"
        this.statusItem.tooltip = "No opencode.jsonc found in workspace"
        this.statusItem.backgroundColor = undefined
        break
    }
  }

  dispose(): void {
    this.statusItem?.dispose()
    this.statusItem = undefined
  }
}
