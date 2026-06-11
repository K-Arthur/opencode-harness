/**
 * Centralized tooltips for the extension-side status bar items.
 *
 * Kept separate from `src/chat/webview/tooltips.ts` because that module
 * is browser-only (bundled as IIFE for the webview). This module is
 * bundled as CJS for Node and consumed by `src/extension.ts`.
 *
 * Style guide (matches webview tooltips):
 *   - Lead with the current state.
 *   - Include the action that will happen on click.
 *   - Mention the consequence (what changes, where to look).
 *   - Two to four short sentences; use `\n` for line breaks in
 *     status bar tooltips (they render as multi-line on hover).
 */

export const STATUS_BAR_TOOLTIPS = {
  connection: {
    notConnected:
      "OpenCode server is not running.\nClick to start the server and open the chat.",
    connected: (port: number) =>
      `OpenCode server running on port ${port}.\nClick to open the chat panel.`,
    disconnected:
      "OpenCode server is not running.\nClick to retry the connection.",
    error:
      "OpenCode server encountered an error.\nClick to open the chat; check the OpenCode output channel for details.",
  },
  methodology: {
    idle: "OpenCode Methodology — click to configure.\nSet the methodology OpenCode uses to plan, execute, and review work.",
    active: (label: string, tier: string, confidencePct: string, detail: string) =>
      `Methodology: ${label}\nTier: ${tier}\nConfidence: ${confidencePct}%\n\n${detail}\n\nDisable per tab with /methodology off · Click to configure`,
  },
} as const
