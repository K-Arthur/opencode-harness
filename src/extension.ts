import * as vscode from "vscode"

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.newSession", () => {
      vscode.window.showInformationMessage("New session started")
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.toggleFocus", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    })
  )

  console.log("[OpenCode Harness] Extension activated")
}

export function deactivate() {}
