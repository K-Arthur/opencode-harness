/**
 * Canonical registry of webview-resolved slash commands.
 *
 * Single source of truth for both surfaces that need to know about local
 * commands:
 *   1. The inline mention dropdown (`mentions.ts`) shown when a user types
 *      `/` mid-prompt.
 *   2. The standalone commands palette modal (`commands-modal.ts`) opened
 *      via `/commands` or its keybinding.
 *
 * Before this module existed each surface carried its own near-duplicate
 * list. They drifted (different descriptions for `/continue`, `/help`,
 * `/commands`; mentions had `/export-md` but the modal did not), giving
 * users different command sets depending on which UI they reached for.
 */

// NOTE: no icon imports here. This module is also bundled into the extension
// host (ChatCommands generates /help from the registry); pulling icons.ts in
// would ship every webview SVG string inside dist/extension.js. Icons are
// attached by the webview caller via the `icons` parameter of toMentionItems.
import type { MentionItem } from "./types"

/** Palette grouping; also drives future VS Code contribution generation. */
export type SlashCommandCategory = "session" | "conversation" | "prompt" | "export" | "debug"

export interface LocalSlashCommand {
  /** Name without the leading slash. */
  name: string
  /** End-user description; shown in both surfaces. */
  description: string
  /** Text inserted into the prompt input. Trailing space means "expects args". */
  insertText: string
  /** Alternate names that resolve to this command (kept for back-compat). */
  aliases?: ReadonlyArray<string>
  /** Argument hint rendered in /help and usage errors, e.g. "<name> <content>". */
  usage?: string
  category: SlashCommandCategory
}

/**
 * Authoritative list. Order is the user-facing presentation order in the
 * commands modal (mention dropdown filters/orders by query separately).
 */
export const LOCAL_SLASH_COMMANDS: ReadonlyArray<LocalSlashCommand> = Object.freeze([
  { name: "clear",       description: "Clear conversation, start a new server session", insertText: "/clear",       category: "session" },
  { name: "model",       description: "Switch the active model",                         insertText: "/model ",      category: "session", usage: "<id>" },
  { name: "cost",        description: "Show session cost (server figures when available)", insertText: "/cost",     category: "session" },
  { name: "new",         description: "Open a new session tab",                          insertText: "/new",         category: "session" },
  { name: "continue",    description: "Resume the most recently closed session",         insertText: "/continue",    category: "session" },
  { name: "compact",     description: "Compact session context to free tokens",          insertText: "/compact",     category: "session" },
  { name: "stash",       description: "Stash current prompt for reuse",                  insertText: "/stash ",      category: "prompt", usage: "<name> <content>" },
  { name: "stashes",     description: "Browse stashed prompts",                          insertText: "/stashes",     category: "prompt" },
  { name: "template",    description: "Save and reuse prompt templates",                 insertText: "/template ",   category: "prompt", usage: "[list|delete <name>]" },
  { name: "queue",       description: "Show queued prompts",                             insertText: "/queue",       category: "prompt" },
  { name: "commands",    description: "Open the command palette",                        insertText: "/commands",    category: "conversation" },
  { name: "methodology", description: "Show or toggle automatic methodology guidance for this tab", insertText: "/methodology ", category: "session", usage: "[on|off]" },
  { name: "export",      description: "Export conversation as Markdown",                 insertText: "/export",      category: "export", aliases: ["export-md"] },
  { name: "export-json", description: "Export conversation as JSON",                     insertText: "/export-json", category: "export" },
  { name: "export-text", description: "Export conversation as plain text",               insertText: "/export-text", category: "export" },
  { name: "copy",        description: "Copy conversation to clipboard",                  insertText: "/copy",        category: "export" },
  { name: "diagnose:generation", description: "Dump generation-tracking state to the output channel", insertText: "/diagnose:generation", category: "debug" },
  { name: "help",        description: "Show available slash commands",                   insertText: "/help",        category: "conversation" },
])

/** Lookup covering canonical names and aliases, lowercase keys. */
const COMMANDS_BY_NAME: ReadonlyMap<string, LocalSlashCommand> = (() => {
  const map = new Map<string, LocalSlashCommand>()
  for (const cmd of LOCAL_SLASH_COMMANDS) {
    map.set(cmd.name.toLowerCase(), cmd)
    for (const alias of cmd.aliases ?? []) map.set(alias.toLowerCase(), cmd)
  }
  return map
})()

/**
 * Resolve a typed command name (or alias) to its canonical registry entry.
 * Accepts an optional leading slash and any casing; returns undefined for
 * commands this webview does not own (server/MCP/custom-prompt commands).
 */
