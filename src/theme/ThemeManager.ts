import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { log } from "../utils/outputChannel"
import { ThemeAnalyzer, type ThemeActivationRequest } from "./ThemeAnalyzer"
import { ThemeStateMutator } from "./ThemeStateMutator"

export interface OpencodeTheme {
  primaryColor?: string
  secondaryColor?: string
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
  usageGood?: string
  usageCaution?: string
  usageWarning?: string
  usageCritical?: string

  syntaxComment?: string
  syntaxKeyword?: string
  syntaxString?: string
  syntaxNumber?: string
  syntaxFunction?: string
  syntaxVariable?: string
  syntaxType?: string
  syntaxOperator?: string
  syntaxPunctuation?: string

  panelBg?: string
  panelFg?: string
  editorBg?: string
  editorFg?: string
  elementBg?: string
  borderColor?: string
  borderActive?: string
  borderSubtle?: string
  mutedFg?: string

  listHoverBg?: string
  buttonSecondaryBg?: string
  buttonSecondaryHoverBg?: string
  buttonSecondaryFg?: string
  listActiveBg?: string
  listActiveFg?: string

  infoColor?: string
  diffContext?: string
  diffHunkHeader?: string
  diffHighlightAdded?: string
  diffHighlightRemoved?: string
  diffAddedBg?: string
  diffRemovedBg?: string
  diffContextBg?: string
  diffLineNumber?: string
  diffAddedLineNumberBg?: string
  diffRemovedLineNumberBg?: string
  markdownText?: string
  markdownHeading?: string
  markdownLink?: string
  markdownLinkText?: string
  markdownCode?: string
  markdownBlockQuote?: string
  markdownEmph?: string
  markdownStrong?: string
  markdownHorizontalRule?: string
  markdownListItem?: string
  markdownListEnumeration?: string
  markdownImage?: string
  markdownImageText?: string
  markdownCodeBlock?: string
}

export type ThemePreset =
  | "cli-default"
  | "light"
  | "dark"
  | "high-contrast"
  | "high-contrast-dark"
  | "high-contrast-light"

/**
 * BUILT_IN_PRESETS: Modernized "Cyber-Industrial" palette.
 * These act as fallback values when VS Code tokens aren't enough or when
 * the user explicitly chooses a specific OpenCode look.
 */
