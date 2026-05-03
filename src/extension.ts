import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { ContextEngine } from "./context/ContextEngine"
import { ContextMonitor } from "./monitor/ContextMonitor"
import { TerminalBridge } from "./terminal/TerminalBridge"
import { CheckpointManager } from "./checkpoint/CheckpointManager"
import { SkillManager } from "./skills/SkillManager"
import { InlineActionProvider } from "./inline/InlineActionProvider"
import { ChatProvider } from "./chat/ChatProvider"
import { ThemeManager } from "./theme/ThemeManager"

let sessionManager: SessionManager

export function activate(context: vscode.ExtensionContext) {
  sessionManager = new SessionManager()

  const contextEngine = new ContextEngine()
  context.subscriptions.push(contextEngine)

  const contextMonitor = new ContextMonitor()
  context.subscriptions.push(contextMonitor)

  const themeManager = new ThemeManager()
  context.subscriptions.push(themeManager)

  const terminalBridge = new TerminalBridge()
  context.subscriptions.push(terminalBridge)

  const checkpointManager = new CheckpointManager()
  context.subscriptions.push(checkpointManager)

  const skillManager = new SkillManager()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("opencode-harness.skills", skillManager)
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.enableSkill", async (item: { id: string }) => {
      if (item) await skillManager.enableSkill(item.id)
    }),
    vscode.commands.registerCommand("opencode-harness.disableSkill", async (item: { id: string }) => {
      if (item) await skillManager.disableSkill(item.id)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.rollback", async () => {
      const sessions = await sessionManager.listSessions()
      const allCheckpoints = await checkpointManager.listCheckpoints(sessions[0]?.id || "")
      const items = allCheckpoints.map((c) => ({
        label: `Checkpoint ${c.id}`,
        description: new Date(c.timestamp).toLocaleString(),
        detail: `${c.filesChanged.length} files changed`,
        id: c.id,
      }))
      const selected = await vscode.window.showQuickPick(items, { placeHolder: "Select checkpoint to restore" })
      if (selected) await checkpointManager.restore(selected.id)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.captureTerminal", async () => {
      await terminalBridge.captureTerminalSelection()
    })
  )

  const inlineProvider = new InlineActionProvider()
  for (const lang of ["typescript", "javascript", "python", "rust", "go"]) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file", language: lang }, inlineProvider)
    )
  }

  for (const action of ["explainCode", "refactorCode", "generateTests"]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`opencode-harness.${action}`, async (uri: vscode.Uri) => {
        const doc = await vscode.workspace.openTextDocument(uri)
        vscode.window.showInformationMessage(`${action.replace("Code", "")} requested for ${vscode.workspace.asRelativePath(uri)}`)
      })
    )
  }

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

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.insertMention", () => {
      vscode.commands.executeCommand("opencode-harness.chat.focus")
    })
  )

  const chatProvider = new ChatProvider(context, sessionManager, contextEngine, contextMonitor, themeManager)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode-harness.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        const params = new URLSearchParams(uri.query)
        const prompt = params.get("prompt")
        const sessionId = params.get("session")
        vscode.commands.executeCommand("opencode-harness.chat.focus")
        if (sessionId) console.log(`[OpenCode Harness] Resume session: ${sessionId}`)
        if (prompt) console.log(`[OpenCode Harness] Pre-fill prompt: ${decodeURIComponent(prompt)}`)
      },
    })
  )

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
