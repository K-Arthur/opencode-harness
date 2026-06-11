import type { CommandEntry } from "./commands-modal"
import { resolveLocalCommand } from "./slash-commands"

export interface SlashCommandDeps {
  stateManager: {
    getActiveSession(): { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null
    setSessionModel(id: string, model: string): void
    setGlobalModel(model: string): void
  }
  vscode: {
    postMessage(msg: Record<string, unknown>): void
  }
  modelDropdown: {
    setCurrentModel(model: string): void
    open(): void
  }
  commandsModal: {
    open(): void
  }
  clearPromptInput(): void
  createNewTab(title?: string): void
  showSystemMessage(sessionId: string, message: string): void
  syncModelViews(): void
  renderQueue(tabId: string): void
}

type ActiveSession = NonNullable<ReturnType<SlashCommandDeps["stateManager"]["getActiveSession"]>>

export function createSlashCommandHandler(deps: SlashCommandDeps) {
  const {
    stateManager,
    vscode,
    modelDropdown,
    commandsModal,
    clearPromptInput,
    createNewTab,
    showSystemMessage,
    syncModelViews,
    renderQueue,
  } = deps

  function runSlashCommandText(
    text: string,
    active: ActiveSession,
  ): void {
    const parts = text.split(/\s+/)
    const typed = (parts[0] || "").toLowerCase()
    // Aliases (e.g. /export-md) normalize to their canonical command so the
    // switch below only ever sees canonical names. Unknown commands keep the
    // typed form and fall through to the host/server.
    const resolved = resolveLocalCommand(typed)
    const cmd = resolved ? `/${resolved.name}` : typed
    const commandArgs = parts.slice(1).join(" ")
    switch (cmd) {
      case "/clear":
        vscode.postMessage({ type: "execute_command", command: "/clear", sessionId: active.id })
        clearPromptInput()
        return
      case "/model":
        if (commandArgs) {
          stateManager.setSessionModel(active.id, commandArgs)
          stateManager.setGlobalModel(commandArgs)
          modelDropdown.setCurrentModel(commandArgs)
          syncModelViews()
          vscode.postMessage({ type: "set_model", model: commandArgs, sessionId: active.id })
          clearPromptInput()
          return
        }
        vscode.postMessage({ type: "get_models" })
        modelDropdown.open()
        clearPromptInput()
        return
      case "/cost":
        vscode.postMessage({ type: "execute_command", command: "/cost", sessionId: active.id })
        clearPromptInput()
        return
      case "/new":
        createNewTab()
        clearPromptInput()
        return
      case "/help":
        vscode.postMessage({ type: "execute_command", command: "/help", sessionId: active.id })
        clearPromptInput()
        return
      case "/export":
        vscode.postMessage({ type: "export_chat" })
        clearPromptInput()
        return
      case "/export-json":
        vscode.postMessage({ type: "export_chat_json" })
        clearPromptInput()
        return
      case "/export-text":
        vscode.postMessage({ type: "export_chat_text" })
        clearPromptInput()
        return
      case "/copy":
        vscode.postMessage({ type: "copy_chat" })
        clearPromptInput()
        return
      case "/stash": {
        const stashName = (parts[1] && parts[1].trim()) ? parts[1] : "Untitled"
        const inlineContent = parts.slice(2).join(" ").trim()
        const stashContent = inlineContent || text.replace(/^\/stash(?:\s+\S+)?\s*/i, "").trim()
        if (!stashContent) {
          showSystemMessage(active.id, "Usage: /stash <name> <content>")
        } else {
          vscode.postMessage({ type: "stash_prompt", name: stashName, content: stashContent, isGlobal: true })
        }
        clearPromptInput()
        return
      }
      case "/stashes":
        vscode.postMessage({ type: "list_stashes" })
        clearPromptInput()
        return
      case "/compact":
        vscode.postMessage({ type: "compact_session", sessionId: active.id })
        showSystemMessage(active.id, "Compacting session...")
        clearPromptInput()
        return
      case "/commands":
        commandsModal.open()
        vscode.postMessage({ type: "list_commands" })
        clearPromptInput()
        return
      case "/queue":
        renderQueue(active.id)
        clearPromptInput()
        return
      case "/continue":
        vscode.postMessage({ type: "execute_command", command: "/continue", sessionId: active.id })
        clearPromptInput()
        return
      default:
        vscode.postMessage({ type: "execute_command", command: cmd, arguments: commandArgs, sessionId: active.id })
        clearPromptInput()
        return
    }
  }

  function runCommandEntry(entry: CommandEntry): void {
    const active = stateManager.getActiveSession()
    if (!active) return
    if (entry.source === "local") {
      runSlashCommandText(entry.insertText || `/${entry.name}`, active)
      return
    }
    if ((entry as any).run) {
      ;(entry as any).run()
      return
    }
    vscode.postMessage({ type: "execute_command", command: `/${entry.name}`, sessionId: active.id })
  }

  return { runSlashCommandText, runCommandEntry }
}
