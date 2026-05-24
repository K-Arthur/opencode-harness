export type NormalizedOpencodeEventType =
  | "tool_start"
  | "tool_update"
  | "tool_end"
  | "skill_load"
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
  | "step_finish"
  | "mcp_tools_changed"

export interface NormalizedOpencodeEvent {
  type: NormalizedOpencodeEventType | string
  sessionId?: string
  data?: unknown
}

export interface SdkEventLike {
  type: string
  properties?: Record<string, unknown>
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
  };
}

export interface MessageInfoLike {
  id?: string;
  role?: string;
  blocks?: unknown[];
  timestamp?: number;
  sessionId?: string;
  sessionID?: string;
  error?: string;
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
  seenUnknownTypes: Set<string>

  isAssistantMessage(messageId: string | undefined): boolean
  clearMessageTracking(messageId: string): void
  rememberPart(part: PartLike): void
}

export interface EventHandler {
  canHandle(eventType: string): boolean
  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[]
}
