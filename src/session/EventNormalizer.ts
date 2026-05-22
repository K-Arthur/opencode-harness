export interface SdkEventNormalizer {
  normalize: (event: SdkEventLike) => NormalizedOpencodeEvent[]
}

import { EventHandler, NormalizedOpencodeEvent, SdkEventLike, PartLike, NormalizerContext } from "./eventHandlers/types"
import { TextPartHandler } from "./eventHandlers/TextPartHandler"
import { ToolPartHandler } from "./eventHandlers/ToolPartHandler"
import { DeltaHandler } from "./eventHandlers/DeltaHandler"
import { MessageUpdateHandler } from "./eventHandlers/MessageUpdateHandler"
import { SessionStatusHandler, SessionErrorHandler, SessionIdleHandler } from "./eventHandlers/SessionHandlers"
import { FileEditHandler } from "./eventHandlers/FileEditHandler"
import { PermissionHandler } from "./eventHandlers/PermissionHandler"
import { SessionDiffHandler } from "./eventHandlers/SessionDiffHandler"
import { SessionCompactedHandler } from "./eventHandlers/SessionCompactedHandler"
import { StepFinishHandler } from "./eventHandlers/StepFinishHandler"
import { FallbackHandler } from "./eventHandlers/FallbackHandler"
import { ServerConnectedHandler } from "./eventHandlers/ServerConnectedHandler"
import { TodoUpdatedHandler } from "./eventHandlers/TodoUpdatedHandler"
import { McpToolsChangedHandler } from "./eventHandlers/McpToolsChangedHandler"

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
  new StepFinishHandler(),
  new ServerConnectedHandler(),
  new TodoUpdatedHandler(),
  new McpToolsChangedHandler(),
  new FallbackHandler(),
]

export function createSdkEventNormalizer(): SdkEventNormalizer {

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
          if (event.type !== "message.part.updated") {
            break
          }
        }
      }

      return out
    },
  }
}
