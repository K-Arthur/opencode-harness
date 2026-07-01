export type OpencodeEventType =
  | "tool_start"
  | "tool_update"
  | "tool_partial"
  | "tool_end"
  | "skill_load"
  | "step_start"
  | "thinking"
  | "text_chunk"
  | "message_complete"
  | "session_status"
  | "session_updated"
  | "session_compacted"
  | "server_connected"
  | "server_disconnected"
  | "server_error"
  | "file_edited"
  | "permission_request"
  | "permission_replied"
  | "question_asked"
  | "question_replied"
  | "question_rejected"
  | "todo_updated"
  | "mcp_tools_changed"
  | "step_finish"
  | "activity"
  | "pty.created"
  | "pty.updated"
  | "pty.exited"
  | "pty.deleted"
  | "unknown_server_event"

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
  /** User message ID supplied by the webview; forwarded to OpenCode as messageID. */
  messageID?: string
  /** Extension-local request ID used only for tracing and UI recovery. */
  clientRequestId?: string
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
  /**
   * Fix 2: True when the tab had a pending stream at capture time
   * (`waitingForCompletion === true`). Broader than `wasStreaming` — covers
   * the finalizing phase where `isStreaming` is false but the run is still
   * completing. On reload, tabs with `pendingStream` trigger
   * `reconcileAfterReconnect` to detect if `time.completed` was set during
   * the outage (and emit the dropped `stream_end` if so), or to restore the
   * "thinking" state if the run is still active.
   */
  pendingStream?: boolean
  /** The last user message ID we sent (for resume). */
  lastUserMessageId?: string
  /** Timestamp of the crash/disconnect (ms since epoch). */
  interruptedAt: number
}
