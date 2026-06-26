import * as vscode from "vscode"

export interface ThemeActivationRequest {
  preset?: string
  marketTheme?: string
}

export class ThemeAnalyzer {
  /**
   * Returns the currently active VS Code color theme kind.
   */
  getCurrentThemeKind(): vscode.ColorThemeKind {
    return vscode.window.activeColorTheme.kind
  }

  /**
   * Resolves a requested preset to the concrete built-in preset that should
   * be used for the current VS Code theme kind. High-contrast is the only
   * preset that needs runtime resolution.
   */
  resolveEffectivePreset(preset: string): string {
    if (preset !== "high-contrast") return preset
    switch (vscode.window.activeColorTheme.kind) {
      case vscode.ColorThemeKind.HighContrastLight:
        return "high-contrast-light"
      case vscode.ColorThemeKind.HighContrast:
      case vscode.ColorThemeKind.Dark:
        return "high-contrast-dark"
      default:
        return "high-contrast-light"
    }
  }

  /**
   * Maps a concrete built-in preset to the VS Code color theme kind it
   * represents. Used when deciding whether a workbench mode switch is needed.
   */
  getTargetKindForPreset(preset: string): vscode.ColorThemeKind | undefined {
    switch (preset) {
      case "light":
      case "high-contrast-light":
        return vscode.ColorThemeKind.Light
      case "dark":
      case "high-contrast-dark":
        return vscode.ColorThemeKind.Dark
      case "high-contrast":
        return vscode.ColorThemeKind.HighContrast
      default:
        return undefined
    }
  }

  /**
   * Determines whether a requested market theme ID is contributed by any
   * installed extension. VS Code does not expose a theme registry API, so we
   * scan extension package.json contributions for color themes.
   */
  isMarketThemeAvailable(themeId: string): boolean {
    const normalized = themeId.toLowerCase()
    for (const ext of vscode.extensions.all) {
      const themes = ext.packageJSON?.contributes?.themes
      if (!Array.isArray(themes)) continue
      for (const theme of themes) {
        const id = typeof theme.id === "string" ? theme.id.toLowerCase() : ""
        const label = typeof theme.label === "string" ? theme.label.toLowerCase() : ""
        if (id === normalized || label === normalized) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Collects all color theme IDs and labels contributed by installed extensions.
   */
  getAvailableMarketThemeIds(): string[] {
    const ids: string[] = []
    for (const ext of vscode.extensions.all) {
      const themes = ext.packageJSON?.contributes?.themes
      if (!Array.isArray(themes)) continue
      for (const theme of themes) {
        if (typeof theme.id === "string") ids.push(theme.id)
        else if (typeof theme.label === "string") ids.push(theme.label)
      }
    }
    return [...new Set(ids)]
  }

  /**
   * Computes the best built-in VS Code workbench theme to switch to when a
   * dark/light mode change is requested. Returns undefined when no switch is
   * needed (i.e. the current theme kind already matches).
   */
  getWorkbenchThemeForMode(targetKind: vscode.ColorThemeKind): string | undefined {
    const currentKind = vscode.window.activeColorTheme.kind
    if (currentKind === targetKind) return undefined

    switch (targetKind) {
      case vscode.ColorThemeKind.Light:
        return "Default Light Modern"
      case vscode.ColorThemeKind.Dark:
        return "Default Dark Modern"
      case vscode.ColorThemeKind.HighContrast:
        return "Default High Contrast"
      case vscode.ColorThemeKind.HighContrastLight:
        return "Default High Contrast Light"
      default:
        return undefined
    }
  }
}