const BUILT_IN_PRESETS: Record<ThemePreset, OpencodeTheme> = {
  "cli-default": {
    panelBg: "var(--vscode-sideBar-background)",
    panelFg: "var(--vscode-sideBar-foreground)",
    editorBg: "var(--vscode-editor-background)",
    editorFg: "var(--vscode-editor-foreground)",
    borderColor: "var(--vscode-sideBar-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.2)))",
    mutedFg: "var(--vscode-descriptionForeground)",
    listHoverBg: "var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1))",
    buttonSecondaryBg: "var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.1))",
    buttonSecondaryHoverBg: "var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.15))",
    buttonSecondaryFg: "var(--vscode-button-secondaryForeground, var(--vscode-foreground))",
    listActiveBg: "var(--vscode-list-activeSelectionBackground)",
    listActiveFg: "var(--vscode-list-activeSelectionForeground)",
    userMessageBg: "var(--vscode-editor-background)",
    userMessageFg: "var(--vscode-editor-foreground)",
    assistantMessageBg: "transparent",
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
    usageGood: "var(--vscode-charts-green)",
    usageCaution: "var(--vscode-list-warningForeground)",
    usageWarning: "var(--vscode-charts-yellow, #d29922)",
    usageCritical: "var(--vscode-errorForeground)",
    syntaxComment: "var(--vscode-descriptionForeground)",
    syntaxKeyword: "var(--vscode-symbolIcon-keywordForeground)",
    syntaxString: "var(--vscode-symbolIcon-stringForeground)",
    syntaxNumber: "var(--vscode-symbolIcon-numberForeground)",
    syntaxFunction: "var(--vscode-symbolIcon-functionForeground)",
    syntaxType: "var(--vscode-symbolIcon-classForeground)",
    syntaxOperator: "var(--vscode-symbolIcon-operatorForeground)",
  },
  light: {
    panelBg: "#ffffff",
    panelFg: "#24292f",
    editorBg: "#f6f8fa",
    editorFg: "#1f2328",
    elementBg: "#f0f0f0",
    borderColor: "#8b949e",
    borderActive: "#58a6ff",
    borderSubtle: "#d0d7de",
    mutedFg: "#656d76",
    listHoverBg: "rgba(0, 0, 0, 0.04)",
    buttonSecondaryBg: "rgba(0, 0, 0, 0.05)",
    buttonSecondaryHoverBg: "rgba(0, 0, 0, 0.08)",
    buttonSecondaryFg: "#24292f",
    listActiveBg: "#0969da",
    listActiveFg: "#ffffff",
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
    thinkingBg: "rgba(154, 103, 0, 0.06)",
    thinkingBorder: "#9a6700",
    warningColor: "#9a6700",
    errorColor: "#cf222e",
    successColor: "#116329",
    infoColor: "#0550ae",
    accentColor: "#0969da",
    primaryColor: "#0969da",
    diffAdded: "rgba(45, 164, 78, 0.15)",
    diffRemoved: "rgba(207, 34, 46, 0.1)",
    diffContext: "rgba(36, 41, 47, 0.5)",
    diffHunkHeader: "rgba(5, 80, 174, 0.7)",
    diffAddedBg: "rgba(45, 164, 78, 0.08)",
    diffRemovedBg: "rgba(207, 34, 46, 0.06)",
    diffLineNumber: "rgba(101, 109, 118, 0.4)",
    inputBg: "#ffffff",
    inputBorder: "#8b949e",
    mentionBg: "#ddf4ff",
    usageGood: "#2da44e",
    usageCaution: "#9a6700",
    usageWarning: "#e06c00",
    usageCritical: "#cf222e",
    markdownText: "#24292f",
    markdownHeading: "#0969da",
    markdownLink: "#0550ae",
    markdownLinkText: "#0550ae",
    markdownCode: "#0550ae",
    markdownBlockQuote: "#656d76",
    markdownEmph: "#24292f",
    markdownStrong: "#24292f",
    markdownHorizontalRule: "#d0d7de",
    markdownListItem: "#24292f",
    markdownListEnumeration: "#656d76",
    markdownCodeBlock: "#24292f",
    syntaxComment: "#67707a",
    syntaxKeyword: "#0550ae",
    syntaxString: "#0a3069",
    syntaxNumber: "#0550ae",
    syntaxFunction: "#8250df",
    syntaxVariable: "#24292f",
    syntaxType: "#116329",
    syntaxOperator: "#1e1e1e",
    syntaxPunctuation: "#24292f",
  },
  dark: {
    panelBg: "#1e1e2e",
    panelFg: "#c9d1d9",
    editorBg: "#161b22",
    editorFg: "#e6edf3",
    elementBg: "#21262d",
    borderColor: "#30363d",
    borderActive: "#58a6ff",
    borderSubtle: "#21262d",
    mutedFg: "#8b949e",
    listHoverBg: "rgba(255, 255, 255, 0.06)",
    buttonSecondaryBg: "rgba(255, 255, 255, 0.08)",
    buttonSecondaryHoverBg: "rgba(255, 255, 255, 0.12)",
    buttonSecondaryFg: "#c9d1d9",
    listActiveBg: "#58a6ff",
    listActiveFg: "#0d1117",
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
    infoColor: "#58a6ff",
    accentColor: "#00e5ff",
    primaryColor: "#58a6ff",
    diffAdded: "rgba(63, 185, 80, 0.15)",
    diffRemoved: "rgba(248, 81, 73, 0.1)",
    diffContext: "rgba(201, 209, 217, 0.5)",
    diffHunkHeader: "rgba(88, 166, 255, 0.7)",
    diffAddedBg: "rgba(63, 185, 80, 0.08)",
    diffRemovedBg: "rgba(248, 81, 73, 0.06)",
    diffLineNumber: "rgba(139, 148, 158, 0.4)",
    inputBg: "#161b22",
    inputBorder: "#70767d",
    mentionBg: "#1f6feb",
    usageGood: "#3fb950",
    usageCaution: "#d29922",
    usageWarning: "#e06c00",
    usageCritical: "#f85149",
    markdownText: "#c9d1d9",
    markdownHeading: "#00e5ff",
    markdownLink: "#58a6ff",
    markdownLinkText: "#58a6ff",
    markdownCode: "#58a6ff",
    markdownBlockQuote: "#8b949e",
    markdownEmph: "#c9d1d9",
    markdownStrong: "#c9d1d9",
    markdownHorizontalRule: "#30363d",
    markdownListItem: "#c9d1d9",
    markdownListEnumeration: "#8b949e",
    markdownCodeBlock: "#c9d1d9",
    syntaxComment: "#8c959f",
    syntaxKeyword: "#ff7b72",
    syntaxString: "#a5d6ff",
    syntaxNumber: "#d2a8ff",
    syntaxFunction: "#d2a8ff",
    syntaxVariable: "#c9d1d9",
    syntaxType: "#ffa657",
    syntaxOperator: "#79c0ff",
    syntaxPunctuation: "#c9d1d9",
  },
  "high-contrast-dark": {
    panelBg: "#000000",
    panelFg: "#ffffff",
    editorBg: "#000000",
    editorFg: "#ffffff",
    elementBg: "#1a1a1a",
    borderColor: "#ffff00",
    borderActive: "#ffff00",
    borderSubtle: "#888888",
    mutedFg: "#cccccc",
    listHoverBg: "rgba(255, 255, 255, 0.1)",
    buttonSecondaryBg: "rgba(255, 255, 255, 0.1)",
    buttonSecondaryHoverBg: "rgba(255, 255, 255, 0.15)",
    buttonSecondaryFg: "#ffffff",
    listActiveBg: "#ffff00",
    listActiveFg: "#000000",
    userMessageBg: "#1a1a1a",
    userMessageFg: "#ffffff",
    assistantMessageBg: "transparent",
    assistantMessageFg: "#ffffff",
    toolCallColor: "#ffff00",
    toolReadColor: "#00bfff",
    toolWriteColor: "#ff5252",
    toolExecColor: "#00e676",
    skillBadgeBg: "rgba(255, 255, 0, 0.2)",
    skillBadgeFg: "#ffff00",
    thinkingBg: "rgba(255, 255, 0, 0.06)",
    thinkingBorder: "#ffff00",
    warningColor: "#ffff00",
    errorColor: "#ff5252",
    successColor: "#00e676",
    infoColor: "#00bfff",
    accentColor: "#ffff00",
    primaryColor: "#00bfff",
    diffAdded: "rgba(0, 230, 118, 0.2)",
    diffRemoved: "rgba(255, 82, 82, 0.2)",
    diffContext: "rgba(255, 255, 255, 0.5)",
    diffHunkHeader: "rgba(0, 191, 255, 0.7)",
    diffAddedBg: "rgba(0, 230, 118, 0.1)",
    diffRemovedBg: "rgba(255, 82, 82, 0.1)",
    diffLineNumber: "rgba(255, 255, 255, 0.4)",
    inputBg: "#0a0a0a",
    inputBorder: "#ffff00",
    mentionBg: "rgba(0, 191, 255, 0.2)",
    usageGood: "#00e676",
    usageCaution: "#ffff00",
    usageWarning: "#ff9100",
    usageCritical: "#ff5252",
    markdownText: "#ffffff",
    markdownHeading: "#ffff00",
    markdownLink: "#00bfff",
    markdownLinkText: "#00bfff",
    markdownCode: "#00e676",
    markdownBlockQuote: "#cccccc",
    markdownEmph: "#ffffff",
    markdownStrong: "#ffffff",
    markdownHorizontalRule: "#888888",
    markdownListItem: "#ffffff",
    markdownListEnumeration: "#cccccc",
    markdownCodeBlock: "#ffffff",
    syntaxComment: "#888888",
    syntaxKeyword: "#ff7b72",
    syntaxString: "#a5d6ff",
    syntaxNumber: "#d2a8ff",
    syntaxFunction: "#d2a8ff",
    syntaxVariable: "#ffffff",
    syntaxType: "#ffa657",
    syntaxOperator: "#79c0ff",
    syntaxPunctuation: "#ffffff",
  },
  "high-contrast-light": {
    panelBg: "#ffffff",
    panelFg: "#000000",
    editorBg: "#f5f5f5",
    editorFg: "#000000",
    elementBg: "#e8e8e8",
    borderColor: "#cc0000",
    borderActive: "#cc0000",
    borderSubtle: "#888888",
    mutedFg: "#555555",
    listHoverBg: "rgba(0, 0, 0, 0.1)",
    buttonSecondaryBg: "rgba(0, 0, 0, 0.1)",
    buttonSecondaryHoverBg: "rgba(0, 0, 0, 0.15)",
    buttonSecondaryFg: "#000000",
    listActiveBg: "#0000cc",
    listActiveFg: "#ffffff",
    userMessageBg: "#f0f0f0",
    userMessageFg: "#000000",
    assistantMessageBg: "transparent",
    assistantMessageFg: "#000000",
    toolCallColor: "#0000ff",
    toolReadColor: "#0000cc",
    toolWriteColor: "#cc0000",
    toolExecColor: "#006400",
    skillBadgeBg: "rgba(0, 0, 204, 0.1)",
    skillBadgeFg: "#0000cc",
    thinkingBg: "rgba(204, 0, 0, 0.06)",
    thinkingBorder: "#cc0000",
    warningColor: "#994d00",
    errorColor: "#cc0000",
    successColor: "#006400",
    infoColor: "#0000cc",
    accentColor: "#0000cc",
    primaryColor: "#0000cc",
    diffAdded: "rgba(0, 100, 0, 0.15)",
    diffRemoved: "rgba(204, 0, 0, 0.15)",
    diffContext: "rgba(0, 0, 0, 0.5)",
    diffHunkHeader: "rgba(0, 0, 204, 0.7)",
    diffAddedBg: "rgba(0, 100, 0, 0.08)",
    diffRemovedBg: "rgba(204, 0, 0, 0.08)",
    diffLineNumber: "rgba(0, 0, 0, 0.4)",
    inputBg: "#ffffff",
    inputBorder: "#cc0000",
    mentionBg: "rgba(0, 0, 255, 0.1)",
    usageGood: "#006400",
    usageCaution: "#994d00",
    usageWarning: "#cc5500",
    usageCritical: "#cc0000",
    markdownText: "#000000",
    markdownHeading: "#0000cc",
    markdownLink: "#0000cc",
    markdownLinkText: "#0000cc",
    markdownCode: "#006400",
    markdownBlockQuote: "#555555",
    markdownEmph: "#000000",
    markdownStrong: "#000000",
    markdownHorizontalRule: "#888888",
    markdownListItem: "#000000",
    markdownListEnumeration: "#555555",
    markdownCodeBlock: "#000000",
    syntaxComment: "#555555",
    syntaxKeyword: "#0000cc",
    syntaxString: "#006400",
    syntaxNumber: "#8b008b",
    syntaxFunction: "#7b0099",
    syntaxVariable: "#000000",
    syntaxType: "#006400",
    syntaxOperator: "#000000",
    syntaxPunctuation: "#000000",
  },
  "high-contrast": {
    panelBg: "var(--vscode-sideBar-background, var(--vscode-editor-background, #000000))",
    panelFg: "var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #ffffff))",
    editorBg: "var(--vscode-editor-background, #000000)",
    editorFg: "var(--vscode-editor-foreground, #ffffff)",
    borderColor: "var(--vscode-contrastBorder, var(--vscode-focusBorder, #ffffff))",
    mutedFg: "var(--vscode-descriptionForeground, #ffffff)",
    listHoverBg: "var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1))",
    buttonSecondaryBg: "var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.1))",
    buttonSecondaryHoverBg: "var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.15))",
    buttonSecondaryFg: "var(--vscode-button-secondaryForeground, var(--vscode-foreground, #ffffff))",
    listActiveBg: "var(--vscode-list-activeSelectionBackground)",
    listActiveFg: "var(--vscode-list-activeSelectionForeground)",
    userMessageBg: "var(--vscode-input-background, var(--vscode-editor-background, #000000))",
    userMessageFg: "var(--vscode-input-foreground, var(--vscode-editor-foreground, #ffffff))",
    assistantMessageBg: "transparent",
    assistantMessageFg: "var(--vscode-editor-foreground, #ffffff)",
    toolCallColor: "var(--vscode-textLink-foreground, #ffffff)",
    toolReadColor: "var(--vscode-textLink-foreground, #ffffff)",
    toolWriteColor: "var(--vscode-errorForeground, #ffffff)",
    toolExecColor: "var(--vscode-testing-iconPassed, #ffffff)",
    skillBadgeBg: "var(--vscode-badge-background, #ffffff)",
    skillBadgeFg: "var(--vscode-badge-foreground, #000000)",
    thinkingBg: "transparent",
    thinkingBorder: "var(--vscode-contrastBorder, var(--vscode-focusBorder, #ffffff))",
    warningColor: "var(--vscode-list-warningForeground, var(--vscode-editorWarning-foreground, #ffffff))",
    errorColor: "var(--vscode-errorForeground, #ffffff)",
    successColor: "var(--vscode-testing-iconPassed, #ffffff)",
    accentColor: "var(--vscode-button-background, var(--vscode-focusBorder, #ffffff))",
    diffAdded: "var(--vscode-diffEditor-insertedTextBackground, transparent)",
    diffRemoved: "var(--vscode-diffEditor-removedTextBackground, transparent)",
    inputBg: "var(--vscode-input-background, #000000)",
    inputBorder: "var(--vscode-input-border, var(--vscode-contrastBorder, #ffffff))",
    mentionBg: "var(--vscode-editor-selectionBackground, transparent)",
    usageGood: "var(--vscode-testing-iconPassed, #ffffff)",
    usageCaution: "var(--vscode-list-warningForeground, var(--vscode-editorWarning-foreground, #ffffff))",
    usageWarning: "var(--vscode-editorWarning-foreground, #ffffff)",
    usageCritical: "var(--vscode-errorForeground, #ffffff)",
    syntaxComment: "var(--vscode-descriptionForeground, #ffffff)",
    syntaxKeyword: "var(--vscode-symbolIcon-keywordForeground, #ffffff)",
    syntaxString: "var(--vscode-symbolIcon-stringForeground, #ffffff)",
    syntaxNumber: "var(--vscode-symbolIcon-numberForeground, #ffffff)",
    syntaxFunction: "var(--vscode-symbolIcon-functionForeground, #ffffff)",
    syntaxVariable: "var(--vscode-symbolIcon-variableForeground, #ffffff)",
    syntaxType: "var(--vscode-symbolIcon-classForeground, #ffffff)",
    syntaxOperator: "var(--vscode-symbolIcon-operatorForeground, #ffffff)",
    syntaxPunctuation: "var(--vscode-editor-foreground, #ffffff)",
  },
}

