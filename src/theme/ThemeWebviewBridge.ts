import * as vscode from "vscode"
import type { ThemeManager } from "./ThemeManager"

export class ThemeWebviewBridge {
  private disposables: vscode.Disposable[] = []

  constructor(
    private readonly themeManager: ThemeManager,
    private readonly postMessage: (msg: Record<string, unknown>) => void
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.pushThemeUpdate()
      })
    )

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("opencode.theme") || event.affectsConfiguration("workbench.colorTheme")) {
          this.themeManager.loadConfig()
          this.pushThemeUpdate()
        }
      })
    )

    this.disposables.push(
      themeManager.onThemeChanged(() => {
        this.pushThemeUpdate()
      })
    )
  }

  /**
   * Pushes the current theme CSS variables to the webview. Safe to call
   * repeatedly; the webview applies the latest values.
   */
  pushThemeUpdate(): void {
    const vars = this.themeManager.getThemeVariables()
    this.postMessage({ type: "theme_vars", vars: vars.customVars })
  }

  /**
   * Pushes the current theme configuration (preset + overrides) to the webview.
   */
  pushThemeConfig(): void {
    const config = vscode.workspace.getConfiguration("opencode")
    const theme = config.get<{ preset?: string; overrides?: Record<string, string> }>("theme")
    this.postMessage({ type: "theme_config", theme: theme ?? { preset: "cli-default", overrides: {} } })
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables = []
  }
}
