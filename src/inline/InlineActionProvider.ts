import * as vscode from "vscode"

export class InlineActionProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = []
    const text = document.getText()

    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g
    let match
    while ((match = funcRegex.exec(text)) !== null) {
      const name = match[1] || match[2]
      const range = this.getSymbolRange(document, text, match.index, funcRegex.lastIndex)
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document.uri, range] }),
      )
    }

    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    while ((match = classRegex.exec(text)) !== null) {
      const range = this.getSymbolRange(document, text, match.index, classRegex.lastIndex)
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document.uri, range] }),
      )
    }

    return lenses
  }

  private getSymbolRange(document: vscode.TextDocument, text: string, startOffset: number, searchFrom: number): vscode.Range {
    const bodyStart = text.indexOf("{", searchFrom)
    if (bodyStart === -1) {
      const start = document.positionAt(startOffset)
      return document.lineAt(start.line).range
    }

    let depth = 0
    for (let i = bodyStart; i < text.length; i++) {
      const ch = text[i]
      if (ch === "{") depth++
      if (ch === "}") {
        depth--
        if (depth === 0) {
          return new vscode.Range(document.positionAt(startOffset), document.positionAt(i + 1))
        }
      }
    }

    return new vscode.Range(document.positionAt(startOffset), document.positionAt(text.length))
  }
}
