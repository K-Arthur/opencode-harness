import * as vscode from "vscode"

export interface GatherConfig {
  mode: "basic" | "deep"
}

export interface ContextPackage {
  openFiles: {
    path: string
    language: string
    content: string
    selection?: { startLine: number; endLine: number; text: string }
  }[]
  diagnostics: { file: string; errors: string[]; warnings: string[]; hints: string[] }[]
  workspaceTree: { name: string; type: "file" | "directory"; children?: unknown[] }[]
  projectConfigs: { type: string; path: string; content: string }[]
  gitStatus: { branch: string; modified: string[]; staged: string[]; recentDiff?: string }
  terminalOutput?: { name: string; text: string }
  explicitContext?: { type: string; content: string }[]
}

export class ContextEngine {
  private _onConfigChanged = new vscode.EventEmitter<void>()
  onConfigChanged = this._onConfigChanged.event

  async gatherContext(config: GatherConfig = { mode: "basic" }): Promise<ContextPackage> {
    const [openFiles, diagnostics, workspaceTree, projectConfigs, gitStatus] = await Promise.all([
      this.gatherOpenFiles(),
      this.gatherDiagnostics(),
      this.gatherWorkspaceTree(),
      this.gatherProjectConfigs(),
      this.gatherGitStatus(),
    ])

    return { openFiles, diagnostics, workspaceTree, projectConfigs, gitStatus }
  }

  private async gatherOpenFiles(): Promise<ContextPackage["openFiles"]> {
    const result: ContextPackage["openFiles"] = []
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)

    for (const tab of tabs) {
      if (tab.input && typeof tab.input === "object" && "uri" in tab.input) {
        const uri = (tab.input as { uri: vscode.Uri }).uri
        try {
          const doc = await vscode.workspace.openTextDocument(uri)
          let content = doc.getText()
          if (content.length > 8192) {
            content = content.slice(0, 8192) + `\n[File truncated: remaining ${content.length - 8192} chars hidden]`
          }

          const editor = vscode.window.activeTextEditor
          let selection
          if (editor && editor.document.uri.toString() === uri.toString() && !editor.selection.isEmpty) {
            selection = {
              startLine: editor.selection.start.line + 1,
              endLine: editor.selection.end.line + 1,
              text: editor.document.getText(editor.selection),
            }
          }

          result.push({
            path: vscode.workspace.asRelativePath(uri),
            language: doc.languageId,
            content,
            selection,
          })
        } catch {
          // skip inaccessible files
        }
      }
    }
    return result.slice(0, 10)
  }

  private gatherDiagnostics(): ContextPackage["diagnostics"] {
    return vscode.languages.getDiagnostics()
      .filter(([_, diags]) => diags.length > 0)
      .map(([uri, diags]) => ({
        file: vscode.workspace.asRelativePath(uri),
        errors: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message),
        warnings: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).map((d) => d.message),
        hints: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint || d.severity === vscode.DiagnosticSeverity.Information).map((d) => d.message),
      }))
  }

  private async gatherWorkspaceTree(depth = 3): Promise<ContextPackage["workspaceTree"]> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return []

    try {
      // M3: Find files with a reasonable limit to avoid performance issues
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folders[0].uri, "**/*"),
        "**/node_modules/**",
        100
      )

      const tree: Map<string, { name: string; type: "file" | "directory" }> = new Map()

      for (const file of files) {
        const relative = vscode.workspace.asRelativePath(file)
        const parts = relative.split("/")
        if (parts.length > depth) continue
        for (let i = 0; i < parts.length; i++) {
          const fullPath = parts.slice(0, i + 1).join("/")
          if (!tree.has(fullPath)) {
            tree.set(fullPath, {
              name: parts[i],
              type: i === parts.length - 1 ? "file" : "directory",
            })
          }
        }
      }

      return Array.from(tree.values())
    } catch (err) {
      console.warn("[ContextEngine] Failed to gather workspace tree", err)
      return []
    }
  }

  private async gatherProjectConfigs(): Promise<ContextPackage["projectConfigs"]> {
    const configs: ContextPackage["projectConfigs"] = []
    const configFiles = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"]

    for (const fileName of configFiles) {
      const files = await vscode.workspace.findFiles(fileName, "**/node_modules/**", 1)
      if (files.length > 0) {
        try {
          const doc = await vscode.workspace.openTextDocument(files[0])
          configs.push({
            type: fileName,
            path: vscode.workspace.asRelativePath(files[0]),
            content: doc.getText(),
          })
        } catch {
          // skip
        }
      }
    }

    return configs
  }

  private async gatherGitStatus(): Promise<ContextPackage["gitStatus"]> {
    try {
      const gitExt = vscode.extensions.getExtension("vscode.git")
      if (!gitExt || !gitExt.isActive) {
        return { branch: "unknown", modified: [], staged: [] }
      }
      const git = gitExt.exports.getAPI(1)
      const repo = git.repositories[0]
      if (!repo) return { branch: "unknown", modified: [], staged: [] }
      return {
        branch: repo.state.HEAD?.name || "unknown",
        modified: repo.state.workingTreeChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath),
        staged: repo.state.indexChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath),
      }
    } catch {
      return { branch: "unknown", modified: [], staged: [] }
    }
  }

  dispose(): void {
    this._onConfigChanged.dispose()
  }
}
