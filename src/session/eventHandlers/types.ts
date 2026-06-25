export type NormalizedOpencodeEventType =
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
  | "step_finish"
  | "mcp_tools_changed"
  | "todo_updated"
  | "subagent_update"
  | "agent_activity"
  | "retry_activity"
  | "compaction_activity"
  | "activity"
  | "unknown_server_event"

export interface NormalizedOpencodeEvent {
  type: NormalizedOpencodeEventType | string
  sessionId?: string
  data?: unknown
}

export interface SdkEventLike {
  type: string
  properties?: Record<string, unknown>
  /** V2Event format uses `data` instead of `properties`. Normalized to
   *  `properties` by the SSE parser so handlers only need to check one field. */
  data?: Record<string, unknown>
  /** Event ID (present in both Event and V2Event formats). */
  id?: string
}

export interface PartLike {
  id?: string;
  type?: string;
  sessionID?: string;
  messageID?: string;
  text?: string;
}

export interface ToolPartLike extends PartLike {
  name?: string;
  callID?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
    time?: { start?: number; end?: number };
  };
}

export interface MessageInfoLike {
  id?: string;
  role?: string;
  blocks?: unknown[];
  timestamp?: number;
  sessionId?: string;
  sessionID?: string;
  /**
   * The SDK emits a structured error union here
   * (ProviderAuthError | ApiError | MessageOutputLengthError | …), each with a
   * `name` discriminator and a nested `data` payload — see
   * @opencode-ai/sdk types.gen.d.ts. Typing it as a string erased that structure
   * at the pipeline boundary; the host (mapOpencodeError) needs `name`/`data`.
   * A plain string is still accepted for non-SDK/legacy producers.
   */
  error?: string | {
    name?: string;
    data?: {
      message?: string;
      providerID?: string;
      statusCode?: number;
      isRetryable?: boolean;
      responseBody?: string;
    };
  };
  time?: {
    completed?: number;
  };
}

export interface NormalizerContext {
  partTextLengths: Map<string, number>
  partMessageIds: Map<string, string>
  partSessionIds: Map<string, string>
  partTypes: Map<string, string>
  partStatusKeys: Map<string, string>
  messageRoles: Map<string, string>
  toolStatuses: Map<string, string>
  toolInputs: Map<string, string>
  toolOutputs: Map<string, string>
  toolStartedIds: Set<string>
  toolPartialTokens: Map<string, number>
  toolPartialStdoutLengths: Map<string, number>
  toolPartialStderrLengths: Map<string, number>
  seenUnknownTypes: Set<string>

  isAssistantMessage(messageId: string | undefined): boolean
  clearMessageTracking(messageId: string): void
  rememberPart(part: PartLike): void
}

export interface EventHandler {
  canHandle(eventType: string): boolean
  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[]
}
