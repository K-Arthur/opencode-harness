import type * as vscode from "vscode"
import type { WorkspaceFileIndex } from "./WorkspaceFileIndex"

export interface ActiveFileSelection {
  startLine: number
  endLine: number
  text: string
}

export interface ActiveFileContent {
  path: string
  languageId: string
  content: string
  selection?: ActiveFileSelection
}

export interface ActiveFileTrackerDeps {
  vscode: typeof vscode
  postMessage: (msg: Record<string, unknown>) => void
  workspaceFileIndex: WorkspaceFileIndex
}

export class ActiveFileTracker {
  private disposables: vscode.Disposable[] = []
  private readonly includeState = new Map<string, boolean>()

  constructor(private readonly deps: ActiveFileTrackerDeps) {}

  start(): void {
    this.disposables.push(
      this.deps.vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.postActiveFile(editor)
      }),
      this.deps.vscode.window.onDidChangeTextEditorSelection((event) => {
        this.postActiveFile(event.textEditor)
      }),
    )
    this.postActiveFile(this.deps.vscode.window.activeTextEditor)
  }

  private postActiveFile(editor: vscode.TextEditor | undefined): void {
    if (!editor?.document?.uri) {
      this.deps.postMessage({ type: "active_file", path: null, selection: null })
      return
    }
    const path = this.deps.workspaceFileIndex.asRelativePath(editor.document.uri)
    const selection = this.extractSelection(editor)
    this.deps.postMessage({
      type: "active_file",
      path,
      languageId: editor.document.languageId,
      lineCount: editor.document.lineCount,
      selection,
    })
  }

  private extractSelection(editor: vscode.TextEditor): ActiveFileSelection | null {
    const sel = editor.selection
    if (!sel || sel.isEmpty) return null
    return {
      startLine: sel.start.line + 1,
      endLine: sel.end.line + 1,
      text: editor.document.getText(sel),
    }
  }

  handleToggleActiveFile(sessionId: string, include: boolean): void {
    this.includeState.set(sessionId, include)
  }

  isIncluded(sessionId: string): boolean {
    return this.includeState.get(sessionId) === true
  }

  clearSession(sessionId: string): void {
    this.includeState.delete(sessionId)
  }

  async getActiveFileContent(): Promise<ActiveFileContent | null> {
    const editor = this.deps.vscode.window.activeTextEditor
    if (!editor?.document?.uri) return null
    const relativePath = this.deps.workspaceFileIndex.asRelativePath(editor.document.uri)
    if (!relativePath) return null
    const doc = await this.deps.vscode.workspace.openTextDocument(editor.document.uri)
    const selection = this.extractSelection(editor)
    return {
      path: relativePath,
      languageId: doc.languageId,
      content: selection ? selection.text : doc.getText(),
      selection: selection ?? undefined,
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []
    this.includeState.clear()
  }
}
