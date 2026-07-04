import * as vscode from "vscode"
import { scanLensTargets } from "./inlineLensScanner"

const MAX_DOC_SIZE = 500 * 1024

interface CacheEntry {
  version: number
  lenses: vscode.CodeLens[]
}

export class InlineActionProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  onDidChangeCodeLenses = this._onDidChangeCodeLenses.event
  private cache = new Map<string, CacheEntry>()
  private debounceTimer: ReturnType<typeof setTimeout> | undefined

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.getText().length > MAX_DOC_SIZE) return []

    const key = document.uri.toString()
    const cached = this.cache.get(key)
    if (cached && cached.version === document.version) return cached.lenses

    const text = document.getText()
    const targets = scanLensTargets(text)
    const lenses: vscode.CodeLens[] = []

    for (const target of targets) {
      const range = new vscode.Range(
        document.positionAt(target.startOffset),
        document.positionAt(target.endOffset),
      )
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document.uri, range] }),
      )
    }

    this.cache.set(key, { version: document.version, lenses })
    return lenses
  }

  /** Called from extension.ts to wire up cache eviction on document close. */
  onDocumentClose(document: vscode.TextDocument): void {
    this.cache.delete(document.uri.toString())
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this._onDidChangeCodeLenses.dispose()
  }
}
