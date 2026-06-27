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

  /** Best available text editor: cached → active → any visible. */
  private bestEditor(): vscode.TextEditor | undefined {
    if (this.lastKnownEditor && !this.lastKnownEditor.document.isClosed) {
      return this.lastKnownEditor
    }
    return (
      this.deps.vscode.window.activeTextEditor ??
      this.deps.vscode.window.visibleTextEditors[0]
    )
  }

  start(): void {
    // Capture the best available editor immediately (handles the common case
    // where resolveWebviewView fires while a text file is already open in
    // another editor group — activeTextEditor is undefined in that case
    // because the sidebar is what triggered the resolve).
    const initial = this.bestEditor()
    if (initial) this.lastKnownEditor = initial

    this.disposables.push(
      this.deps.vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          // A real text editor gained focus — update the pill and cache it.
          this.lastKnownEditor = editor
          this.postActiveFile(editor)
        } else {
          const visible = this.deps.vscode.window.visibleTextEditors
          if (visible.length === 0) {
            // All text editors are now closed — hide the pill.
            this.lastKnownEditor = undefined
            this.postActiveFile(undefined)
          } else if (!this.lastKnownEditor) {
            // A non-editor panel (webview/sidebar) got focus and we have never
            // tracked any editor yet — surface the first visible one so the
            // pill appears on first load without the user having to click the file.
            const fallback = visible[0]
            if (fallback) {
              this.lastKnownEditor = fallback
              this.postActiveFile(fallback)
            }
          }
          // else: lastKnownEditor is set and webview/panel got focus
          // → keep the pill showing the last known file (do nothing).
        }
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
   * and after reconnect/restore. Uses `bestEditor()` which falls back through
   * lastKnownEditor → activeTextEditor → visibleTextEditors[0], so it works
   * even when the sidebar panel itself has focus (making activeTextEditor
   * undefined) but a text file is open in another editor group.
   */
  repost(): void {
    this.postActiveFile(this.bestEditor())
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
