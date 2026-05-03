import * as vscode from "vscode"
import { SessionManager } from "./session/SessionManager"
import { SessionStore } from "./session/SessionStore"
import { ContextEngine } from "./context/ContextEngine"
import { ContextMonitor } from "./monitor/ContextMonitor"
import { TerminalBridge } from "./terminal/TerminalBridge"
import { CheckpointManager } from "./checkpoint/CheckpointManager"
import { SkillManager } from "./skills/SkillManager"
import { InlineActionProvider } from "./inline/InlineActionProvider"
import { ChatProvider } from "./chat/ChatProvider"
import { ThemeManager } from "./theme/ThemeManager"
import { RateLimitMonitor } from "./monitor/RateLimitMonitor"
import { ModelManager } from "./model/ModelManager"
import { CliDiagnostics } from "./diagnostics/CliDiagnostics"

let sessionManager: SessionManager

export function activate(context: vscode.ExtensionContext) {
  sessionManager = new SessionManager()

  const contextEngine = new ContextEngine()
  context.subscriptions.push(contextEngine)

  const contextMonitor = new ContextMonitor()
  context.subscriptions.push(contextMonitor)

  const themeManager = new ThemeManager()
  context.subscriptions.push(themeManager)

  const rateLimitMonitor = new RateLimitMonitor()
  context.subscriptions.push(rateLimitMonitor)

  const terminalBridge = new TerminalBridge()
  context.subscriptions.push(terminalBridge)

  const checkpointManager = new CheckpointManager()
  context.subscriptions.push(checkpointManager)

  const modelManager = new ModelManager()
  context.subscriptions.push(modelManager)

  const cliDiagnostics = new CliDiagnostics()
  context.subscriptions.push(cliDiagnostics)

  const sessionStore = new SessionStore(context.globalState)
  // Ensure at least one session exists
  if (sessionStore.count === 0) {
    sessionStore.create("Default")
  }

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
      const session = sessionStore.create()
      vscode.window.showInformationMessage(`New session: ${session.name}`)
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

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.showRateLimits", () => {
      rateLimitMonitor.showDetail()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.selectModel", async () => {
      const currentModel = modelManager.model
      const model = await modelManager.pickModel()
      if (model && model !== currentModel) {
        // Trigger session restart if active
        sessionManager.setModel(model)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.checkCli", async () => {
      const ok = await cliDiagnostics.check()
      if (ok) {
        vscode.window.showInformationMessage("OpenCode CLI is working correctly.")
      } else {
        vscode.window.showErrorMessage("OpenCode CLI check failed. See 'OpenCode CLI Communication' output channel for details.")
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.listSessions", async () => {
      const sessions = sessionStore.list()
      if (sessions.length === 0) {
        vscode.window.showInformationMessage("No saved sessions.")
        return
      }
      const items = sessions.map((s) => ({
        label: s.name,
        description: `${s.messages.length} messages`,
        detail: `${new Date(s.lastActiveAt).toLocaleDateString()} — ${s.model || "no model"}`,
        id: s.id,
      }))
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Switch to session" })
      if (picked) {
        sessionStore.setActive(picked.id)
        vscode.window.showInformationMessage(`Switched to: ${picked.label}`)
      }
    })
  )

  const chatProvider = new ChatProvider(context, sessionManager, contextEngine, contextMonitor, themeManager, rateLimitMonitor, modelManager, sessionStore)
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
        vscode.commands.executeCommand("opencode-harness.chat.focus")
        if (prompt) console.log(`[OpenCode] Pre-fill prompt: ${decodeURIComponent(prompt)}`)
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
