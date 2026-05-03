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

const BUILT_IN_PRESETS: Record<ThemePreset, OpencodeTheme> = {
  "cli-default": {
    userMessageBg: "#2d2d2d",
    userMessageFg: "#e0e0e0",
    assistantMessageBg: "#1e1e1e",
    assistantMessageFg: "#c9d1d9",
    toolCallColor: "#d19a66",
    toolReadColor: "#58a6ff",
    toolWriteColor: "#f85149",
    toolExecColor: "#3fb950",
    skillBadgeBg: "#0e639c",
    skillBadgeFg: "#ffffff",
    thinkingBg: "rgba(210,153,34,0.06)",
    thinkingBorder: "#d29922",
    warningColor: "#d29922",
    errorColor: "#f85149",
    successColor: "#3fb950",
    accentColor: "#58a6ff",
    diffAdded: "#3fb950",
    diffRemoved: "#f85149",
    inputBg: "#1e1e1e",
    inputBorder: "#3c3c3c",
    mentionBg: "#094771",
    syntaxComment: "#6a9955",
    syntaxKeyword: "#569cd6",
    syntaxString: "#ce9178",
    syntaxNumber: "#b5cea8",
    syntaxFunction: "#dcdcaa",
    syntaxType: "#4ec9b0",
    syntaxOperator: "#d4d4d4",
  },
  light: {
    userMessageBg: "#e8e8e8",
    userMessageFg: "#1e1e1e",
    assistantMessageBg: "#ffffff",
    assistantMessageFg: "#1e1e1e",
    toolCallColor: "#c18401",
    toolReadColor: "#0550ae",
    toolWriteColor: "#cf222e",
    toolExecColor: "#116329",
    skillBadgeBg: "#8250df",
    skillBadgeFg: "#ffffff",
    thinkingBg: "rgba(210,153,34,0.08)",
    thinkingBorder: "#bf8700",
    warningColor: "#bf8700",
    errorColor: "#cf222e",
    successColor: "#116329",
    accentColor: "#0550ae",
    diffAdded: "#116329",
    diffRemoved: "#cf222e",
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
    assistantMessageBg: "#1e1e1e",
    assistantMessageFg: "#c9d1d9",
    toolCallColor: "#d19a66",
    toolReadColor: "#58a6ff",
    toolWriteColor: "#f85149",
    toolExecColor: "#3fb950",
    skillBadgeBg: "#0e639c",
    skillBadgeFg: "#ffffff",
    thinkingBg: "rgba(210,153,34,0.06)",
    thinkingBorder: "#d29922",
    warningColor: "#d29922",
    errorColor: "#f85149",
    successColor: "#3fb950",
    accentColor: "#58a6ff",
    diffAdded: "#3fb950",
    diffRemoved: "#f85149",
    inputBg: "#1e1e1e",
    inputBorder: "#3c3c3c",
    mentionBg: "#094771",
    syntaxComment: "#6a9955",
    syntaxKeyword: "#569cd6",
    syntaxString: "#ce9178",
    syntaxNumber: "#b5cea8",
    syntaxFunction: "#dcdcaa",
    syntaxType: "#4ec9b0",
    syntaxOperator: "#d4d4d4",
  },
  "high-contrast": {
    userMessageBg: "#000000",
    userMessageFg: "#ffffff",
    assistantMessageBg: "#0a0a0a",
    assistantMessageFg: "#ffffff",
    toolCallColor: "#ffcc00",
    toolReadColor: "#1aebff",
    toolWriteColor: "#ff4444",
    toolExecColor: "#44ff44",
    skillBadgeBg: "#6a0dad",
    skillBadgeFg: "#ffffff",
    thinkingBg: "rgba(255,204,0,0.15)",
    thinkingBorder: "#ffcc00",
    warningColor: "#ffcc00",
    errorColor: "#ff4444",
    successColor: "#44ff44",
    accentColor: "#1aebff",
    diffAdded: "#44ff44",
    diffRemoved: "#ff4444",
    inputBg: "#000000",
    inputBorder: "#ffffff",
    mentionBg: "#6a0dad",
    syntaxComment: "#b3b3b3",
    syntaxKeyword: "#1aebff",
    syntaxString: "#ffcc00",
    syntaxNumber: "#44ff44",
    syntaxFunction: "#ff88ff",
    syntaxType: "#44ff44",
    syntaxOperator: "#ffffff",
  },
}

export interface ThemeVariables {
  kind: vscode.ColorThemeKind
  customVars: Record<string, string>
}

export class ThemeManager {
  private _onThemeChanged = new vscode.EventEmitter<ThemeVariables>()
  readonly onThemeChanged = this._onThemeChanged.event

  private currentKind: vscode.ColorThemeKind = vscode.ColorThemeKind.Dark
  private currentPreset: ThemePreset = "cli-default"
  private userOverrides: OpencodeTheme = {}

