export type SubagentStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export interface ToolCallSummary {
  id: string
  name: string
  status: "pending" | "running" | "completed" | "error"
  args?: string
  result?: string
  error?: string
  durationMs?: number
}

export interface CommandSummary {
  id: string
  command: string
  status: "running" | "completed" | "failed"
  output?: string
  durationMs?: number
  error?: string
}

export interface FileChangeSummary {
  path: string
  type: "read" | "write" | "edit" | "delete"
  additions?: number
  deletions?: number
  diff?: string
}

export interface TokenUsageSummary {
  input: number
  output: number
  total: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface SubagentDetailMessage {
  role: "user" | "assistant" | "system"
  text: string
  timestamp?: number
}

export interface SubagentSession {
  id: string
  sessionId?: string
  parentSessionId: string
  agentName: string
  agentMode?: string
  status: SubagentStatus
  title?: string
  createdAt?: number
  updatedAt?: number
  startedAt?: number
  completedAt?: number
  lastActivityAt?: number
  inputPrompt?: string
  summary?: string
  result?: string
  error?: string
  model?: string
  provider?: string
  messages?: SubagentDetailMessage[]
  toolCalls?: ToolCallSummary[]
  commands?: CommandSummary[]
  fileChanges?: FileChangeSummary[]
  tokenUsage?: TokenUsageSummary
  cost?: number
  metadata?: Record<string, unknown>
  isLive: boolean
  unreadActivityCount: number
  currentActivity?: string
  durationMs?: number
}

export interface SubagentSummary {
  id: string
  sessionId?: string
  parentSessionId: string
  agentName: string
  status: SubagentStatus
  title?: string
  currentActivity?: string
  startedAt?: number
  completedAt?: number
  durationMs?: number
  isLive: boolean
  unreadActivityCount: number
  error?: string
}

export type DetailViewLevel = "default" | "expanded" | "debug"

export const SUBAGENT_STATUS_LABELS: Record<SubagentStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unknown",
}
