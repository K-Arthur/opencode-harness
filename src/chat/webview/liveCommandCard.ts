/**
 * Live command card renderer (agent-visibility UX).
 *
 * Exec-class tool calls are rendered as standalone terminal-like cards in the
 * chat stream. The card is intentionally simple and static on first render;
 * live stdout/stderr updates are applied by the streaming layer replacing the
 * output element's content on each `stream_tool_partial` event.
 */
import type { ToolCallBlock } from "./types"
import { renderAnsiToHtml, stripAnsi, isToolOutputRenderAnsiEnabled } from "./ansiUtils"

export interface LiveCommandCardOptions {
  messageId?: string
  sessionId?: string
  postMessage?: (msg: Record<string, unknown>) => void
}

export type LiveCommandCardStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown"

/**
 * Derive a card status from a tool block's state and exit code.
 */
export function liveCommandStatus(toolBlock: ToolCallBlock): LiveCommandCardStatus {
  const state = toolBlock.state || "running"
  if (state === "cancelled") return "cancelled"
  if (state === "error" || state === "stale" || state === "unresolved") return "failed"
  if (state === "result" || state === "completed") {
    return typeof toolBlock.exitCode === "number" && toolBlock.exitCode !== 0 ? "failed" : "succeeded"
  }
  return "running"
}

/**
 * Extract the command text from a tool block's args.
 */
export function readCommandText(toolBlock: ToolCallBlock): string {
  const args = toolBlock.args
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>
    if (typeof a.command === "string" && a.command.trim()) return a.command.trim()
    if (typeof a.cmd === "string" && a.cmd.trim()) return a.cmd.trim()
    if (typeof a.text === "string" && a.text.trim()) return a.text.trim()
    if (typeof a.script === "string" && a.script.trim()) return a.script.trim()
  }
  if (typeof toolBlock.name === "string" && toolBlock.name.trim()) return toolBlock.name.trim()
  return "command"
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || ms < 0) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function createElement(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag)
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

/**
 * Render a standalone terminal-like card for an exec/shell tool call.
 */
export function renderLiveCommandCard(toolBlock: ToolCallBlock, opts?: LiveCommandCardOptions): HTMLElement {
  const status = liveCommandStatus(toolBlock)
  const command = readCommandText(toolBlock)
  const card = document.createElement("div")
  card.className = `live-command-card live-command-card--${status}`
  card.dataset.toolId = toolBlock.id
  if (opts?.messageId) card.dataset.messageId = opts.messageId
  card.setAttribute("role", "region")
  card.setAttribute("aria-label", `Command: ${command}`)

  const header = document.createElement("div")
  header.className = "live-command-card__header"

  const icon = createElement("span", "live-command-card__icon", status === "running" ? "▶" : status === "succeeded" ? "✓" : status === "failed" ? "✗" : "◆")
  icon.setAttribute("aria-hidden", "true")
  header.appendChild(icon)

  const title = createElement("span", "live-command-card__title", "Command")
  header.appendChild(title)

  const commandEl = createElement("code", "live-command-card__command", command)
  header.appendChild(commandEl)

  if (toolBlock.workingDir) {
    const cwd = createElement("span", "live-command-card__cwd", toolBlock.workingDir)
    cwd.title = `Working directory: ${toolBlock.workingDir}`
    header.appendChild(cwd)
  }

  const statusEl = createElement("span", "live-command-card__status", status.charAt(0).toUpperCase() + status.slice(1))
  statusEl.classList.add(`live-command-card__status--${status}`)
  header.appendChild(statusEl)

  card.appendChild(header)

  const output = document.createElement("pre")
  output.className = "live-command-card__output"
  const stdout = toolBlock.partialStdout ?? ""
  const stderr = toolBlock.partialStderr ?? ""
  const combined = stdout + (stderr ? stderr : "")
  if (isToolOutputRenderAnsiEnabled()) {
    output.innerHTML = renderAnsiToHtml(combined)
  } else {
    output.textContent = stripAnsi(combined)
  }
  card.appendChild(output)

  const footer = document.createElement("div")
  footer.className = "live-command-card__footer"

  const duration = formatDuration(toolBlock.durationMs)
  if (duration) {
    footer.appendChild(createElement("span", "live-command-card__duration", duration))
  }
  if (typeof toolBlock.exitCode === "number") {
    footer.appendChild(createElement("span", "live-command-card__exit-code", `exit ${toolBlock.exitCode}`))
  }
  card.appendChild(footer)

  return card
}