  constructor() {
    this.currentKind = vscode.window.activeColorTheme.kind
    this.loadConfig()

    vscode.window.onDidChangeActiveColorTheme((theme) => {
      this.currentKind = theme.kind
      this.emitUpdate()
    })

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode.theme")) {
        this.loadConfig()
        this.emitUpdate()
      }
    })
  }

  private loadConfig(): void {
    const config = vscode.workspace.getConfiguration("opencode")
    const themeObj = config.get<{ preset?: string; overrides?: OpencodeTheme }>("theme")
    if (themeObj?.preset && ["cli-default", "light", "dark", "high-contrast"].includes(themeObj.preset)) {
      this.currentPreset = themeObj.preset as ThemePreset
    }
    this.userOverrides = themeObj?.overrides || {}
  }

  private readCliThemeFiles(): OpencodeTheme {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
    
    // 1. Find potential config and theme directories
    const tuiJsonPaths: string[] = []
    const themeDirs: string[] = []

    // Workspace level
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      const workspaceConfig = path.join(folders[0].uri.fsPath, ".opencode")
      tuiJsonPaths.push(path.join(workspaceConfig, "tui.json"))
      themeDirs.push(path.join(workspaceConfig, "themes"))
    }

    // Global level
    tuiJsonPaths.push(path.join(xdgConfig, "opencode", "tui.json"))
    tuiJsonPaths.push(path.join(home, ".opencode", "tui.json"))
    
    themeDirs.push(path.join(xdgConfig, "opencode", "themes"))
    themeDirs.push(path.join(home, ".opencode", "themes"))

    // 2. Resolve active theme name
    let activeTheme = "tokyonight" // default fallback if we don't find it
    for (const tuiPath of tuiJsonPaths) {
      try {
        if (fs.existsSync(tuiPath)) {
          const content = JSON.parse(fs.readFileSync(tuiPath, "utf8"))
          if (content.theme) {
            activeTheme = content.theme
            break
          }
        }
      } catch { /* skip */ }
    }

    // 3. Find and load the active theme file
    const overrides: OpencodeTheme = {}
    for (const dir of themeDirs) {
      try {
        const themeFile = path.join(dir, `${activeTheme}.json`)
        if (fs.existsSync(themeFile)) {
          const content = JSON.parse(fs.readFileSync(themeFile, "utf8"))
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
          break // Found and loaded the active theme
        }
      } catch { /* skip */ }
    }
    return overrides
  }

  getThemeKind(): vscode.ColorThemeKind {
    return this.currentKind
  }

  getThemeVariables(): ThemeVariables {
    const preset = BUILT_IN_PRESETS[this.currentPreset] || BUILT_IN_PRESETS["cli-default"]
    const cliOverrides = this.readCliThemeFiles()
    const merged = { ...preset, ...cliOverrides, ...this.userOverrides }

    return {
      kind: this.currentKind,
      customVars: {
        "--oc-user-msg-bg": merged.userMessageBg!,
        "--oc-user-msg-fg": merged.userMessageFg!,
        "--oc-assistant-msg-bg": merged.assistantMessageBg!,
        "--oc-assistant-msg-fg": merged.assistantMessageFg!,
        "--oc-tool-call": merged.toolCallColor!,
        "--oc-tool-read": merged.toolReadColor!,
        "--oc-tool-write": merged.toolWriteColor!,
        "--oc-tool-exec": merged.toolExecColor!,
        "--oc-skill-badge-bg": merged.skillBadgeBg!,
        "--oc-skill-badge-fg": merged.skillBadgeFg!,
        "--oc-thinking-bg": merged.thinkingBg!,
        "--oc-thinking-border": merged.thinkingBorder!,
        "--oc-warning": merged.warningColor!,
        "--oc-error": merged.errorColor!,
        "--oc-success": merged.successColor!,
        "--oc-accent": merged.accentColor!,
        "--oc-diff-added": merged.diffAdded!,
        "--oc-diff-removed": merged.diffRemoved!,
        "--oc-input-bg": merged.inputBg!,
        "--oc-input-border": merged.inputBorder!,
        "--oc-mention-bg": merged.mentionBg!,
        "--oc-syntax-comment": merged.syntaxComment!,
        "--oc-syntax-keyword": merged.syntaxKeyword!,
        "--oc-syntax-string": merged.syntaxString!,
        "--oc-syntax-number": merged.syntaxNumber!,
        "--oc-syntax-function": merged.syntaxFunction!,
        "--oc-syntax-type": merged.syntaxType!,
        "--oc-syntax-operator": merged.syntaxOperator!,
      },
    }
  }

  emitUpdate(): void {
    this._onThemeChanged.fire(this.getThemeVariables())
  }

  dispose(): void {
    this._onThemeChanged.dispose()
  }
}
