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
  // Last non-undefined editor seen. Webview focus sets activeTextEditor to
  // undefined, so repost() uses this cached value to keep the pill visible
  // while the user types in the chat input about the file they had open.
  // Cleared only when all visible text editors are gone (user closed them).
  private lastKnownEditor: vscode.TextEditor | undefined

  constructor(private readonly deps: ActiveFileTrackerDeps) {}

  start(): void {
    const initial = this.deps.vscode.window.activeTextEditor
    if (initial) this.lastKnownEditor = initial

    this.disposables.push(
      this.deps.vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.lastKnownEditor = editor
        } else if (this.deps.vscode.window.visibleTextEditors.length === 0) {
          // All text editors closed — clear the cached editor so the pill hides.
          this.lastKnownEditor = undefined
        }
        this.postActiveFile(editor)
      }),
      this.deps.vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor) this.lastKnownEditor = event.textEditor
        this.postActiveFile(event.textEditor)
      }),
    )
    this.postActiveFile(initial)
  }

  /**
   * Re-deliver the current active file to the webview.
   *
   * Called from the `webview_ready` handler so the pill shows on first open
   * and after reconnect/restore. Uses the last known text editor rather than
   * `window.activeTextEditor`, which returns undefined whenever the webview
   * panel itself has focus — avoiding a spurious `path: null` post that would
   * hide the pill while the user types their prompt.
   */
  repost(): void {
    // Guard: if the cached editor's document was closed since we last saw it,
    // fall back to the live activeTextEditor (which may also be undefined).
    const editor =
      this.lastKnownEditor && !this.lastKnownEditor.document.isClosed
        ? this.lastKnownEditor
        : this.deps.vscode.window.activeTextEditor
    this.postActiveFile(editor)
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