export interface ThemeVariables {
  kind: vscode.ColorThemeKind
  customVars: Record<string, string>
}

const CLI_THEME_CACHE_TTL_MS = 30_000 // 30 seconds

function getXdgConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const isWindows = process.platform === "win32"
  return process.env.XDG_CONFIG_HOME
    || (isWindows ? path.join(process.env.APPDATA || home, "opencode") : path.join(home, ".config"))
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || ""
}

export class ThemeManager {
  private _onThemeChanged = new vscode.EventEmitter<ThemeVariables>()
  private disposables: vscode.Disposable[] = []
  readonly onThemeChanged = this._onThemeChanged.event

  private currentKind: vscode.ColorThemeKind = vscode.ColorThemeKind.Dark
  private currentPreset: ThemePreset = "cli-default"
  private userOverrides: OpencodeTheme = {}

  private cliThemeCache: OpencodeTheme | null = null
  private cliThemeCacheTimestamp = 0

  private fileWatchers: vscode.FileSystemWatcher[] = []
  private readonly analyzer = new ThemeAnalyzer()
  private readonly mutator = new ThemeStateMutator()

  constructor() {
    this.currentKind = vscode.window.activeColorTheme.kind
    this.loadConfig()
    this.setupFileWatchers()

    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this.currentKind = theme.kind
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

  private setupFileWatchers(): void {
    for (const watcher of this.fileWatchers) {
      watcher.dispose()
    }
    this.fileWatchers = []

    const folders = vscode.workspace.workspaceFolders
    const home = getHomeDir()
    const xdgConfig = getXdgConfigDir()

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
   * Preview a theme by applying it to the chat webview only (CSS variables).
   * This does NOT change the user's VS Code editor theme.
   */
  async previewTheme(): Promise<void> {
    const presets: Array<{ id: ThemePreset; label: string; desc: string }> = [
      { id: "cli-default", label: "CLI Default", desc: "Adapts to your current VS Code colors" },
      { id: "light", label: "Light", desc: "Light chat panel theme" },
      { id: "dark", label: "Dark", desc: "Dark chat panel theme" },
      { id: "high-contrast", label: "High Contrast", desc: "High contrast chat panel theme" },
    ]

    const discovered = this.discoverCliThemes()

    const items: (vscode.QuickPickItem & {
      preset?: ThemePreset
      themeFile?: string
    })[] = []

    for (const p of presets) {
      items.push({
        label: p.label,
        description: p.desc,
        preset: p.id,
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
      placeHolder: "Choose a chat panel theme",
      title: "OpenCode Theme Preview (chat panel only)",
    })

    if (!picked) return

    const config = vscode.workspace.getConfiguration("opencode")
    if (picked.preset) {
      await config.update("theme", { preset: picked.preset, overrides: {} }, vscode.ConfigurationTarget.Global)
    } else if (picked.themeFile) {
      const themeName = path.basename(picked.themeFile, ".json")
      const overrides = this.readThemeFileOverrides([path.dirname(picked.themeFile)], themeName)
      await config.update("theme", { preset: "cli-default", overrides }, vscode.ConfigurationTarget.Global)
    }
  }

  discoverCliThemes(): Array<{ name: string; path: string; source: string }> {
    const themes: Array<{ name: string; path: string; source: string }> = []
    const home = getHomeDir()
    const xdgConfig = getXdgConfigDir()

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

    const seenPaths = new Set<string>()
    for (const { dir, source } of themeDirs) {
      try {
        const canonical = fs.realpathSync(dir)
        if (seenPaths.has(canonical)) continue
        seenPaths.add(canonical)
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

  loadConfig(): void {
    const config = vscode.workspace.getConfiguration("opencode")
    const themeObj = config.get<{ preset?: string; overrides?: OpencodeTheme }>("theme")
    const validPresets: ThemePreset[] = ["cli-default", "light", "dark", "high-contrast", "high-contrast-dark", "high-contrast-light"]
    if (themeObj?.preset && (validPresets as string[]).includes(themeObj.preset)) {
      this.currentPreset = themeObj.preset as ThemePreset
    }
    this.userOverrides = themeObj?.overrides || {}
  }

  /**
   * Activates a theme for the OpenCode chat panel. When the request includes a
   * built-in preset that implies a different VS Code mode (light/dark/hc), the
   * workbench color theme is also switched. When a market theme is requested
   * that is not installed, a warning is shown and the active theme kind is kept.
   */
  async activateTheme(request: ThemeActivationRequest): Promise<void> {
    const target = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global

    if (request.marketTheme) {
      if (!this.analyzer.isMarketThemeAvailable(request.marketTheme)) {
        log.warn(`Market theme "${request.marketTheme}" is not installed`)
        await vscode.window.showWarningMessage(
          `Theme "${request.marketTheme}" is not installed. Staying on the current VS Code theme.`
        )
        return
      }

      await vscode.workspace.getConfiguration("workbench").update("colorTheme", request.marketTheme, target)
      this.currentKind = vscode.window.activeColorTheme.kind
      this.emitUpdate()
      return
    }

    const preset = request.preset ?? "cli-default"
    const validPresets: ThemePreset[] = ["cli-default", "light", "dark", "high-contrast", "high-contrast-dark", "high-contrast-light"]
    if (!validPresets.includes(preset as ThemePreset)) {
      log.warn(`Ignoring invalid theme preset: ${preset}`)
      return
    }

    const effectivePreset = this.analyzer.resolveEffectivePreset(preset)
    const targetKind = this.analyzer.getTargetKindForPreset(effectivePreset)

    if (targetKind !== undefined) {
      const workbenchTheme = this.analyzer.getWorkbenchThemeForMode(targetKind)
      if (workbenchTheme) {
        await vscode.workspace.getConfiguration("workbench").update("colorTheme", workbenchTheme, target)
      }
    }

    const opencode = vscode.workspace.getConfiguration("opencode")
    await opencode.update("theme", { preset, overrides: {} }, target)
    this.currentPreset = preset as ThemePreset
    this.userOverrides = {}
    this.emitUpdate()
  }

  /**
   * Applies a set of OpenCode color overrides to the workbench customizations
   * under the opencodeHarness namespace without erasing unrelated user settings.
   */
  async applyOverrides(
    overrides: OpencodeTheme,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    const flat: Record<string, string> = {}
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === "string") {
        flat[key] = value
      }
    }

    await this.mutator.applyColorCustomizations(flat, target)
    await this.mutator.applyTokenColorCustomizations({}, target)
    this.emitUpdate()
  }

  /**
   * Resets OpenCode theme state to defaults and removes the opencodeHarness
   * namespace from workbench color customizations.
   */
  async resetToDefault(target: vscode.ConfigurationTarget): Promise<void> {
    await this.mutator.reset(target)
    this.currentPreset = "cli-default"
    this.userOverrides = {}
    this.emitUpdate()
  }

  private invalidateCliCache(): void {
    this.cliThemeCache = null
    this.cliThemeCacheTimestamp = 0
  }

  private getCliPaths(): { tuiJsonPaths: string[]; themeDirs: string[] } {
    const home = getHomeDir()
    const xdgConfig = getXdgConfigDir()

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
    let activeTheme = ""
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
    if (!activeTheme) return overrides
    const safeThemeName = activeTheme.replace(/[^\w.-]/g, "_")

    for (const dir of themeDirs) {
      try {
        const themeFile = path.join(dir, `${safeThemeName}.json`)
        if (fs.existsSync(themeFile)) {
          const raw = fs.readFileSync(themeFile, "utf8")
          const content = JSON.parse(raw)
          if (content.theme) {
            this.applyThemeContent(overrides, content.theme, content.defs)
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
    ["primaryColor", "primary"],
    ["secondaryColor", "secondary"],
    ["accentColor", "accent"],
    ["panelBg", "background"],
    ["panelFg", "text"],
    ["editorBg", "backgroundPanel"],
    ["elementBg", "backgroundElement"],
    ["mutedFg", "textMuted"],
    ["borderColor", "border"],
    ["borderActive", "borderActive"],
    ["borderSubtle", "borderSubtle"],
    ["errorColor", "error"],
    ["warningColor", "warning"],
    ["successColor", "success"],
    ["infoColor", "info"],
    ["usageGood", "usageGood"],
    ["usageCaution", "usageCaution"],
    ["usageWarning", "usageWarning"],
    ["usageCritical", "usageCritical"],
    ["diffAdded", "diffAdded"],
    ["diffRemoved", "diffRemoved"],
    ["diffContext", "diffContext"],
    ["diffHunkHeader", "diffHunkHeader"],
    ["diffHighlightAdded", "diffHighlightAdded"],
    ["diffHighlightRemoved", "diffHighlightRemoved"],
    ["diffAddedBg", "diffAddedBg"],
    ["diffRemovedBg", "diffRemovedBg"],
    ["diffContextBg", "diffContextBg"],
    ["diffLineNumber", "diffLineNumber"],
    ["diffAddedLineNumberBg", "diffAddedLineNumberBg"],
    ["diffRemovedLineNumberBg", "diffRemovedLineNumberBg"],
    ["markdownText", "markdownText"],
    ["markdownHeading", "markdownHeading"],
    ["markdownLink", "markdownLink"],
    ["markdownLinkText", "markdownLinkText"],
    ["markdownCode", "markdownCode"],
    ["markdownBlockQuote", "markdownBlockQuote"],
    ["markdownEmph", "markdownEmph"],
    ["markdownStrong", "markdownStrong"],
    ["markdownHorizontalRule", "markdownHorizontalRule"],
    ["markdownListItem", "markdownListItem"],
    ["markdownListEnumeration", "markdownListEnumeration"],
    ["markdownImage", "markdownImage"],
    ["markdownImageText", "markdownImageText"],
    ["markdownCodeBlock", "markdownCodeBlock"],
    ["syntaxComment", "syntaxComment"],
    ["syntaxKeyword", "syntaxKeyword"],
    ["syntaxString", "syntaxString"],
    ["syntaxNumber", "syntaxNumber"],
    ["syntaxFunction", "syntaxFunction"],
    ["syntaxVariable", "syntaxVariable"],
    ["syntaxType", "syntaxType"],
    ["syntaxOperator", "syntaxOperator"],
    ["syntaxPunctuation", "syntaxPunctuation"],
  ]

  static deriveExtendedTheme(
    palette: {
      neutral?: string; ink?: string; primary?: string; accent?: string
      success?: string; warning?: string; error?: string; info?: string
      diffAdd?: string; diffDelete?: string
    },
    overrides?: {
      "syntax-comment"?: string; "syntax-keyword"?: string; "syntax-string"?: string
      "syntax-primitive"?: string; "syntax-property"?: string; "syntax-constant"?: string
    }
  ): OpencodeTheme {
    const n = palette.neutral ?? "#1e1e2e"
    const ink = palette.ink ?? "#c9d1d9"
    const primary = palette.primary ?? "#58a6ff"
    const accent = palette.accent ?? "#00e5ff"
    const success = palette.success ?? "#00e676"
    const warning = palette.warning ?? "#ffab00"
    const error = palette.error ?? "#ff5252"
    const info = palette.info ?? "#58a6ff"
    const diffAdd = palette.diffAdd ?? "#3fb950"
    const diffDelete = palette.diffDelete ?? "#f85149"
    const syn = overrides ?? {}

    return {
      panelBg: n,
      panelFg: ink,
      editorBg: `color-mix(in srgb, ${n} 96%, ${ink})`,
      editorFg: ink,
      borderColor: `color-mix(in srgb, ${ink} 20%, ${n})`,
      mutedFg: `color-mix(in srgb, ${ink} 60%, ${n})`,
      userMessageBg: `color-mix(in srgb, ${ink} 8%, ${n})`,
      userMessageFg: ink,
      assistantMessageBg: "transparent",
      assistantMessageFg: ink,
      inputBg: `color-mix(in srgb, ${n} 92%, ${ink})`,
      inputBorder: `color-mix(in srgb, ${ink} 20%, ${n})`,
      mentionBg: `color-mix(in srgb, ${primary} 18%, transparent)`,
      primaryColor: primary,
      accentColor: accent,
      errorColor: error,
      warningColor: warning,
      successColor: success,
      infoColor: info,
      toolReadColor: primary,
      toolWriteColor: error,
      toolExecColor: success,
      toolCallColor: accent,
      skillBadgeBg: `color-mix(in srgb, ${primary} 20%, transparent)`,
      skillBadgeFg: primary,
      thinkingBg: `color-mix(in srgb, ${warning} 6%, transparent)`,
      thinkingBorder: warning,
      markdownText: ink,
      markdownHeading: accent,
      markdownLink: primary,
      markdownLinkText: primary,
      markdownCode: primary,
      markdownBlockQuote: `color-mix(in srgb, ${ink} 60%, ${n})`,
      markdownEmph: ink,
      markdownStrong: ink,
      markdownHorizontalRule: `color-mix(in srgb, ${ink} 20%, ${n})`,
      markdownListItem: ink,
      markdownListEnumeration: `color-mix(in srgb, ${ink} 60%, ${n})`,
      markdownCodeBlock: ink,
      diffAdded: diffAdd,
      diffRemoved: diffDelete,
      diffAddedBg: `color-mix(in srgb, ${diffAdd} 15%, transparent)`,
      diffRemovedBg: `color-mix(in srgb, ${diffDelete} 15%, transparent)`,
      diffContext: `color-mix(in srgb, ${ink} 50%, ${n})`,
      diffHunkHeader: `color-mix(in srgb, ${primary} 70%, ${n})`,
      diffLineNumber: `color-mix(in srgb, ${ink} 40%, ${n})`,
      syntaxComment: syn["syntax-comment"] ?? `color-mix(in srgb, ${ink} 50%, ${n})`,
      syntaxKeyword: syn["syntax-keyword"] ?? primary,
      syntaxString: syn["syntax-string"] ?? success,
      syntaxNumber: syn["syntax-primitive"] ?? accent,
      syntaxType: syn["syntax-primitive"] ?? accent,
      syntaxFunction: syn["syntax-property"] ?? primary,
      syntaxVariable: syn["syntax-property"] ?? ink,
      syntaxOperator: syn["syntax-constant"] ?? ink,
      syntaxPunctuation: ink,
    }
  }

  private applyThemeContent(
    overrides: OpencodeTheme,
    theme: Record<string, unknown>,
    defs?: Record<string, string | number>
  ): void {
    // Detect compact CLI schema: { palette: {...}, overrides: {...} }
    if (theme["palette"] && typeof theme["palette"] === "object") {
      const palette = theme["palette"] as Record<string, string>
      const syntaxOverrides = (theme["overrides"] ?? {}) as Record<string, string>
      const derived = ThemeManager.deriveExtendedTheme(palette, syntaxOverrides as Parameters<typeof ThemeManager.deriveExtendedTheme>[1])
      Object.assign(overrides, derived)
      return
    }

    const variant = this.currentKind === vscode.ColorThemeKind.Light ? "light" : "dark"
    for (const [overrideKey, themeKey] of ThemeManager.FIELD_MAP) {
      const section = theme[themeKey]
      if (section !== undefined && section !== null) {
        const rawValue: string | number | undefined = typeof section === "object" && !Array.isArray(section)
          ? ((section as { dark?: string | number; light?: string | number })[variant] ?? (section as { dark?: string | number }).dark ?? (section as { light?: string | number }).light)
          : (typeof section === "string" || typeof section === "number" ? section : undefined)
        const value = this.resolveThemeValue(rawValue, defs)
        if (value) overrides[overrideKey] = value
      }
    }
  }

  private resolveThemeValue(value: string | number | undefined, defs?: Record<string, string | number>): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value === "number") return `ansi(${value})`
    if (value === "none") return "transparent"
    const seen = new Set<string>()
    let current: string | number | undefined = value
    while (typeof current === "string" && defs && Object.prototype.hasOwnProperty.call(defs, current) && !seen.has(current)) {
      seen.add(current)
      current = defs[current]
    }
    if (typeof current === "number") return `ansi(${current})`
    return typeof current === "string" ? current : undefined
  }

  // Static CSS variable map: CSS variable name → merged theme property
  // IMPORTANT: Variable names must match exactly what tokens.css and blocks.css consume.
  private static readonly CSS_VAR_MAP: Array<[string, keyof OpencodeTheme]> = [
    ["--oc-bg", "panelBg"],
    ["--oc-fg", "panelFg"],
    ["--color-fg", "panelFg"],
    ["--oc-editor-bg", "editorBg"],
    ["--oc-editor-fg", "editorFg"],
    ["--oc-element-bg", "elementBg"],
    ["--oc-glass-bg", "panelBg"],
    ["--bg-primary", "panelBg"],
    // --bg-secondary and --bg-tertiary intentionally omitted: tokens.css computes
    // them via color-mix() for subtle depth layering. Injecting a flat panelBg
    // value here would override that and make all background layers identical.
    ["--oc-border", "borderColor"],
    ["--color-border", "borderColor"],
    ["--oc-border-active", "borderActive"],
    ["--oc-border-subtle", "borderSubtle"],
    ["--oc-muted", "mutedFg"],
    ["--color-muted", "mutedFg"],
    ["--oc-description", "mutedFg"],
    ["--oc-focus", "borderActive"],
    ["--oc-glass-border", "borderSubtle"],
    ["--oc-list-hover", "listHoverBg"],
    ["--oc-button-secondary", "buttonSecondaryBg"],
    ["--oc-button-secondary-hover", "buttonSecondaryHoverBg"],
    ["--oc-button-secondary-fg", "buttonSecondaryFg"],
    ["--oc-list-active", "listActiveBg"],
    ["--oc-list-active-fg", "listActiveFg"],
    ["--oc-user-msg-bg", "userMessageBg"],
    ["--oc-user-msg-fg", "userMessageFg"],
    ["--oc-assistant-msg-bg", "assistantMessageBg"],
    ["--oc-assistant-msg-fg", "assistantMessageFg"],
    ["--tool-read-color", "toolReadColor"],
    ["--tool-write-color", "toolWriteColor"],
    ["--tool-exec-color", "toolExecColor"],
    ["--oc-skill-badge-bg", "skillBadgeBg"],
    ["--oc-skill-badge-fg", "skillBadgeFg"],
    ["--oc-thinking-bg", "thinkingBg"],
    ["--oc-thinking-border", "thinkingBorder"],
    ["--oc-warning", "warningColor"],
    ["--oc-error", "errorColor"],
    ["--oc-success", "successColor"],
    ["--oc-info", "infoColor"],
    ["--oc-usage-good", "usageGood"],
    ["--oc-usage-caution", "usageCaution"],
    ["--oc-usage-warning", "usageWarning"],
    ["--oc-usage-critical", "usageCritical"],
    ["--oc-primary", "primaryColor"],
    ["--oc-secondary", "secondaryColor"],
    ["--oc-accent", "accentColor"],
    ["--oc-diff-added", "diffAdded"],
    ["--oc-diff-removed", "diffRemoved"],
    ["--oc-diff-context", "diffContext"],
    ["--oc-diff-hunk-header", "diffHunkHeader"],
    ["--oc-diff-highlight-added", "diffHighlightAdded"],
    ["--oc-diff-highlight-removed", "diffHighlightRemoved"],
    ["--oc-diff-added-bg", "diffAddedBg"],
    ["--oc-diff-removed-bg", "diffRemovedBg"],
    ["--oc-diff-context-bg", "diffContextBg"],
    ["--oc-diff-line-number", "diffLineNumber"],
    ["--oc-diff-added-line-number-bg", "diffAddedLineNumberBg"],
    ["--oc-diff-removed-line-number-bg", "diffRemovedLineNumberBg"],
    ["--oc-markdown-text", "markdownText"],
    ["--oc-markdown-heading", "markdownHeading"],
    ["--oc-markdown-link", "markdownLink"],
    ["--oc-markdown-link-text", "markdownLinkText"],
    ["--oc-markdown-code", "markdownCode"],
    ["--oc-markdown-blockquote", "markdownBlockQuote"],
    ["--oc-markdown-emph", "markdownEmph"],
    ["--oc-markdown-strong", "markdownStrong"],
    ["--oc-markdown-hr", "markdownHorizontalRule"],
    ["--oc-markdown-list-item", "markdownListItem"],
    ["--oc-markdown-list-enumeration", "markdownListEnumeration"],
    ["--oc-markdown-image", "markdownImage"],
    ["--oc-markdown-image-text", "markdownImageText"],
    ["--oc-markdown-code-block", "markdownCodeBlock"],
    ["--oc-input-bg", "inputBg"],
    ["--oc-input-border", "inputBorder"],
    ["--oc-mention-bg", "mentionBg"],
    ["--oc-syn-comment", "syntaxComment"],
    ["--oc-syn-keyword", "syntaxKeyword"],
    ["--oc-syn-string", "syntaxString"],
    ["--oc-syn-number", "syntaxNumber"],
    ["--oc-syn-function", "syntaxFunction"],
    ["--oc-syn-variable", "syntaxVariable"],
    ["--oc-syn-type", "syntaxType"],
    ["--oc-syn-operator", "syntaxOperator"],
    ["--oc-syn-punctuation", "syntaxPunctuation"],
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

  private resolveEffectivePreset(): ThemePreset {
    if (this.currentPreset !== "high-contrast") return this.currentPreset
    switch (this.currentKind) {
      case vscode.ColorThemeKind.HighContrastLight:
        return "high-contrast-light"
      case vscode.ColorThemeKind.HighContrast:
      case vscode.ColorThemeKind.Dark:
        return "high-contrast-dark"
      default:
        return "high-contrast-light"
    }
  }

  getThemeVariables(): ThemeVariables {
    const effectivePreset = this.resolveEffectivePreset()
    const preset = BUILT_IN_PRESETS[effectivePreset] || BUILT_IN_PRESETS["cli-default"]
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
