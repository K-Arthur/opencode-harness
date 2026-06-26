import type * as vscode from "vscode"
import type { WorkspaceFileIndex } from "./WorkspaceFileIndex"

const MAX_ACTIVE_FILE_BYTES = 1 * 1024 * 1024 // 1 MB

export interface ActiveFileSelection {
  startLine: number
  endLine: number
  text: string
}

export interface ActiveFileTrackerDeps {
  vscode: typeof vscode
  postMessage: (msg: Record<string, unknown>) => void
  workspaceFileIndex: WorkspaceFileIndex
}

export class ActiveFileTracker {
  private disposables: vscode.Disposable[] = []

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

  /**
   * Re-deliver the current active file to the webview.
   *
   * `start()` posts the active file eagerly during `resolveWebviewView`, but
   * that fires before the webview script has registered its message handlers
   * (it signals `webview_ready` only after wiring up). Because `active_file`
   * is a passthrough message it is sent immediately rather than queued, so the
   * initial post is dropped and the context pill never appears until the user
   * switches editors. The host calls `repost()` from the `webview_ready`
   * handler so the pill shows on first open and after reconnect/restore.
   */
  repost(): void {
    this.postActiveFile(this.deps.vscode.window.activeTextEditor)
  }

  private isBinaryFile(languageId: string): boolean {
    // Common binary file language IDs
    const binaryLanguageIds = new Set([
      "image",
      "png",
      "jpeg",
      "jpg",
      "gif",
      "svg",
      "webp",
      "bmp",
      "tiff",
      "ico",
      "pdf",
      "zip",
      "tar",
      "gz",
      "7z",
      "rar",
      "exe",
      "dll",
      "so",
      "dylib",
      "bin",
      "dat",
      "sqlite",
      "db",
    ])
    return binaryLanguageIds.has(languageId.toLowerCase())
  }

  private postActiveFile(editor: vscode.TextEditor | undefined): void {
    if (!editor?.document?.uri) {
      this.deps.postMessage({ type: "active_file", path: null, selection: null })
      return
    }

    const path = this.deps.workspaceFileIndex.asRelativePath(editor.document.uri)
    if (!path) {
      this.deps.postMessage({ type: "active_file", path: null, selection: null })
      return
    }

    // Check file size
    const fileSize = editor.document.getText().length
    if (fileSize > MAX_ACTIVE_FILE_BYTES) {
      this.deps.postMessage({
        type: "active_file",
        path: null,
        selection: null,
        reason: "file_too_large",
      })
      return
    }

    // Check for binary file
    if (this.isBinaryFile(editor.document.languageId)) {
      this.deps.postMessage({
        type: "active_file",
        path: null,
        selection: null,
        reason: "binary_file",
      })
      return
    }

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

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []
  }
}
