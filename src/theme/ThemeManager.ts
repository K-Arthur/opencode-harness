import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

export interface OpencodeTheme {
  userMessageBg?: string
  userMessageFg?: string
  assistantMessageBg?: string
  assistantMessageFg?: string
  toolCallColor?: string
  toolReadColor?: string
  toolWriteColor?: string
  toolExecColor?: string
  skillBadgeBg?: string
  skillBadgeFg?: string
  thinkingBg?: string
  thinkingBorder?: string
  warningColor?: string
  errorColor?: string
  successColor?: string
  accentColor?: string
  diffAdded?: string
  diffRemoved?: string
  inputBg?: string
  inputBorder?: string
  mentionBg?: string

  syntaxComment?: string
  syntaxKeyword?: string
  syntaxString?: string
  syntaxNumber?: string
  syntaxFunction?: string
  syntaxType?: string
  syntaxOperator?: string
}

export type ThemePreset = "cli-default" | "light" | "dark" | "high-contrast"

/**
 * BUILT_IN_PRESETS: Modernized "Cyber-Industrial" palette.
 * These act as fallback values when VS Code tokens aren't enough or when
 * the user explicitly chooses a specific OpenCode look.
 */
const BUILT_IN_PRESETS: Record<ThemePreset, OpencodeTheme> = {
  "cli-default": {
    userMessageBg: "var(--vscode-editor-background)",
    userMessageFg: "var(--vscode-editor-foreground)",
    assistantMessageBg: "rgba(30, 30, 30, 0.4)",
    assistantMessageFg: "var(--vscode-editor-foreground)",
    toolCallColor: "var(--vscode-symbolIcon-propertyForeground)",
    toolReadColor: "var(--vscode-symbolIcon-variableForeground)",
    toolWriteColor: "var(--vscode-errorForeground)",
    toolExecColor: "var(--vscode-debugIcon-startForeground)",
    skillBadgeBg: "var(--vscode-badge-background)",
    skillBadgeFg: "var(--vscode-badge-foreground)",
    thinkingBg: "rgba(210, 153, 34, 0.08)",
    thinkingBorder: "var(--vscode-charts-yellow)",
    warningColor: "var(--vscode-list-warningForeground)",
    errorColor: "var(--vscode-errorForeground)",
    successColor: "var(--vscode-charts-green)",
    accentColor: "var(--vscode-button-background)",
    diffAdded: "var(--vscode-diffEditor-insertedTextBackground)",
    diffRemoved: "var(--vscode-diffEditor-removedTextBackground)",
    inputBg: "var(--vscode-input-background)",
    inputBorder: "var(--vscode-input-border)",
    mentionBg: "var(--vscode-editor-selectionBackground)",
    syntaxComment: "var(--vscode-descriptionForeground)",
    syntaxKeyword: "var(--vscode-symbolIcon-keywordForeground)",
    syntaxString: "var(--vscode-symbolIcon-stringForeground)",
    syntaxNumber: "var(--vscode-symbolIcon-numberForeground)",
    syntaxFunction: "var(--vscode-symbolIcon-functionForeground)",
    syntaxType: "var(--vscode-symbolIcon-classForeground)",
    syntaxOperator: "var(--vscode-symbolIcon-operatorForeground)",
  },
  light: {
    userMessageBg: "#f3f3f3",
    userMessageFg: "#333333",
    assistantMessageBg: "rgba(255, 255, 255, 0.8)",
    assistantMessageFg: "#24292f",
    toolCallColor: "#953800",
    toolReadColor: "#0550ae",
    toolWriteColor: "#cf222e",
    toolExecColor: "#116329",
    skillBadgeBg: "#0550ae",
    skillBadgeFg: "#ffffff",
    thinkingBg: "rgba(210, 153, 34, 0.06)",
    thinkingBorder: "#bf8700",
    warningColor: "#bf8700",
    errorColor: "#cf222e",
    successColor: "#116329",
    accentColor: "#0969da",
    diffAdded: "rgba(45, 164, 78, 0.15)",
    diffRemoved: "rgba(207, 34, 46, 0.1)",
    inputBg: "#ffffff",
    inputBorder: "#d0d7de",
    mentionBg: "#ddf4ff",
    syntaxComment: "#6e7781",
    syntaxKeyword: "#0550ae",
    syntaxString: "#0a3069",
    syntaxNumber: "#0550ae",
    syntaxFunction: "#8250df",
    syntaxType: "#116329",
    syntaxOperator: "#1e1e1e",
  },
  dark: {
    userMessageBg: "#2d2d2d",
    userMessageFg: "#e0e0e0",
    assistantMessageBg: "rgba(30, 30, 30, 0.6)",
    assistantMessageFg: "#c9d1d9",
    toolCallColor: "#d19a66",
    toolReadColor: "#58a6ff",
    toolWriteColor: "#f85149",
    toolExecColor: "#3fb950",
    skillBadgeBg: "#00e5ff",
    skillBadgeFg: "#0b0e14",
    thinkingBg: "rgba(255, 171, 0, 0.05)",
    thinkingBorder: "#ffab00",
    warningColor: "#ffab00",
    errorColor: "#ff5252",
    successColor: "#00e676",
    accentColor: "#00e5ff",
    diffAdded: "rgba(63, 185, 80, 0.15)",
    diffRemoved: "rgba(248, 81, 73, 0.1)",
    inputBg: "#161b22",
    inputBorder: "#30363d",
    mentionBg: "#1f6feb",
    syntaxComment: "#8b949e",
    syntaxKeyword: "#ff7b72",
    syntaxString: "#a5d6ff",
    syntaxNumber: "#d2a8ff",
    syntaxFunction: "#d2a8ff",
    syntaxType: "#ffa657",
    syntaxOperator: "#79c0ff",
  },
  "high-contrast": {
    userMessageBg: "#000000",
    userMessageFg: "#ffffff",
    assistantMessageBg: "#000000",
    assistantMessageFg: "#ffffff",
    toolCallColor: "#ffff00",
    toolReadColor: "#00ffff",
    toolWriteColor: "#ff0000",
    toolExecColor: "#00ff00",
    skillBadgeBg: "#ffffff",
    skillBadgeFg: "#000000",
    thinkingBg: "rgba(255, 255, 0, 0.1)",
    thinkingBorder: "#ffff00",
    warningColor: "#ffff00",
    errorColor: "#ff0000",
    successColor: "#00ff00",
    accentColor: "#ffff00",
    diffAdded: "rgba(0, 255, 0, 0.2)",
    diffRemoved: "rgba(255, 0, 0, 0.2)",
    inputBg: "#000000",
    inputBorder: "#ffffff",
    mentionBg: "#ffffff",
    syntaxComment: "#ffffff",
    syntaxKeyword: "#ffff00",
    syntaxString: "#00ff00",
    syntaxNumber: "#00ffff",
    syntaxFunction: "#ff00ff",
    syntaxType: "#00ff00",
    syntaxOperator: "#ffffff",
  },
}

