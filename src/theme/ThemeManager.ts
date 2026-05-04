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

  constructor() {
    this.currentKind = vscode.window.activeColorTheme.kind
    this.loadConfig()

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

  private readCliThemeFiles(): OpencodeTheme {
    // Return cached result if still fresh
    const now = Date.now()
    if (this.cliThemeCache && (now - this.cliThemeCacheTimestamp) < CLI_THEME_CACHE_TTL_MS) {
      return this.cliThemeCache
    }

    const home = process.env.HOME || process.env.USERPROFILE || ""
    const isWindows = process.platform === "win32"
    const xdgConfig = process.env.XDG_CONFIG_HOME
      || (isWindows ? path.join(process.env.APPDATA || home, "opencode") : path.join(home, ".config"))
    
    const tuiJsonPaths: string[] = []
    const themeDirs: string[] = []

    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      const workspaceConfig = path.join(folders[0].uri.fsPath, ".opencode")
      tuiJsonPaths.push(path.join(workspaceConfig, "tui.json"))
      themeDirs.push(path.join(workspaceConfig, "themes"))
    }

    tuiJsonPaths.push(path.join(xdgConfig, "opencode", "tui.json"))
    tuiJsonPaths.push(path.join(home, ".opencode", "tui.json"))
    
    themeDirs.push(path.join(xdgConfig, "opencode", "themes"))
    themeDirs.push(path.join(home, ".opencode", "themes"))

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

    const overrides: OpencodeTheme = {}
    for (const dir of themeDirs) {
      try {
        // Sanitize activeTheme to prevent path traversal
        const safeThemeName = activeTheme.replace(/[^\w.-]/g, "_")
        const themeFile = path.join(dir, `${safeThemeName}.json`)
        if (fs.existsSync(themeFile)) {
          const raw = fs.readFileSync(themeFile, "utf8")
          const content = JSON.parse(raw)
          if (content.theme) {
            const t = content.theme
            if (t.primary?.dark) overrides.accentColor = t.primary.dark
            if (t.error?.dark) overrides.errorColor = t.error.dark
            if (t.warning?.dark) overrides.warningColor = t.warning.dark
            if (t.success?.dark) overrides.successColor = t.success.dark
            if (t.text?.dark) overrides.assistantMessageFg = t.text.dark
            if (t.background?.dark) overrides.assistantMessageBg = t.background.dark
            if (t.diffAdded?.dark) overrides.diffAdded = t.diffAdded.dark
            if (t.diffRemoved?.dark) overrides.diffRemoved = t.diffRemoved.dark
            if (t.syntaxComment?.dark) overrides.syntaxComment = t.syntaxComment.dark
            if (t.syntaxKeyword?.dark) overrides.syntaxKeyword = t.syntaxKeyword.dark
            if (t.syntaxString?.dark) overrides.syntaxString = t.syntaxString.dark
            if (t.syntaxNumber?.dark) overrides.syntaxNumber = t.syntaxNumber.dark
            if (t.syntaxFunction?.dark) overrides.syntaxFunction = t.syntaxFunction.dark
            if (t.syntaxType?.dark) overrides.syntaxType = t.syntaxType.dark
            if (t.syntaxOperator?.dark) overrides.syntaxOperator = t.syntaxOperator.dark
          }
          break 
        }
      } catch {
        // Malformed theme file — skip
      }
    }

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
    const mapping: [string, string | undefined][] = [
      ["--oc-user-msg-bg", merged.userMessageBg],
      ["--oc-user-msg-fg", merged.userMessageFg],
      ["--oc-assistant-msg-bg", merged.assistantMessageBg],
      ["--oc-assistant-msg-fg", merged.assistantMessageFg],
      ["--oc-tool-call", merged.toolCallColor],
      ["--oc-tool-read", merged.toolReadColor],
      ["--oc-tool-write", merged.toolWriteColor],
      ["--oc-tool-exec", merged.toolExecColor],
      ["--oc-skill-badge-bg", merged.skillBadgeBg],
      ["--oc-skill-badge-fg", merged.skillBadgeFg],
      ["--oc-thinking-bg", merged.thinkingBg],
      ["--oc-thinking-border", merged.thinkingBorder],
      ["--oc-warning", merged.warningColor],
      ["--oc-error", merged.errorColor],
      ["--oc-success", merged.successColor],
      ["--oc-accent", merged.accentColor],
      ["--oc-diff-added", merged.diffAdded],
      ["--oc-diff-removed", merged.diffRemoved],
      ["--oc-input-bg", merged.inputBg],
      ["--oc-input-border", merged.inputBorder],
      ["--oc-mention-bg", merged.mentionBg],
      ["--oc-syntax-comment", merged.syntaxComment],
      ["--oc-syntax-keyword", merged.syntaxKeyword],
      ["--oc-syntax-string", merged.syntaxString],
      ["--oc-syntax-number", merged.syntaxNumber],
      ["--oc-syntax-function", merged.syntaxFunction],
      ["--oc-syntax-type", merged.syntaxType],
      ["--oc-syntax-operator", merged.syntaxOperator],
    ]
    for (const [key, value] of mapping) {
      if (value !== undefined && value !== null) {
        customVars[key] = value
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
    this._onThemeChanged.dispose()
  }
}
