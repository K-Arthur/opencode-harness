export type NormalizedOpencodeEventType =
  | "tool_start"
  | "tool_update"
  | "tool_end"
  | "skill_load"
  | "thinking"
  | "text_chunk"
  | "message_complete"
  | "session_status"
  | "session_compacted"
  | "server_connected"
  | "server_disconnected"
  | "server_error"
  | "file_edited"
  | "permission_request"
  | "permission_replied"

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
  isAssistantMessage: (messageId: string | undefined) => boolean
  clearMessageTracking: (messageId: string) => void
  rememberPart: (part: PartLike) => void
}

export interface SdkEventNormalizer {
  normalize: (event: SdkEventLike) => NormalizedOpencodeEvent[]
}

import { EventHandler } from "./eventHandlers/types"
import { TextPartHandler } from "./eventHandlers/TextPartHandler"
import { ToolPartHandler } from "./eventHandlers/ToolPartHandler"
import { DeltaHandler } from "./eventHandlers/DeltaHandler"
import { MessageUpdateHandler } from "./eventHandlers/MessageUpdateHandler"
import { SessionStatusHandler, SessionErrorHandler, SessionIdleHandler } from "./eventHandlers/SessionHandlers"
import { FileEditHandler } from "./eventHandlers/FileEditHandler"
import { PermissionHandler } from "./eventHandlers/PermissionHandler"
import { SessionDiffHandler } from "./eventHandlers/SessionDiffHandler"
import { SessionCompactedHandler } from "./eventHandlers/SessionCompactedHandler"
import { FallbackHandler } from "./eventHandlers/FallbackHandler"

// Static handler chain — instantiated once at module load
const HANDLERS: EventHandler[] = [
  new TextPartHandler(),
  new ToolPartHandler(),
  new DeltaHandler(),
  new MessageUpdateHandler(),
  new SessionStatusHandler(),
  new SessionErrorHandler(),
  new SessionIdleHandler(),
  new FileEditHandler(),
  new PermissionHandler(),
  new SessionDiffHandler(),
  new SessionCompactedHandler(),
  new FallbackHandler(),
]

export function createSdkEventNormalizer(): SdkEventNormalizer {

  // Shared state (used by handlers via context)
  const partTextLengths = new Map<string, number>()
  const partMessageIds = new Map<string, string>()
  const partSessionIds = new Map<string, string>()
  const partTypes = new Map<string, string>()
  const partStatusKeys = new Map<string, string>()
  const messageRoles = new Map<string, string>()
  const toolStatuses = new Map<string, string>()
  const toolInputs = new Map<string, string>()
  const toolOutputs = new Map<string, string>()
  const toolStartedIds = new Set<string>()
  const seenUnknownTypes = new Set<string>()

  const isAssistantMessage = (messageId: string | undefined): boolean => {
    if (!messageId) return false
    const role = messageRoles.get(messageId)
    // If we haven't seen the role yet, assume assistant — the event stream
    // only carries assistant response parts. Requiring the role to be known
    // creates a race where message.part.delta arrives before message.updated
    // and chunks are silently dropped, causing "no output" symptoms.
    if (!role) return true
    return role === "assistant"
  }

  const clearMessageTracking = (messageId: string): void => {
    messageRoles.delete(messageId)
    for (const [partId, trackedMessageId] of partMessageIds) {
      if (trackedMessageId !== messageId) continue
      const statusKey = partStatusKeys.get(partId) ?? partId
      partMessageIds.delete(partId)
      partSessionIds.delete(partId)
      partTypes.delete(partId)
      partTextLengths.delete(partId)
      partStatusKeys.delete(partId)
      toolStatuses.delete(statusKey)
      toolInputs.delete(statusKey)
      toolOutputs.delete(statusKey)
      toolStartedIds.delete(statusKey)
    }
  }

  const rememberPart = (part: PartLike): void => {
    if (!part.id) return
    if (part.messageID) partMessageIds.set(part.id, part.messageID)
    if (part.sessionID) partSessionIds.set(part.id, part.sessionID)
    if (part.type) partTypes.set(part.id, part.type)
  }

  const context: NormalizerContext = {
    partTextLengths,
    partMessageIds,
    partSessionIds,
    partTypes,
    partStatusKeys,
    messageRoles,
    toolStatuses,
    toolInputs,
    toolOutputs,
    toolStartedIds,
    seenUnknownTypes,
    isAssistantMessage,
    clearMessageTracking,
    rememberPart,
  }

  return {
    normalize(event: SdkEventLike): NormalizedOpencodeEvent[] {
      const out: NormalizedOpencodeEvent[] = []

      for (const handler of HANDLERS) {
        if (handler.canHandle(event.type)) {
          const results = handler.handle(event, context)
          out.push(...results)
          // For "message.part.updated", both TextPartHandler and ToolPartHandler
          // can handle different part types - continue checking all handlers
          if (event.type !== "message.part.updated") {
            break
          }
        }
      }

      return out
    },
  }
}
