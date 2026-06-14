export function toUserErrorMessage(message: string): string {
  const commandFailedJson = message.match(/Command failed:\s*(\{.*\})/s)
  if (commandFailedJson?.[1]) {
    try {
      const parsed = JSON.parse(commandFailedJson[1]) as { data?: { message?: string }; message?: string }
      const nested = parsed.data?.message || parsed.message
      if (nested) return toUserErrorMessage(nested)
    } catch {
      // Fall through to pattern matching below.
    }
  }
  const commandError = message.match(/Command not found:\s*"\/?([^"]+)"/i)
  if (commandError?.[1]) {
    return `Slash command "/${commandError[1]}" is not available in this session. Type /help for local commands or /commands for server commands.`
  }
  if (/server not running/i.test(message)) return "OpenCode is not connected. Try again after the server starts."
  if (/not installed|not found/i.test(message)) return message
  if (/timeout|did not start/i.test(message)) return "OpenCode took too long to respond. Check the output logs and try again."
  return message || "The request failed. Check the OpenCode output logs for details."
}

export function errorValueToMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const data = value as { message?: unknown; name?: unknown; data?: { message?: unknown } }
    if (typeof data.data?.message === "string") return data.data.message
    if (typeof data.message === "string") return data.message
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value || "Server error")
}

/** The error-union discriminators emitted by @opencode-ai/sdk (types.gen.d.ts). */
const SDK_ERROR_NAMES = new Set([
  "ProviderAuthError",
  "MessageOutputLengthError",
  "MessageAbortedError",
  "APIError",
  "UnknownError",
])

/**
 * True when `value` is a structured opencode SDK error worth routing through
 * `mapOpencodeError` (rich category/severity/actions). Plain strings and generic
 * objects (e.g. SSE connection-failure messages) return false so the legacy
 * string-cleanup path (`errorValueToMessage` + `toUserErrorMessage`) still applies.
 */
export function looksLikeSdkError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const e = value as { name?: unknown; data?: { statusCode?: unknown } }
  if (typeof e.name === "string" && SDK_ERROR_NAMES.has(e.name)) return true
  return typeof e.data?.statusCode === "number"
}

/** Matches the abort/cancel wording used by `mapOpencodeError`'s MESSAGE_ABORTED branch. */
const ABORT_MESSAGE_RE = /abort(ed)?|cancell?ed/i

/**
 * True when `value` represents a cancelled/aborted run — either the structured
 * `MessageAbortedError` SDK error or any error string/object whose message reads
 * as an abort/cancel. Used to suppress the expected `MessageAbortedError` the
 * server emits a beat after an intentional `abort()` (Stop / interrupt-and-send),
 * which would otherwise surface as a spurious "The request was cancelled." card.
 */
export function isAbortErrorValue(value: unknown): boolean {
  if (typeof value === "string") return ABORT_MESSAGE_RE.test(value)
  if (!value || typeof value !== "object") return false
  const e = value as { name?: unknown; message?: unknown; data?: { message?: unknown } }
  if (e.name === "MessageAbortedError") return true
  const message = typeof e.message === "string"
    ? e.message
    : typeof e.data?.message === "string"
      ? e.data.message
      : ""
  return ABORT_MESSAGE_RE.test(message)
}

export function mapToolType(tool: string): string {
  if (!tool) return "read"
  const t = tool.toLowerCase()
  if (t.includes("edit") || t.includes("write") || t.includes("create") || t.includes("apply")) return "write"
  if (t.includes("bash") || t.includes("exec") || t.includes("run") || t.includes("command")) return "exec"
  return "read"
}

export function isSessionInCurrentWorkspace(
  sessionWorkspacePath: string | undefined,
  currentWorkspace: string | undefined,
): boolean {
  return !currentWorkspace || !sessionWorkspacePath || sessionWorkspacePath === currentWorkspace
}