/**
 * Typed webview ↔ extension-host message contract for the theme customizer.
 *
 * These helpers ensure the webview sends correctly-typed messages to the host
 * and that incoming host messages are narrowed to the expected payload shape.
 * They are the single source of truth for the message `type` strings — keep
 * them in sync with `ThemeController.ts` on the host side.
 */

import type { ThemeConfig, ThemePreset } from "./themeState"

// ── Webview → Host messages ────────────────────────────────────────────────

export interface GetThemeConfigMsg {
  type: "get_theme_config"
}

export interface UpdateThemeConfigMsg {
  type: "update_theme_config"
  theme: ThemeConfig
}

export interface ListCliThemesMsg {
  type: "list_cli_themes"
}

export interface UpdateSwitchWorkbenchThemeMsg {
  type: "update_switch_workbench_theme"
  enabled: boolean
}

export type WebviewToHostMsg =
  | GetThemeConfigMsg
  | UpdateThemeConfigMsg
  | ListCliThemesMsg
  | UpdateSwitchWorkbenchThemeMsg

// ── Host → Webview messages ────────────────────────────────────────────────

export interface ThemeVarsMsg {
  type: "theme_vars"
  vars: Record<string, string>
}

export interface ThemeConfigMsg {
  type: "theme_config"
  theme: Partial<ThemeConfig>
}

export interface ThemeConfigErrorMsg {
  type: "theme_config_error"
  error: string
}

export interface CliThemesListMsg {
  type: "cli_themes_list"
  themes: Array<{ name: string; source: string }>
}

export type HostToWebviewMsg =
  | ThemeVarsMsg
  | ThemeConfigMsg
  | ThemeConfigErrorMsg
  | CliThemesListMsg

// ── Message factory helpers ────────────────────────────────────────────────

/**
 * Create a `get_theme_config` message to request the current saved config.
 */
export function createGetThemeConfigMsg(): GetThemeConfigMsg {
  return { type: "get_theme_config" }
}

/**
 * Create an `update_theme_config` message to save changes.
 * @param preset - The preset to save.
 * @param overrides - The color overrides to save.
 */
export function createUpdateThemeConfigMsg(
  preset: ThemePreset,
  overrides: Record<string, string>,
): UpdateThemeConfigMsg {
  return { type: "update_theme_config", theme: { preset, overrides } }
}

/**
 * Create a `list_cli_themes` message to request available CLI themes.
 */
export function createListCliThemesMsg(): ListCliThemesMsg {
  return { type: "list_cli_themes" }
}

/**
 * Create an `update_switch_workbench_theme` message to toggle the
 * `opencode.theme.switchWorkbenchTheme` setting.
 * @param enabled - Whether the VS Code workbench theme should also switch.
 */
export function createUpdateSwitchWorkbenchThemeMsg(enabled: boolean): UpdateSwitchWorkbenchThemeMsg {
  return { type: "update_switch_workbench_theme", enabled }
}

// ── Incoming message type guards ───────────────────────────────────────────

/**
 * Type guard: is this a host message the theme customizer should handle?
 * @param msg - The raw message from the host.
 * @returns `true` if the message is a recognized theme message type.
 */
export function isThemeMessage(msg: unknown): msg is HostToWebviewMsg {
  if (!msg || typeof msg !== "object") return false
  const type = (msg as Record<string, unknown>).type
  return (
    type === "theme_vars" ||
    type === "theme_config" ||
    type === "theme_config_error" ||
    type === "cli_themes_list"
  )
}

/**
 * Narrow a raw message to a `ThemeConfigMsg`, or return `null` if the shape
 * doesn't match.
 * @param msg - The raw message from the host.
 */
export function asThemeConfigMsg(msg: Record<string, unknown>): ThemeConfigMsg | null {
  if (msg.type !== "theme_config") return null
  const theme = msg.theme as Partial<ThemeConfig> | undefined
  if (!theme || typeof theme !== "object") return null
  return { type: "theme_config", theme }
}

/**
 * Narrow a raw message to a `CliThemesListMsg`, or return `null`.
 * @param msg - The raw message from the host.
 */
export function asCliThemesListMsg(msg: Record<string, unknown>): CliThemesListMsg | null {
  if (msg.type !== "cli_themes_list") return null
  const themes = msg.themes
  if (!Array.isArray(themes)) return null
  return { type: "cli_themes_list", themes: themes as Array<{ name: string; source: string }> }
}

/**
 * Narrow a raw message to a `ThemeConfigErrorMsg`, or return `null`.
 * @param msg - The raw message from the host.
 */
export function asThemeConfigErrorMsg(msg: Record<string, unknown>): ThemeConfigErrorMsg | null {
  if (msg.type !== "theme_config_error") return null
  const error = typeof msg.error === "string" ? msg.error : "Unknown error"
  return { type: "theme_config_error", error }
}
