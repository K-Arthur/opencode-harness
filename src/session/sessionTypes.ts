export type OpencodeEventType =
  | "tool_start"
  | "tool_end"
  | "skill_load"
  | "thinking"
  | "text_chunk"
  | "message_complete"
  | "session_status"
  | "session_updated"
  | "server_connected"
  | "server_disconnected"
  | "server_error"
  | "file_edited"
  | "permission_request"
  | "permission_replied"

export interface OpencodeEvent {
  type: OpencodeEventType | string
  sessionId?: string
  data?: unknown
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface PromptOptions {
  model?: ModelRef
  agent?: string
  tools?: Record<string, boolean>
  variant?: string
  signal?: AbortSignal
}

export type EventStreamLifecycleState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"

export interface EventStreamStatus {
  state: EventStreamLifecycleState
  lastRawEventType?: string
  lastRawEventAt?: number
  reconnectAttempts: number
}

/**
 * Captures the state of a streaming tab at the moment of a CLI crash or
 * server disconnect. Persisted to `globalState` so tabs can offer to
 * resume interrupted streams after reconnection.
 *
 * Spec: ADR-010 §Phase-1.5.
 */
export interface TabRestorationState {
  /** The tab's stable extension ID. */
  tabId: string
  /** The CLI session ID at the time of interruption. */
  cliSessionId?: string
  /** True when the tab was actively streaming (not just idle). */
  wasStreaming: boolean
  /** The last user message ID we sent (for resume). */
  lastUserMessageId?: string
  /** Timestamp of the crash/disconnect (ms since epoch). */
  interruptedAt: number
}
