import * as vscode from "vscode"
import { Minimatch } from "minimatch"

export interface WorkspaceFileIndexDeps {
  vscode: typeof vscode
  postMessage: (msg: Record<string, unknown>) => void
}

export class WorkspaceFileIndex {
  private files: string[] = []
  private disposables: vscode.Disposable[] = []
  private excludePatterns: Minimatch[] = []

  constructor(private readonly deps: WorkspaceFileIndexDeps) {}

  /**
   * Set glob patterns from opencode.jsonc `ignore`/`exclude` keys to filter
   * out of the file index. Invalid patterns are logged and skipped.
   */
  setExcludePatterns(patterns: string[]): void {
    this.excludePatterns = []
    for (const pattern of patterns) {
      try {
        this.excludePatterns.push(new Minimatch(pattern, { dot: true, matchBase: true }))
      } catch (err) {
        console.warn(`[WorkspaceFileIndex] invalid exclude pattern "${pattern}"`, err)
      }
    }
  }

  /**
   * Build the workspace file list from the current workspace folders.
   * Excludes node_modules and any config-defined exclude patterns.
   * Returns paths relative to the first workspace folder.
   */
  async refresh(): Promise<void> {
    const folders = this.deps.vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) {
      this.files = []
      return
    }

    try {
      const uris = await this.deps.vscode.workspace.findFiles("**/*", "**/node_modules/**", 5000)
      this.files = uris
        .map((uri) => this.deps.vscode.workspace.asRelativePath(uri))
        .filter((relative) => relative && !relative.startsWith("../") && !relative.includes("node_modules"))
        .filter((relative) => !this.matchesExcludePattern(relative))
        .sort()
    } catch (err) {
      console.warn("[WorkspaceFileIndex] refresh failed", err)
      this.files = []
    }
  }

  private matchesExcludePattern(relativePath: string): boolean {
    return this.excludePatterns.some((mm) => mm.match(relativePath))
  }

  /**
   * Return the cached relative file paths.
   */
  getFiles(): string[] {
    return [...this.files]
  }

  /**
   * Convert a URI to a path relative to the first workspace folder.
   * Returns null if the URI is outside the workspace.
   */
  asRelativePath(uri: vscode.Uri): string | null {
    const folders = this.deps.vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return null
    const root = folders[0]!.uri.fsPath
    const p = uri.fsPath
    const sep = root.endsWith("\\") || p.includes("\\") ? "\\" : "/"
    if (!p.startsWith(root + sep) && p !== root) return null
    return p === root ? "" : p.slice(root.length + 1)
  }

  /**
   * Respond to a webview request for the workspace file list.
   */
  handleGetFiles(): void {
    this.deps.postMessage({ type: "workspace_files", files: this.getFiles() })
  }

  /**
   * Watch workspace file changes and refresh the index.
   */
  watch(): void {
    this.disposables.push(
      this.deps.vscode.workspace.onDidCreateFiles(() => this.refresh().then(() => this.handleGetFiles())),
      this.deps.vscode.workspace.onDidDeleteFiles(() => this.refresh().then(() => this.handleGetFiles())),
      this.deps.vscode.workspace.onDidRenameFiles(() => this.refresh().then(() => this.handleGetFiles())),
    )
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []
  }
}
