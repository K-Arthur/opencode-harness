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
} from "./icons"
import type { MentionItem } from "./types"

export interface LocalSlashCommand {
  /** Name without the leading slash. */
  name: string
  /** End-user description; shown in both surfaces. */
  description: string
  /** Text inserted into the prompt input. Trailing space means "expects args". */
  insertText: string
  /** Inline icon (SVG string) shown in the mention dropdown. */
  icon?: string
}

/**
 * Authoritative list. Order is the user-facing presentation order in the
 * commands modal (mention dropdown filters/orders by query separately).
 */
export const LOCAL_SLASH_COMMANDS: ReadonlyArray<LocalSlashCommand> = Object.freeze([
  { name: "clear",       description: "Clear conversation, start a new server session", insertText: "/clear",       icon: COMMAND_SVG },
  { name: "model",       description: "Switch the active model (use /model <id>)",      insertText: "/model ",      icon: BRAIN_SVG },
  { name: "cost",        description: "Show session cost (server figures when available)", insertText: "/cost",     icon: MCP_SVG },
  { name: "new",         description: "Open a new session tab",                          insertText: "/new",         icon: PLUS_SVG },
  { name: "continue",    description: "Resume the most recently closed session",         insertText: "/continue",    icon: PLAY_SVG },
  { name: "compact",     description: "Compact session context to free tokens",          insertText: "/compact",     icon: REFRESH_SVG },
  { name: "stash",       description: "Stash current prompt — /stash <name> <content>",  insertText: "/stash ",      icon: SHARE_SVG },
  { name: "stashes",     description: "Browse stashed prompts",                          insertText: "/stashes",     icon: SHARE_SVG },
  { name: "queue",       description: "Show queued prompts",                             insertText: "/queue",       icon: MCP_SVG },
  { name: "commands",    description: "Open the command palette",                        insertText: "/commands",    icon: HISTORY_SVG },
  { name: "export",      description: "Export conversation (Markdown)",                  insertText: "/export",      icon: SHARE_SVG },
  { name: "export-md",   description: "Export conversation as Markdown",                 insertText: "/export-md",   icon: SHARE_SVG },
  { name: "export-json", description: "Export conversation as JSON",                     insertText: "/export-json", icon: SHARE_SVG },
  { name: "export-text", description: "Export conversation as plain text",               insertText: "/export-text", icon: SHARE_SVG },
  { name: "copy",        description: "Copy conversation to clipboard",                  insertText: "/copy",        icon: SHARE_SVG },
  { name: "help",        description: "Show available slash commands",                   insertText: "/help",        icon: CODE_SVG },
])

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
 * Filter server-reported commands so they don't duplicate local entries.
 * Match is case-insensitive — the opencode server has been seen to
 * normalise some command names to uppercase in different builds, and we
 * never want a doubled `/clear` / `/CLEAR` row in the palette.
 */
export function dedupServerCommands<T extends { name: string }>(server: ReadonlyArray<T>): T[] {
  const localNames = new Set(LOCAL_SLASH_COMMANDS.map((c) => c.name.toLowerCase()))
  return server.filter((c) => !localNames.has(c.name.toLowerCase()))
}
