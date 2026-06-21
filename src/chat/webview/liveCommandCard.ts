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
  // The streaming layer locates tool DOM by [data-block-id]; without this the
  // card is never found and live updates (command text, status, output) never
  // land — leaving it stuck on the initial running/name-fallback render.
  card.dataset.blockId = toolBlock.id
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

const STATUS_ICON: Record<LiveCommandCardStatus, string> = {
  running: "▶",
  succeeded: "✓",
  failed: "✗",
  cancelled: "◆",
  unknown: "◆",
}

const STATUS_CLASSES = [
  "live-command-card--running",
  "live-command-card--succeeded",
  "live-command-card--failed",
  "live-command-card--cancelled",
  "live-command-card--unknown",
]

/** Map a raw tool state + exit code to a card status (string-input variant of
 *  {@link liveCommandStatus}, for the incremental update path which only has a
 *  state string rather than a full ToolCallBlock). */
function statusFromState(state: string | undefined, exitCode: number | undefined): LiveCommandCardStatus {
  if (state === "cancelled") return "cancelled"
  if (state === "error" || state === "stale" || state === "unresolved") return "failed"
  if (state === "result" || state === "completed") {
    return typeof exitCode === "number" && exitCode !== 0 ? "failed" : "succeeded"
  }
  return "running"
}

function commandFromArgs(args: unknown): string | null {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>
    for (const key of ["command", "cmd", "text", "script"] as const) {
      const v = a[key]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
  }
  return null
}

export interface LiveCommandCardUpdate {
  state?: string
  args?: unknown
  stdout?: string
  stderr?: string
  result?: string
  error?: string
  durationMs?: number
  exitCode?: number
}

/**
 * Apply an incremental update to an already-rendered live command card in
 * place, mirroring the generic tool-card update path but targeting the card's
 * own `.live-command-card__*` structure. Without this the streaming layer's
 * generic selectors (`.tool-status`, `.tool-result-panel`) miss entirely and
 * the card stays stuck on its first render (the "always RUNNING / shows bash"
 * symptom).
 */
export function applyLiveCommandCardUpdate(card: HTMLElement, update: LiveCommandCardUpdate): void {
  // Command text — fill in once real args arrive (first render falls back to
  // the tool name, e.g. "bash", before the command is known).
  if (update.args !== undefined) {
    const command = commandFromArgs(update.args)
    if (command) {
      const commandEl = card.querySelector(".live-command-card__command")
      if (commandEl) commandEl.textContent = command
      card.setAttribute("aria-label", `Command: ${command}`)
    }
  }

  // Live output (stdout/stderr while running, or the final result text).
  if (update.stdout !== undefined || update.stderr !== undefined || update.result !== undefined) {
    const output = card.querySelector(".live-command-card__output")
    if (output) {
      const streamed = (update.stdout ?? "") + (update.stderr ?? "")
      const combined = streamed || (update.result ?? "")
      if (isToolOutputRenderAnsiEnabled()) output.innerHTML = renderAnsiToHtml(combined)
      else output.textContent = stripAnsi(combined)
    }
  }

  // Status / icon / card colour class.
  if (update.state !== undefined || update.exitCode !== undefined || update.error !== undefined) {
    const stateForStatus = update.state ?? (update.error !== undefined ? "error" : undefined)
    const status = statusFromState(stateForStatus, update.exitCode)
    card.classList.remove(...STATUS_CLASSES)
    card.classList.add(`live-command-card--${status}`)
    const icon = card.querySelector(".live-command-card__icon")
    if (icon) icon.textContent = STATUS_ICON[status]
    const statusEl = card.querySelector(".live-command-card__status")
    if (statusEl) {
      statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1)
      statusEl.className = `live-command-card__status live-command-card__status--${status}`
    }
  }

  // Footer: duration + exit code (create the spans on demand).
  const footer = card.querySelector(".live-command-card__footer")
  if (footer) {
    if (update.durationMs !== undefined) {
      const text = formatDuration(update.durationMs)
      if (text) {
        let durEl = footer.querySelector(".live-command-card__duration")
        if (!durEl) {
          durEl = createElement("span", "live-command-card__duration")
          footer.prepend(durEl)
        }
        durEl.textContent = text
      }
    }
    if (typeof update.exitCode === "number") {
      let exitEl = footer.querySelector(".live-command-card__exit-code")
      if (!exitEl) {
        exitEl = createElement("span", "live-command-card__exit-code")
        footer.appendChild(exitEl)
      }
      exitEl.textContent = `exit ${update.exitCode}`
    }
  }
}
