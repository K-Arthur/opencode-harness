import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

interface ContextFile {
  uri: vscode.Uri
  content: string
  sessionId: string
}

/**
 * Provides read-only content for context files via virtual documents.
 * Allows users to view what files are in the current session context
 * without opening the actual files.
 */
export class ContextFileProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private static readonly SCHEME = "opencode-context"
  private contextFiles: Map<string, ContextFile> = new Map()
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>()
  private disposables: vscode.Disposable[] = []

  constructor() {
    // Register the provider
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        ContextFileProvider.SCHEME,
        this
      ),
      this._onDidChange
    )
  }

  /**
   * Add a file to the context view for a session
   */
  addFile(sessionId: string, filePath: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: ContextFileProvider.SCHEME,
      path: `/${sessionId}/${filePath}`
    })

    this.contextFiles.set(uri.toString(), {
      uri,
      content,
      sessionId
    })

    this._onDidChange.fire(uri)
    return uri
  }

  /**
   * Remove a file from the context view
   */
  removeFile(sessionId: string, filePath: string): void {
    const uri = vscode.Uri.from({
      scheme: ContextFileProvider.SCHEME,
      path: `/${sessionId}/${filePath}`
    })

    if (this.contextFiles.delete(uri.toString())) {
      this._onDidChange.fire(uri)
    }
  }

  /**
   * Clear all context files for a session
   */
  clearSession(sessionId: string): void {
    const toRemove: string[] = []
    
    for (const [key, file] of this.contextFiles) {
      if (file.sessionId === sessionId) {
        toRemove.push(key)
      }
    }

    for (const key of toRemove) {
      this.contextFiles.delete(key)
    }
  }

  /**
   * Get all context files for a session
   */
  getSessionFiles(sessionId: string): Array<{ uri: vscode.Uri; path: string; content: string }> {
    const result: Array<{ uri: vscode.Uri; path: string; content: string }> = []
    
    for (const file of this.contextFiles.values()) {
      if (file.sessionId === sessionId) {
        result.push({
          uri: file.uri,
          path: file.uri.path.split('/').slice(2).join('/'), // Remove sessionId prefix
          content: file.content
        })
      }
    }

    return result
  }

  /**
   * Implementation of TextDocumentContentProvider.provideTextDocumentContent
   */
  provideTextDocumentContent(uri: vscode.Uri): string | undefined {
    const file = this.contextFiles.get(uri.toString())
    if (!file) return undefined

    // Add header with file path
    const header = `// Context File: ${file.uri.path.split('/').slice(2).join('/')}\n`
    const separator = '// '.padEnd(80, '-') + '\n\n'
    
    return header + separator + file.content
  }

  /**
   * Event fired when content changes (for live updates)
   */
  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event
  }

  /**
   * Open a context file in a read-only editor
   */
  async openContextFile(sessionId: string, filePath: string, content: string): Promise<void> {
    try {
      const uri = this.addFile(sessionId, filePath, content)
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false
      })
    } catch (err) {
      log.error("Failed to open context file", err)
      vscode.window.showErrorMessage("Failed to open context file.")
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.contextFiles.clear()
  }
}
