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
      const pos = document.positionAt(match.index)
      const range = new vscode.Range(pos, pos)
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document.uri, range] }),
      )
    }

    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    while ((match = classRegex.exec(text)) !== null) {
      const pos = document.positionAt(match.index)
      const range = new vscode.Range(pos, pos)
      lenses.push(
        new vscode.CodeLens(range, { title: "$(comment) Explain", command: "opencode-harness.explainCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(edit) Refactor", command: "opencode-harness.refactorCode", arguments: [document.uri, range] }),
        new vscode.CodeLens(range, { title: "$(beaker) Test", command: "opencode-harness.generateTests", arguments: [document.uri, range] }),
      )
    }

    return lenses
  }
}
