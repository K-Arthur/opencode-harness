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

import {
  COMMAND_SVG,
  BRAIN_SVG,
  MCP_SVG,
  PLUS_SVG,
  SHARE_SVG,
  REFRESH_SVG,
  PLAY_SVG,
  HISTORY_SVG,
  CODE_SVG,
  BUG_SVG,
} from "./icons"
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
  /** Inline icon (SVG string) shown in the mention dropdown. */
  icon?: string
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
  { name: "clear",       description: "Clear conversation, start a new server session", insertText: "/clear",       icon: COMMAND_SVG, category: "session" },
  { name: "model",       description: "Switch the active model",                         insertText: "/model ",      icon: BRAIN_SVG,   category: "session", usage: "<id>" },
  { name: "cost",        description: "Show session cost (server figures when available)", insertText: "/cost",     icon: MCP_SVG,     category: "session" },
  { name: "new",         description: "Open a new session tab",                          insertText: "/new",         icon: PLUS_SVG,    category: "session" },
  { name: "continue",    description: "Resume the most recently closed session",         insertText: "/continue",    icon: PLAY_SVG,    category: "session" },
  { name: "compact",     description: "Compact session context to free tokens",          insertText: "/compact",     icon: REFRESH_SVG, category: "session" },
  { name: "stash",       description: "Stash current prompt for reuse",                  insertText: "/stash ",      icon: SHARE_SVG,   category: "prompt", usage: "<name> <content>" },
  { name: "stashes",     description: "Browse stashed prompts",                          insertText: "/stashes",     icon: SHARE_SVG,   category: "prompt" },
  { name: "queue",       description: "Show queued prompts",                             insertText: "/queue",       icon: MCP_SVG,     category: "prompt" },
  { name: "commands",    description: "Open the command palette",                        insertText: "/commands",    icon: HISTORY_SVG, category: "conversation" },
  { name: "export",      description: "Export conversation as Markdown",                 insertText: "/export",      icon: SHARE_SVG,   category: "export", aliases: ["export-md"] },
  { name: "export-json", description: "Export conversation as JSON",                     insertText: "/export-json", icon: SHARE_SVG,   category: "export" },
  { name: "export-text", description: "Export conversation as plain text",               insertText: "/export-text", icon: SHARE_SVG,   category: "export" },
  { name: "copy",        description: "Copy conversation to clipboard",                  insertText: "/copy",        icon: SHARE_SVG,   category: "export" },
  { name: "diagnose:generation", description: "Dump generation-tracking state to the output channel", insertText: "/diagnose:generation", icon: BUG_SVG, category: "debug" },
  { name: "help",        description: "Show available slash commands",                   insertText: "/help",        icon: CODE_SVG,    category: "conversation" },
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
 */
export function toMentionItems(): MentionItem[] {
  return LOCAL_SLASH_COMMANDS.map((cmd) => ({
    prefix: "/",
    display: cmd.name,
    description: cmd.description,
    icon: cmd.icon,
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
