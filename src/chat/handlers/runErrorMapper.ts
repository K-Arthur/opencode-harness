import type { ErrorKind, ErrorSource, Recoverability } from "./runActivityTypes"

const NETWORK = "network"
const GENERATION = "generation"
const MODEL = "model"
const SYSTEM = "system"
const LOW = "low"
const MEDIUM = "medium"
const HIGH = "high"

type ErrorCategoryValue = typeof NETWORK | typeof GENERATION | typeof MODEL | typeof SYSTEM
type ErrorSeverityValue = typeof LOW | typeof MEDIUM | typeof HIGH
type RunErrorActionType = "retry" | "view_details" | "dismiss" | "switch_model"

interface RunErrorAction {
  label: string
  action: RunErrorActionType
  primary?: boolean
}

export interface RunErrorContext {
  category: ErrorCategoryValue
  severity: ErrorSeverityValue
  code: string
  title: string
  kind: ErrorKind
  source: ErrorSource
  recoverability: Recoverability
  message: string
  userMessage: string
  likelyCause: string
  mayStillBeRunning?: boolean
  partialOutputPreserved?: boolean
  technicalDetails?: string
  suggestedActions: RunErrorAction[]
  retryable: boolean
  timestamp: number
  sessionId?: string
  messageId?: string
  runId?: string
  taskId?: string
  correlationId: string
}

export interface RunErrorInput {
  kind: ErrorKind
  source: ErrorSource
  recoverability: Recoverability
  sessionId?: string
  messageId?: string
  runId?: string
  taskId?: string
  technicalDetails?: string
  timestamp?: number
  mayStillBeRunning?: boolean
  partialOutputPreserved?: boolean
}

type ErrorTemplate = readonly [
  ErrorCategoryValue,
  ErrorSeverityValue,
  string,
  string,
  string,
  boolean,
]

const TEMPLATES: Record<ErrorKind, ErrorTemplate> = {
  model_startup_timeout: [MODEL, MEDIUM, "Model did not start", "No model, tool, or subagent activity arrived.", "Provider may be slow or blocked.", true],
  provider_timeout: [MODEL, MEDIUM, "Provider timed out", "Provider timed out while OpenCode waited.", "Provider did not finish.", true],
  transport_disconnected: [NETWORK, MEDIUM, "Stream disconnected", "OpenCode stream disconnected. Partial output kept.", "SSE transport dropped.", true],
  sse_parse_error: [NETWORK, MEDIUM, "Stream parse failed", "A stream event could not be parsed.", "Unexpected event shape.", true],
  server_unreachable: [NETWORK, HIGH, "Server unreachable", "Could not reach OpenCode server.", "Local server stopped.", true],
  server_error: [SYSTEM, HIGH, "Server error", "OpenCode reported an error.", "Server or SDK error event.", true],
  tool_failed: [GENERATION, MEDIUM, "Tool failed", "A tool failed; the agent may continue.", "Command, file, or MCP tool errored.", true],
  tool_unresolved: [GENERATION, MEDIUM, "Tool unresolved", "Tool did not complete before server idle.", "Completion event may be missing.", true],
  subagent_failed: [GENERATION, MEDIUM, "Subagent failed", "A subagent failed; parent output may still help.", "Child session failed or aborted.", true],
  subagent_unresolved: [GENERATION, MEDIUM, "Subagent unresolved", "Subagent was active when OpenCode went idle.", "Child session was not finalized.", true],
  user_cancelled: [SYSTEM, LOW, "Run cancelled", "You cancelled the active OpenCode run.", "The cancel action aborted the parent session.", false],
  webview_bridge_error: [SYSTEM, MEDIUM, "Webview message failed", "Could not deliver webview message.", "Webview unavailable.", true],
  session_reload_interruption: [SYSTEM, MEDIUM, "Session reloaded", "Webview or extension host reloaded during the run.", "VS Code reloaded before completion.", true],
  unknown: [SYSTEM, HIGH, "Unknown run error", "Unclassified streaming error.", "Could not classify error.", true],
}

export function mapRunError(input: RunErrorInput): RunErrorContext {
  const [category, severity, title, userMessage, likelyCause, templateRetryable] = TEMPLATES[input.kind]
  const retryable = templateRetryable && input.recoverability !== "non_retryable"
  const timestamp = input.timestamp ?? Date.now()
  const actions: RunErrorAction[] = []
  if (retryable) actions.push({ label: input.recoverability === "refresh_from_server" ? "Refresh from server" : "Retry", action: "retry", primary: true })
  if (input.kind === "model_startup_timeout" || input.kind === "provider_timeout") actions.push({ label: "Switch model", action: "switch_model" })
  actions.push({ label: "Details", action: "view_details" })
  actions.push({ label: "Dismiss", action: "dismiss" })

  return {
    category,
    severity,
    code: input.kind.toUpperCase(),
    title,
    kind: input.kind,
    source: input.source,
    recoverability: input.recoverability,
    message: userMessage,
    userMessage,
    likelyCause,
    mayStillBeRunning: input.mayStillBeRunning,
    partialOutputPreserved: input.partialOutputPreserved,
    technicalDetails: input.technicalDetails,
    suggestedActions: actions,
    retryable,
    timestamp,
    sessionId: input.sessionId,
    messageId: input.messageId,
    runId: input.runId,
    taskId: input.taskId,
    correlationId: `${input.kind}-${timestamp.toString(36)}`,
  }
}