export interface ThemeVariables {
  kind: vscode.ColorThemeKind
  customVars: Record<string, string>
}

const CLI_THEME_CACHE_TTL_MS = 30_000 // 30 seconds

export class ThemeManager {
  private _onThemeChanged = new vscode.EventEmitter<ThemeVariables>()
  private disposables: vscode.Disposable[] = []
  readonly onThemeChanged = this._onThemeChanged.event

  private currentKind: vscode.ColorThemeKind = vscode.ColorThemeKind.Dark
  private currentPreset: ThemePreset = "cli-default"
  private userOverrides: OpencodeTheme = {}

  // Cache for CLI theme file reads to avoid synchronous FS calls on every render
  private cliThemeCache: OpencodeTheme | null = null
  private cliThemeCacheTimestamp = 0

  // File system watchers for CLI theme files
  private fileWatchers: vscode.FileSystemWatcher[] = []

  constructor() {
    this.currentKind = vscode.window.activeColorTheme.kind
    this.loadConfig()
    this.setupFileWatchers()

    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this.currentKind = theme.kind
        // Invalidate CLI cache on theme change in case files changed
        this.invalidateCliCache()
        this.emitUpdate()
      })
    )

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("opencode.theme")) {
          this.loadConfig()
          this.emitUpdate()
        }
      })
    )
  }

  /**
   * Watch tui.json and theme files for changes.
   * When a CLI theme file changes, invalidate cache and re-emit theme update.
   */
  private setupFileWatchers(): void {
    // Dispose old watchers
    for (const watcher of this.fileWatchers) {
      watcher.dispose()
    }
    this.fileWatchers = []

    const folders = vscode.workspace.workspaceFolders
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const isWindows = process.platform === "win32"
    const xdgConfig = process.env.XDG_CONFIG_HOME
      || (isWindows ? path.join(process.env.APPDATA || home, "opencode") : path.join(home, ".config"))

    const patterns: vscode.GlobPattern[] = []

    // Watch workspace tui.json
    if (folders && folders.length > 0) {
      patterns.push(new vscode.RelativePattern(folders[0]!, ".opencode/tui.json"))
      patterns.push(new vscode.RelativePattern(folders[0]!, ".opencode/themes/*.json"))
    }

    // Watch global tui.json
    patterns.push(new vscode.RelativePattern(vscode.Uri.file(path.join(xdgConfig, "opencode")), "tui.json"))
    patterns.push(new vscode.RelativePattern(vscode.Uri.file(path.join(xdgConfig, "opencode", "themes")), "*.json"))
    patterns.push(new vscode.RelativePattern(vscode.Uri.file(path.join(home, ".opencode")), "tui.json"))
    patterns.push(new vscode.RelativePattern(vscode.Uri.file(path.join(home, ".opencode", "themes")), "*.json"))

    for (const pattern of patterns) {
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        watcher.onDidChange(() => this.handleThemeFileChange())
        watcher.onDidCreate(() => this.handleThemeFileChange())
        watcher.onDidDelete(() => this.handleThemeFileChange())
        this.fileWatchers.push(watcher)
      } catch {
        // Pattern may be invalid for some paths — skip silently
      }
    }
  }

  private handleThemeFileChange(): void {
    this.invalidateCliCache()
    this.emitUpdate()
  }

  /**
   * Preview a theme by applying it live to the workspace settings.
   */
  async previewTheme(): Promise<void> {
    const presets = ["cli-default", "light", "dark", "high-contrast"] as ThemePreset[]
    const discovered = this.discoverCliThemes()

    const items: (vscode.QuickPickItem & { preset?: ThemePreset; themeFile?: string })[] = []

    for (const preset of presets) {
      items.push({
        label: preset,
        description: "Built-in preset",
        preset,
      })
    }

    if (discovered.length > 0) {
      items.push({ label: "CLI Themes", kind: vscode.QuickPickItemKind.Separator })
      for (const theme of discovered) {
        items.push({
          label: theme.name,
          description: theme.source,
          themeFile: theme.path,
        })
      }
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a theme to preview",
      title: "OpenCode Theme Preview",
    })

    if (!picked) return

    const config = vscode.workspace.getConfiguration("opencode")
    if (picked.preset) {
      await config.update("theme", { preset: picked.preset, overrides: {} }, vscode.ConfigurationTarget.Workspace)
    } else if (picked.themeFile) {
      // For CLI themes, we can't easily apply the whole file, so we set the preset
      // to cli-default and let the CLI discovery load the theme file
      await config.update("theme", { preset: "cli-default", overrides: {} }, vscode.ConfigurationTarget.Workspace)
    }
  }

  private discoverCliThemes(): Array<{ name: string; path: string; source: string }> {
    const themes: Array<{ name: string; path: string; source: string }> = []
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const isWindows = process.platform === "win32"
    const xdgConfig = process.env.XDG_CONFIG_HOME
      || (isWindows ? path.join(process.env.APPDATA || home, "opencode") : path.join(home, ".config"))

    const workspaceThemeDir: string | null = (() => {
      const folders = vscode.workspace.workspaceFolders
      if (folders && folders.length > 0) {
        return path.join(folders[0]!.uri.fsPath, ".opencode", "themes")
      }
      return null
    })()

    const themeDirs: Array<{ dir: string; source: string }> = []
    if (workspaceThemeDir) {
      themeDirs.push({ dir: workspaceThemeDir, source: "workspace" })
    }
    themeDirs.push({ dir: path.join(xdgConfig, "opencode", "themes"), source: "global" })
    themeDirs.push({ dir: path.join(home, ".opencode", "themes"), source: "global" })

    for (const { dir, source } of themeDirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir)
          for (const file of files) {
            if (file.endsWith(".json")) {
              themes.push({
                name: file.replace(".json", ""),
                path: path.join(dir, file),
                source,
              })
            }
          }
        }
      } catch {
        // Ignore unreadable directories
      }
    }
    return themes
  }

  private loadConfig(): void {
    const config = vscode.workspace.getConfiguration("opencode")
    const themeObj = config.get<{ preset?: string; overrides?: OpencodeTheme }>("theme")
    if (themeObj?.preset && ["cli-default", "light", "dark", "high-contrast"].includes(themeObj.preset)) {
      this.currentPreset = themeObj.preset as ThemePreset
    }
    this.userOverrides = themeObj?.overrides || {}
  }

  private invalidateCliCache(): void {
    this.cliThemeCache = null
    this.cliThemeCacheTimestamp = 0
  }

  private getCliPaths(): { tuiJsonPaths: string[]; themeDirs: string[] } {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const isWindows = process.platform === "win32"
    const xdgConfig = process.env.XDG_CONFIG_HOME
      || (isWindows ? path.join(process.env.APPDATA || home, "opencode") : path.join(home, ".config"))

    const tuiJsonPaths: string[] = []
    const themeDirs: string[] = []

    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      const workspaceConfig = path.join(folders[0]!.uri.fsPath, ".opencode")
      tuiJsonPaths.push(path.join(workspaceConfig, "tui.json"))
      themeDirs.push(path.join(workspaceConfig, "themes"))
    }

    tuiJsonPaths.push(path.join(xdgConfig, "opencode", "tui.json"))
    tuiJsonPaths.push(path.join(home, ".opencode", "tui.json"))
    themeDirs.push(path.join(xdgConfig, "opencode", "themes"))
    themeDirs.push(path.join(home, ".opencode", "themes"))

    return { tuiJsonPaths, themeDirs }
  }

  private readActiveThemeName(tuiJsonPaths: string[]): string {
    let activeTheme = "tokyonight"
    for (const tuiPath of tuiJsonPaths) {
      try {
        if (fs.existsSync(tuiPath)) {
          const raw = fs.readFileSync(tuiPath, "utf8")
          const content = JSON.parse(raw)
          if (content.theme && typeof content.theme === "string") {
            activeTheme = content.theme
            break
          }
        }
      } catch {
        // Malformed JSON or unreadable file — skip
      }
    }
    return activeTheme
  }

  private readThemeFileOverrides(themeDirs: string[], activeTheme: string): OpencodeTheme {
    const overrides: OpencodeTheme = {}
    const safeThemeName = activeTheme.replace(/[^\w.-]/g, "_")

    for (const dir of themeDirs) {
      try {
        const themeFile = path.join(dir, `${safeThemeName}.json`)
        if (fs.existsSync(themeFile)) {
          const raw = fs.readFileSync(themeFile, "utf8")
          const content = JSON.parse(raw)
          if (content.theme) {
            this.applyThemeContent(overrides, content.theme)
          }
          break
        }
      } catch {
        // Malformed theme file — skip
      }
    }

    return overrides
  }

  // Static field map: override key → theme section key
  private static readonly FIELD_MAP: Array<[keyof OpencodeTheme, string]> = [
    ["accentColor", "primary"],
    ["errorColor", "error"],
    ["warningColor", "warning"],
    ["successColor", "success"],
    ["assistantMessageFg", "text"],
    ["assistantMessageBg", "background"],
    ["diffAdded", "diffAdded"],
    ["diffRemoved", "diffRemoved"],
    ["syntaxComment", "syntaxComment"],
    ["syntaxKeyword", "syntaxKeyword"],
    ["syntaxString", "syntaxString"],
    ["syntaxNumber", "syntaxNumber"],
    ["syntaxFunction", "syntaxFunction"],
    ["syntaxType", "syntaxType"],
    ["syntaxOperator", "syntaxOperator"],
  ]

  private applyThemeContent(overrides: OpencodeTheme, theme: Record<string, { dark?: string }>): void {
    for (const [overrideKey, themeKey] of ThemeManager.FIELD_MAP) {
      const section = theme[themeKey]
      if (section?.dark) {
        overrides[overrideKey] = section.dark
      }
    }
  }

  // Static CSS variable map: CSS variable name → merged theme property
  private static readonly CSS_VAR_MAP: Array<[string, keyof OpencodeTheme]> = [
    ["--oc-user-msg-bg", "userMessageBg"],
    ["--oc-user-msg-fg", "userMessageFg"],
    ["--oc-assistant-msg-bg", "assistantMessageBg"],
    ["--oc-assistant-msg-fg", "assistantMessageFg"],
    ["--oc-tool-call", "toolCallColor"],
    ["--oc-tool-read", "toolReadColor"],
    ["--oc-tool-write", "toolWriteColor"],
    ["--oc-tool-exec", "toolExecColor"],
    ["--oc-skill-badge-bg", "skillBadgeBg"],
    ["--oc-skill-badge-fg", "skillBadgeFg"],
    ["--oc-thinking-bg", "thinkingBg"],
    ["--oc-thinking-border", "thinkingBorder"],
    ["--oc-warning", "warningColor"],
    ["--oc-error", "errorColor"],
    ["--oc-success", "successColor"],
    ["--oc-accent", "accentColor"],
    ["--oc-diff-added", "diffAdded"],
    ["--oc-diff-removed", "diffRemoved"],
    ["--oc-input-bg", "inputBg"],
    ["--oc-input-border", "inputBorder"],
    ["--oc-mention-bg", "mentionBg"],
    ["--oc-syntax-comment", "syntaxComment"],
    ["--oc-syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "syntaxString"],
    ["--oc-syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "syntaxType"],
    ["--oc-syntax-operator", "syntaxOperator"],
  ]

  private readCliThemeFiles(): OpencodeTheme {
    const now = Date.now()
    if (this.cliThemeCache && (now - this.cliThemeCacheTimestamp) < CLI_THEME_CACHE_TTL_MS) {
      return this.cliThemeCache
    }

    const { tuiJsonPaths, themeDirs } = this.getCliPaths()
    const activeTheme = this.readActiveThemeName(tuiJsonPaths)
    const overrides = this.readThemeFileOverrides(themeDirs, activeTheme)

    this.cliThemeCache = overrides
    this.cliThemeCacheTimestamp = now
    return overrides
  }

  getThemeKind(): vscode.ColorThemeKind {
    return this.currentKind
  }

  getThemeVariables(): ThemeVariables {
    const preset = BUILT_IN_PRESETS[this.currentPreset] || BUILT_IN_PRESETS["cli-default"]
    const cliOverrides = this.readCliThemeFiles()
    const merged = { ...preset, ...cliOverrides, ...this.userOverrides }

    // Filter out undefined values to avoid injecting "undefined" as CSS
    const customVars: Record<string, string> = {}
    for (const [cssVar, themeKey] of ThemeManager.CSS_VAR_MAP) {
      const value = merged[themeKey]
      if (value !== undefined && value !== null) {
        customVars[cssVar] = value
      }
    }

    return {
      kind: this.currentKind,
      customVars,
    }
  }

  emitUpdate(): void {
    this._onThemeChanged.fire(this.getThemeVariables())
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    for (const watcher of this.fileWatchers) {
      watcher.dispose()
    }
    this.fileWatchers = []
    this._onThemeChanged.dispose()
  }
}
