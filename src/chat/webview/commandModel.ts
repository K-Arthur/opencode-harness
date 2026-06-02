/**
 * Command/Task model — pure read-model over a session's `ChatMessage[]`.
 *
 * The Commands/Tasks panel (`tasks-panel.ts`) surfaces every shell command the
 * agent ran (the `exec`-class tool calls) as inspectable task cards with
 * metadata (command text, cwd, status, exit code, duration) and output. Like
 * `activityModel.ts`, this module owns the *derivation* and is pure (no DOM, no
 * I/O), tolerant of legacy/canonical block shapes.
 */
import type { ChatMessage, Block } from "./types"

export type CommandStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown"

export interface CommandTask {
  id: string
  command: string
  cwd?: string
  status: CommandStatus
  exitCode?: number
  durationMs?: number
  output?: string
  anchorMessageId?: string
  timestamp: number
}

const TOOL_TYPES = new Set(["tool-call", "tool_call", "tool"])

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function readArg(block: Block, keys: readonly string[]): string {
  const args = (block.args ?? block) as Record<string, unknown>
  if (args && typeof args === "object") {
    for (const k of keys) {
      const v = args[k]
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  for (const k of keys) {
    const v = (block as Record<string, unknown>)[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return ""
}

/** True when a tool block represents a shell command (explicit class or name). */
export function isExecBlock(block: Block): boolean {
  if (!TOOL_TYPES.has(str(block.type))) return false
  if (block.class === "exec") return true
  if (typeof block.class === "string" && block.class) return false // a different explicit class
  const name = str(block.tool) || str(block.name) || str(block.toolName)
  return /(bash|shell|^run$|exec|command|terminal|zsh|sh)/i.test(name)
}

function execStatus(block: Block, exitCode: number | undefined): CommandStatus {
  switch (block.state) {
    case "pending":
      return "pending"
    case "running":
      return "running"
    case "result":
    case "completed":
      return typeof exitCode === "number" && exitCode !== 0 ? "failed" : "succeeded"
    case "error":
      return "failed"
    case "stale":
    case "unresolved":
      return "unknown"
    default:
      if (block.error) return "failed"
      return typeof exitCode === "number" ? (exitCode === 0 ? "succeeded" : "failed") : "unknown"
  }
}

function readExitCode(block: Block): number | undefined {
  const direct = (block as Record<string, unknown>).exitCode
  if (typeof direct === "number") return direct
  // Best-effort: many shells surface "exit code: N" in the result text.
  const result = str(block.result)
  const m = result.match(/exit(?:\s*code)?[:\s]+(-?\d+)/i)
  if (m && m[1] !== undefined) return Number(m[1])
  return undefined
}

/** Derive the ordered list of command tasks for a session. Pure. */
export function buildCommandTasks(messages: ChatMessage[]): CommandTask[] {
  const tasks: CommandTask[] = []
  messages.forEach((msg, mi) => {
    const blocks = Array.isArray(msg.blocks) ? msg.blocks : []
    const ts = (typeof msg.timestamp === "number" ? msg.timestamp : 0) + mi * 1e-3
    blocks.forEach((block, bi) => {
      if (!isExecBlock(block)) return
      const command = readArg(block, ["command", "cmd", "text", "script"]) || str(block.name) || "command"
      const cwd = readArg(block, ["cwd", "workdir", "directory", "cd"]) || undefined
      const exitCode = readExitCode(block)
      const status = execStatus(block, exitCode)
      const durationMs = typeof block.durationMs === "number" ? block.durationMs : undefined
      const output = str(block.result) || undefined
      tasks.push({
        id: str(block.id) || `${msg.id || `m${mi}`}:${bi}`,
        command,
        cwd,
        status,
        exitCode,
        durationMs,
        output,
        anchorMessageId: msg.id,
        timestamp: ts,
      })
    })
  })
  return tasks
}

export type CommandFilter = "all" | "running" | "failed" | "succeeded"

export function filterCommandTasks(tasks: readonly CommandTask[], filter: CommandFilter): CommandTask[] {
  if (filter === "all") return tasks.slice()
  return tasks.filter((t) => t.status === filter)
}

/** Human-readable duration, e.g. "1.2s" / "340ms" / "2m 3s". */
export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s - m * 60)}s`
}