export function resolveLocalCommand(nameOrAlias: string): LocalSlashCommand | undefined {
  const key = nameOrAlias.replace(/^\//, "").toLowerCase()
  return COMMANDS_BY_NAME.get(key)
}

/**
 * Render the /help table from the registry so it can never drift from the
 * commands the webview actually accepts (the old hand-written table listed a
 * command missing from the registry and omitted one that existed).
 */
export function buildHelpTable(): string {
  const rows = LOCAL_SLASH_COMMANDS.map((cmd) => {
    const invocation = cmd.usage ? `/${cmd.name} ${cmd.usage}` : `/${cmd.name}`
    const aliasNote = cmd.aliases?.length ? ` (alias: ${cmd.aliases.map((a) => `/${a}`).join(", ")})` : ""
    return `| \`${invocation}\` | ${cmd.description}${aliasNote} |`
  })
  return ["| Command | Description |", "|---------|-------------|", ...rows].join("\n")
}

/**
 * Adapter: produce mention-dropdown items for every local command.
 * The mention dropdown displays them as inline suggestions while typing.
 * `icons` (command name → SVG string) is supplied by the webview caller so
 * the icon module never ends up in the extension-host bundle.
 */
export function toMentionItems(icons?: Readonly<Record<string, string>>): MentionItem[] {
  return LOCAL_SLASH_COMMANDS.map((cmd) => ({
    prefix: "/",
    display: cmd.name,
    description: cmd.description,
    icon: icons?.[cmd.name],
  }))
}

/**
 * Adapter: produce CommandEntry rows for the commands modal.
 * The modal mixes these with server-discovered and custom-prompt entries.
 */
export function toCommandEntries(): Array<{
  name: string
  description: string
  source: "local"
  insertText: string
}> {
  return LOCAL_SLASH_COMMANDS.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    source: "local" as const,
    insertText: cmd.insertText,
  }))
}

/**
 * How the composer should treat the current input, given stream state.
 *
 * - "prompt"        idle, plain text → normal send
 * - "slash"         idle, command-shaped → slash dispatcher
 * - "steer"         streaming, plain text → steering prompt
 * - "slash-blocked" streaming, command-shaped → refuse with a clear error;
 *                   commands must never be steer-leaked to the model as text
 * - "abort"         streaming, empty input → stop the stream (send button
 *                   doubles as stop)
 * - "empty"         idle, empty input → no-op
 *
 * Command-shaped means "/" followed by a non-space character. "/ literal…"
 * stays steerable as an escape hatch for the rare prompt that starts with a
 * slash.
 */
export type ComposerInputKind = "prompt" | "slash" | "steer" | "slash-blocked" | "abort" | "empty"

export function classifyComposerInput(text: string, isStreaming: boolean): ComposerInputKind {
  const trimmed = text.trim()
  if (!trimmed) return isStreaming ? "abort" : "empty"
  const commandShaped = /^\/\S/.test(trimmed)
  if (isStreaming) return commandShaped ? "slash-blocked" : "steer"
  // Preserve historical idle behavior: anything starting with "/" (even a
  // lone slash) routes to the slash dispatcher.
  return trimmed.startsWith("/") ? "slash" : "prompt"
}

/**
 * Filter server-reported commands so they don't duplicate local entries
 * (canonical names or aliases). Match is case-insensitive — the opencode
 * server has been seen to normalise some command names to uppercase in
 * different builds, and we never want a doubled `/clear` / `/CLEAR` row.
 *
 * `getName` lets callers whose items use a different field (mentions.ts
 * items carry `display`) share this logic instead of reimplementing it.
 */
export function dedupServerCommands<T extends { name: string }>(server: ReadonlyArray<T>): T[]
export function dedupServerCommands<T>(server: ReadonlyArray<T>, getName: (item: T) => string | undefined): T[]
export function dedupServerCommands<T>(server: ReadonlyArray<T>, getName?: (item: T) => string | undefined): T[] {
  const nameOf = getName ?? ((item: T) => (item as { name?: string }).name)
  return server.filter((c) => !COMMANDS_BY_NAME.has((nameOf(c) ?? "").toLowerCase()))
}

/**
 * Minimal shape needed for MCP namespace resolution.
 * `origin` is the MCP server name (the `agent` field from the server's
 * command list); `source` distinguishes MCP commands from plain server ones.
 */
export interface RemoteCommandInfo {
  name: string
  source?: string
  origin?: string
}

/**
 * Result of a successful namespace rewrite.
 * `command` is the canonical slash command to execute (e.g. "/triage");
 * `arguments` carries any remaining args after the tool name was extracted.
 */
export interface ResolvedNamespace {
  command: string
  arguments: string
}

/**
 * Information passed to the `onAmbiguous` callback when a command name is
 * shared across multiple sources and cannot be safely resolved.
 */
export interface AmbiguityInfo {
  /** The typed prefix (namespace the user specified). */
  prefix: string
  /** The command name that matched multiple sources. */
  suffix: string
  /** All remote commands sharing the ambiguous name. */
  candidates: ReadonlyArray<RemoteCommandInfo>
}

