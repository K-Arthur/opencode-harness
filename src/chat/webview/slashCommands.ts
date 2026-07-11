import type { CommandEntry } from "./commands-modal"
import { resolveLocalCommand, resolveMcpNamespace, resolveNamespacedCommand, type RemoteCommandInfo } from "./slash-commands"

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
  createNewTab(title?: string, options?: { ephemeral?: boolean }): void
  showSystemMessage(sessionId: string, message: string): void
  syncModelViews(): void
  renderQueue(tabId: string): void
  /**
   * Returns the cached remote (server/MCP/skill) command list. Used by the
   * default-case handler to detect MCP namespace-prefixed invocations like
   * `/jcodemunch triage` and rewrite them to the canonical `/triage` form
   * before forwarding to the host.
   */
  getServerCommands?: () => ReadonlyArray<RemoteCommandInfo>
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
    // ── @namespace /command hierarchical syntax ──
    // Detect `@jcodemunch /triage args` before the normal slash dispatch.
    // The @ prefix binds the namespace to the following /command, routing
    // through strict origin+name matching (no broad-match fallback).
    const nsMatch = text.match(/^@(\S+)\s+\/(\S+)\s*(.*)$/)
    if (nsMatch) {
      const namespace = nsMatch[1]!
      const command = nsMatch[2]!
      const nsArgs = nsMatch[3] || ""
      const remoteCommands = deps.getServerCommands?.() ?? []
      const resolvedNs = resolveNamespacedCommand(namespace, command, nsArgs, remoteCommands)
      if (resolvedNs) {
        vscode.postMessage({
          type: "execute_command",
          command: resolvedNs.command,
          arguments: resolvedNs.arguments,
          sessionId: active.id,
        })
      } else {
        const cmdName = command.toLowerCase()
        const isKnownRemote = remoteCommands.some((c) => c.name.toLowerCase() === cmdName)
        if (!isKnownRemote) {
          showSystemMessage(
            active.id,
            `\`@${namespace} /${command}\` did not match a command from \`${namespace}\`. Forwarding as-is — use \`/commands\` to browse available commands.`,
          )
        }
        vscode.postMessage({
          type: "execute_command",
          command: `/${command}`,
          arguments: nsArgs,
          sessionId: active.id,
        })
      }
      clearPromptInput()
      return
    }

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
      case "/temp":
      case "/temporary":
        createNewTab("Temporary chat", { ephemeral: true })
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
      case "/template": {
        const subCmd = (parts[1] || "").toLowerCase()
        if (subCmd === "list" || !subCmd) {
          vscode.postMessage({ type: "list_templates" })
        } else if (subCmd === "delete") {
          const tplName = parts.slice(2).join(" ").trim()
          if (tplName) {
            vscode.postMessage({ type: "delete_template", id: tplName })
          } else {
            showSystemMessage(active.id, "Usage: /template delete <name>")
          }
        } else {
          vscode.postMessage({ type: "list_templates" })
        }
        clearPromptInput()
        return
      }
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
      default: {
        // Before forwarding an unknown command to the host, check whether it
        // matches an MCP namespace pattern (e.g. `/jcodemunch triage`). Users
        // naturally type `/server tool` but the server registers each MCP tool
        // as a top-level command (e.g. `/triage`). If we detect this pattern,
        // rewrite to the canonical form so the command succeeds.
        const remoteCommands = deps.getServerCommands?.() ?? []
        const resolved = resolveMcpNamespace(cmd, commandArgs, remoteCommands, (info) => {
          const sources = info.candidates
            .map((c) => `${c.source ?? "unknown"}${c.origin ? `:${c.origin}` : ""}`)
            .join(", ")
          showSystemMessage(
            active.id,
            `\`${cmd}\` is ambiguous — \`${info.suffix}\` is provided by: ${sources}. Use \`/namespace:command\` to disambiguate.`,
          )
          vscode.postMessage({
            type: "log_ambiguity",
            prefix: info.prefix,
            suffix: info.suffix,
            candidates: info.candidates.map((c) => ({ name: c.name, source: c.source, origin: c.origin })),
          })
        })
        if (resolved) {
          vscode.postMessage({
            type: "execute_command",
            command: resolved.command,
            arguments: resolved.arguments,
            sessionId: active.id,
          })
        } else {
          // Non-blocking guidance: if the command is not in the cached server
          // list either, surface a brief tip so the user knows where to look.
          // We still forward the command — the server may recognise it even if
          // our cache is stale, so we never reject.
          const cmdName = cmd.replace(/^\//, "").toLowerCase()
          const isKnownRemote = remoteCommands.some((c) => c.name.toLowerCase() === cmdName)
          if (!isKnownRemote) {
            showSystemMessage(
              active.id,
              `\`${cmd}\` is not a recognised command. Forwarding anyway — if it fails, use \`/commands\` to browse available commands.`,
            )
          }
          vscode.postMessage({ type: "execute_command", command: cmd, arguments: commandArgs, sessionId: active.id })
        }
        clearPromptInput()
        return
      }
    }
  }

  function runCommandEntry(entry: CommandEntry): void {
    const active = stateManager.getActiveSession()
    if (!active) return
    if (entry.source === "local") {
      runSlashCommandText(entry.insertText || `/${entry.name}`, active)
      return
    }
    if (entry.run) {
      entry.run()
      return
    }
    vscode.postMessage({ type: "execute_command", command: `/${entry.name}`, sessionId: active.id })
  }

  return { runSlashCommandText, runCommandEntry }
}
