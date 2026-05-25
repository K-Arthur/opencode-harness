import * as vscode from "vscode"
import type { WorkspaceAdapter, OpenTab, DocumentContent, SelectionRange, AdapterDiagnostic, GitState } from "./WorkspaceAdapter"

export class VSCodeWorkspaceAdapter implements WorkspaceAdapter {
  listOpenTabs(): OpenTab[] {
    return vscode.window.tabGroups.all.flatMap((g) => g.tabs)
      .filter((tab): tab is typeof tab & { input: { uri: vscode.Uri } } =>
        !!tab.input && typeof tab.input === "object" && "uri" in tab.input,
      )
      .map((tab) => ({ uri: tab.input.uri.toString() }))
  }

  getActiveSelection(): SelectionRange | undefined {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.selection.isEmpty) return undefined
    return {
      uri: editor.document.uri.toString(),
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
      text: editor.document.getText(editor.selection),
    }
  }

  async readFile(uri: string): Promise<DocumentContent> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
    return { content: doc.getText(), languageId: doc.languageId }
  }

  getRelativePath(uri: string): string {
    return vscode.workspace.asRelativePath(vscode.Uri.parse(uri))
  }

  getDiagnostics(): AdapterDiagnostic[] {
    return vscode.languages.getDiagnostics()
      .filter(([_, diags]) => diags.length > 0)
      .map(([uri, diags]) => ({
        file: vscode.workspace.asRelativePath(uri),
        errors: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message),
        warnings: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).map((d) => d.message),
        hints: diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint || d.severity === vscode.DiagnosticSeverity.Information).map((d) => d.message),
      }))
  }

  getWorkspaceFolders(): string[] {
    const folders = vscode.workspace.workspaceFolders
    if (!folders) return []
    return folders.map((f) => f.uri.toString())
  }

  async findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]> {
    const files = await vscode.workspace.findFiles(pattern, exclude, maxResults)
    return files.map((f) => f.toString())
  }

  getGitInfo(): GitState {
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
}