/**
 * Resolve a namespace-prefixed command invocation to its canonical form.
 *
 * The opencode server registers every command (MCP tool, skill, built-in) as a
 * flat top-level name (e.g. `/triage`), never under a server/namespace prefix.
 * But users naturally type the namespace they see in the UI:
 *
 *   Colon syntax:  `/jcodemunch:triage`     (most common — matches MCP tool naming)
 *   Space syntax:  `/jcodemunch triage`     (also natural)
 *
 * Both forms are rejected by the server ("Command not found"). This function
 * detects either pattern and rewrites to the flat command the server expects:
 *
 *   `/jcodemunch:triage my-issue`  →  command="/triage" args="my-issue"
 *   `/jcodemunch triage my-issue`  →  command="/triage" args="my-issue"
 *
 * Resolution order for the colon case:
 *   1. Exact MCP match — prefix matches a known MCP `origin`, suffix matches
 *      a tool from that server.
 *   2. Broad match — suffix matches exactly ONE remote command name (skill,
 *      server, or MCP). If multiple commands share the name the match is
 *      ambiguous: `onAmbiguous` is invoked (if provided) and `null` is
 *      returned so the caller can forward as-is or surface an error.
 *
 * The space case is MCP-only (prefix must be a known origin) because a bare
 * word like `/cost` with trailing args is ambiguous.
 *
 * Returns `null` when no match is found or the match is ambiguous; the caller
 * should forward as-is.
 *
 * @param typedCommand  The first token incl. leading slash (e.g. "/jcodemunch:triage").
 * @param args          Everything after the first token (e.g. "my-issue").
 * @param remoteCommands  The cached server/MCP/skill command list.
 * @param onAmbiguous   Optional callback invoked when a suffix matches multiple
 *                      commands from different sources. Lets the caller log
 *                      without coupling this pure function to I/O.
 */
export function resolveMcpNamespace(
  typedCommand: string,
  args: string,
  remoteCommands: ReadonlyArray<RemoteCommandInfo>,
  onAmbiguous?: (info: AmbiguityInfo) => void,
): ResolvedNamespace | null {
  const cleaned = typedCommand.replace(/^\//, "")

  // ── Colon-separated: /prefix:command [args] ──
  // Local commands with colons (e.g. /diagnose:generation) are resolved before
  // this function is called, so we only reach here for non-local commands.
  const colonIdx = cleaned.indexOf(":")
  if (colonIdx > 0) {
    const prefix = cleaned.slice(0, colonIdx).toLowerCase()
    const suffix = cleaned.slice(colonIdx + 1).toLowerCase()
    if (!suffix) return null

    // 1. Exact MCP match: prefix is the origin, suffix is the tool name
    const exactMcp = remoteCommands.find(
      (c) => c.source === "mcp" && c.origin?.toLowerCase() === prefix && c.name.toLowerCase() === suffix,
    )
    if (exactMcp) return { command: `/${exactMcp.name}`, arguments: args }

    // 2. Broad match: suffix matches any remote command (skill/server/MCP).
    //    The prefix was a namespace the server doesn't use. Only resolve when
    //    the suffix is unambiguous — if multiple commands share the name we
    //    cannot safely pick one.
    const candidates = remoteCommands.filter((c) => c.name.toLowerCase() === suffix)
    if (candidates.length === 1) {
      return { command: `/${candidates[0]!.name}`, arguments: args }
    }
    if (candidates.length > 1 && onAmbiguous) {
      onAmbiguous({ prefix, suffix, candidates })
    }

    return null
  }

  // ── Space-separated: /server tool [extra-args] ──
  const serverName = cleaned.toLowerCase()
  if (!serverName) return null

  const argParts = args.trim().split(/\s+/).filter(Boolean)
  if (argParts.length === 0) return null

  const toolName = argParts[0]!.toLowerCase()
  const remainingArgs = argParts.slice(1).join(" ")

  const match = remoteCommands.find(
    (c) => c.source === "mcp" && c.origin?.toLowerCase() === serverName && c.name.toLowerCase() === toolName,
  )

  if (!match) return null
  return { command: `/${match.name}`, arguments: remainingArgs }
}

/**
 * Resolve an `@namespace /command` hierarchical invocation to its canonical
 * flat form. The opencode server registers MCP tools as top-level commands
 * (e.g. `/triage`), but users may type `@jcodemunch /triage` to explicitly
 * scope the command to a specific server.
 *
 * Unlike {@link resolveMcpNamespace}, this resolver is **strict**: the
 * namespace must match a known MCP `origin` AND the command must belong to
 * that origin. There is no broad-match fallback — the user explicitly
 * namespaced the invocation, so silently picking a different source would
 * violate their intent.
 *
 *   `@jcodemunch /triage my-issue` → command="/triage" args="my-issue"
 *   `@wrongns /triage`              → null (no match, forward as-is)
 *
 * @param namespace  The MCP server name (without `@`).
 * @param command    The command name (with or without leading `/`).
 * @param args       Everything after the command token.
 * @param remoteCommands  The cached server/MCP/skill command list.
 * @returns `null` when no exact match is found; the caller should forward as-is.
 */
export function resolveNamespacedCommand(
  namespace: string,
  command: string,
  args: string,
  remoteCommands: ReadonlyArray<RemoteCommandInfo>,
): ResolvedNamespace | null {
  const ns = namespace.toLowerCase()
  const cmd = command.replace(/^\//, "").toLowerCase()
  if (!ns || !cmd) return null

  const match = remoteCommands.find(
    (c) => c.origin?.toLowerCase() === ns && c.name.toLowerCase() === cmd,
  )
  if (!match) return null
  return { command: `/${match.name}`, arguments: args }
}
