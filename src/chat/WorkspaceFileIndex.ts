import * as vscode from "vscode"

export interface WorkspaceFileIndexDeps {
  vscode: typeof vscode
  postMessage: (msg: Record<string, unknown>) => void
}

export class WorkspaceFileIndex {
  private files: string[] = []
  private disposables: vscode.Disposable[] = []

  constructor(private readonly deps: WorkspaceFileIndexDeps) {}

  /**
   * Build the workspace file list from the current workspace folders.
   * Excludes node_modules and returns paths relative to the first workspace folder.
   */
  async refresh(): Promise<void> {
    const folders = this.deps.vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) {
      this.files = []
      return
    }

    const root = folders[0]!.uri.fsPath
    try {
      const uris = await this.deps.vscode.workspace.findFiles("**/*", "**/node_modules/**", 5000)
      this.files = uris
        .map((uri) => this.deps.vscode.workspace.asRelativePath(uri))
        .filter((relative) => relative && !relative.startsWith("../") && !relative.includes("node_modules"))
        .sort()
    } catch (err) {
      console.warn("[WorkspaceFileIndex] refresh failed", err)
      this.files = []
    }
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
    if (!p.startsWith(root + "/") && p !== root) return null
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
      this.deps.vscode.workspace.onDidCreateFiles(() => this.refresh()),
      this.deps.vscode.workspace.onDidDeleteFiles(() => this.refresh()),
      this.deps.vscode.workspace.onDidRenameFiles(() => this.refresh()),
    )
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []
  }
}
