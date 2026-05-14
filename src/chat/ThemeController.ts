import * as vscode from "vscode"
import { ThemeManager, type OpencodeTheme, type ThemePreset } from "../theme/ThemeManager"
import { log } from "../utils/outputChannel"

/**
 * Validates color values in hex, rgba, or CSS variable format
 */
function isValidColorValue(value: string): boolean {
  if (!value || typeof value !== "string") return false
  
  const trimmed = value.trim()
  
  // Allow CSS variable references
  if (/^var\(--[\w-]+\)$/.test(trimmed)) return true
  
  // Allow transparent keyword
  if (trimmed === "transparent") return true
  
  // Validate hex format (#RGB or #RRGGBB)
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return true
  
  // Validate rgba/rgb format
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(trimmed)) return true
  
  return false
}

export class ThemeController {
  constructor(
    private readonly themeManager: ThemeManager,
    private readonly postMessage: (msg: Record<string, unknown>) => void
  ) {}

  pushThemeToWebview(): void {
    const vars = this.themeManager.getThemeVariables()
    this.postMessage({ type: "theme_vars", vars: vars.customVars })
  }

  pushThemeConfigToWebview(): void {
    this.postMessage({
      type: "theme_config",
      theme: this.getThemeConfig(),
    })
  }

  private getThemeConfig(): { preset: ThemePreset; overrides: OpencodeTheme } {
    const configTheme = vscode.workspace.getConfiguration("opencode").get<{ preset?: string; overrides?: OpencodeTheme }>("theme")
    return this.normalizeThemeConfig(configTheme)
  }

  async handleUpdateThemeConfig(theme: unknown): Promise<void> {
    try {
      const nextTheme = this.normalizeThemeConfig(theme)
      const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
      await vscode.workspace.getConfiguration("opencode").update("theme", nextTheme, target)
      this.themeManager.emitUpdate()
      this.pushThemeToWebview()
      this.pushThemeConfigToWebview()
    } catch (error) {
      log.error("Failed to update theme config", error)
      this.postMessage({ 
        type: "theme_config_error", 
        error: error instanceof Error ? error.message : "Unknown error" 
      })
    }
  }

  isValidThemeConfigPayload(theme: unknown): boolean {
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) return false
    const candidate = theme as { preset?: unknown; overrides?: unknown }
    if (candidate.preset !== undefined && typeof candidate.preset !== "string") return false
    if (candidate.overrides !== undefined && (typeof candidate.overrides !== "object" || candidate.overrides === null || Array.isArray(candidate.overrides))) return false
    if (candidate.overrides && Object.entries(candidate.overrides as Record<string, unknown>).some(([key, value]) =>
      key.length > 64 || typeof value !== "string" || value.length > 200
    )) return false
    return true
  }

  private normalizeThemeConfig(theme: unknown): { preset: ThemePreset; overrides: OpencodeTheme } {
    const validPresets = new Set<ThemePreset>(["cli-default", "light", "dark", "high-contrast", "high-contrast-dark", "high-contrast-light"])
    const source = theme && typeof theme === "object" && !Array.isArray(theme)
      ? theme as { preset?: unknown; overrides?: unknown }
      : {}
    const preset = typeof source.preset === "string" && validPresets.has(source.preset as ThemePreset)
      ? source.preset as ThemePreset
      : "cli-default"
    const overrides: Record<string, string> = {}
    if (source.overrides && typeof source.overrides === "object" && !Array.isArray(source.overrides)) {
      for (const [key, value] of Object.entries(source.overrides as Record<string, unknown>)) {
        if (/^[A-Za-z][A-Za-z0-9]*$/.test(key) && typeof value === "string") {
          const trimmed = value.trim()
          // Only include non-empty values that are valid colors
          if (trimmed && isValidColorValue(trimmed)) {
            overrides[key] = trimmed
          }
        }
      }
    }
    return { preset, overrides: overrides as OpencodeTheme }
  }
}
