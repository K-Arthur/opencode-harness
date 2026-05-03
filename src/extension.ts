import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"

let sessionManager: SessionManager

export function activate(context: vscode.ExtensionContext) {
  sessionManager = new SessionManager()

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.newSession", async () => {
      if (!sessionManager.isRunning) {
        await sessionManager.start()
      }
      const session = await sessionManager.createSession()
      vscode.window.showInformationMessage(`Session created: ${session.id}`)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.toggleFocus", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-harness")
    })
  )

  // ChatProvider will be registered here in Task 7
  // const chatProvider = new ChatProvider(context, sessionManager)
  // context.subscriptions.push(
  //   vscode.window.registerWebviewViewProvider("opencode-harness.chat", chatProvider)
  // )

  context.subscriptions.push({
    dispose: () => {
      sessionManager.dispose()
    },
  })

  console.log("[OpenCode Harness] Extension activated")
}

export function deactivate() {
  if (sessionManager) {
    sessionManager.dispose()
  }
}
