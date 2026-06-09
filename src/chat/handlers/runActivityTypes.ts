export type AgentRunPhase =
  | "waiting_for_activity"
  | "running"
  | "waiting_on_tool"
  | "waiting_on_subagent"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type ToolExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "unresolved"

export type SubagentRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export type ErrorKind =
  | "model_startup_timeout"
  | "provider_timeout"
  | "transport_disconnected"
  | "sse_parse_error"
  | "server_unreachable"
  | "server_error"
  | "tool_failed"
  | "tool_unresolved"
  | "subagent_failed"
  | "subagent_unresolved"
  | "user_cancelled"
  | "webview_bridge_error"
  | "session_reload_interruption"
  | "unknown"

export type ErrorSource =
  | "model_provider"
  | "opencode_server"
  | "extension_host"
  | "event_stream"
  | "webview_bridge"
  | "tool"
  | "subagent"
  | "user"
  | "unknown"

export type Recoverability =
  | "retryable"
  | "refresh_from_server"
  | "continue_from_partial"
  | "non_retryable"
  | "unknown"

export interface RunErrorState {
  kind: ErrorKind
  source: ErrorSource
  recoverability: Recoverability
  message: string
  technicalDetails?: string
  at: number
}

export interface ToolExecutionState {
  id: string
  name: string
  status: ToolExecutionStatus
  startedAt?: number
  updatedAt: number
  completedAt?: number
  input?: unknown
  result?: string
  error?: string
}

export interface SubagentRunState {
  id: string
  agentName: string
  status: SubagentRunStatus
  startedAt?: number
  updatedAt: number
  completedAt?: number
  currentActivity?: string
  inputPrompt?: string
  childSessionId?: string
  toolCount: number
  unreadActivityCount: number
  error?: string
}

export type RunProgressKind =
  | "prompt_accepted"
  | "text"
  | "thinking"
  | "tool"
  | "subagent"
  | "agent"
  | "permission"
  | "retry"
  | "step"
  | "compaction"
  | "transport"
  | "error"

export interface RunProgressEvent {
  kind: RunProgressKind
  label?: string
  at?: number
  metadata?: Record<string, unknown>
}

export interface ActivityHeartbeat {
  runId: string
  tabId: string
  cliSessionId?: string
  messageId?: string
  phase: AgentRunPhase
  firstActivityAt?: number
  lastActivityAt: number
  activeToolCount: number
  activeSubagentCount: number
  statusLabel: string
  partialOutputPreserved: boolean
}

export interface AgentRunState {
  runId: string
  tabId: string
  cliSessionId?: string
  messageId?: string
  phase: AgentRunPhase
  startedAt: number
  acceptedAt: number
  firstActivityAt?: number
  firstVisibleTextAt?: number
  lastActivityAt: number
  lastVisibleTextAt?: number
  activeToolCount: number
  activeSubagentCount: number
  statusLabel: string
  tools: ToolExecutionState[]
  subagents: SubagentRunState[]
  lastError?: RunErrorState
  partialOutputPreserved: boolean
}

export interface StartRunInput {
  tabId: string
  cliSessionId?: string
  messageId?: string
  runId?: string
  model?: string
}

export interface ToolActivityInput {
  id: string
  name: string
  status: ToolExecutionStatus | "error" | "result"
  input?: unknown
  result?: string
  error?: string
}

export interface SubagentActivityInput {
  id: string
  agentName?: string
  status?: SubagentRunStatus | "pending"
  currentActivity?: string
  inputPrompt?: string
  childSessionId?: string
  error?: string
}
