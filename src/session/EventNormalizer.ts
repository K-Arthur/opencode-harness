export interface SdkEventNormalizer {
  normalize: (event: SdkEventLike) => NormalizedOpencodeEvent[]
}

import { EventHandler, NormalizedOpencodeEvent, SdkEventLike, PartLike, NormalizerContext } from "./eventHandlers/types"
import { TextPartHandler } from "./eventHandlers/TextPartHandler"
import { ToolPartHandler } from "./eventHandlers/ToolPartHandler"
import { ActivityPartHandler } from "./eventHandlers/ActivityPartHandler"
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
import { SessionUpdatedHandler } from "./eventHandlers/SessionUpdatedHandler"
import { QuestionHandler } from "./eventHandlers/QuestionHandler"
import { SessionNextHandler } from "./eventHandlers/SessionNextHandler"
import { PtyEventHandler } from "./eventHandlers/PtyEventHandler"
import { isSafeIgnoredEventType } from "./eventCoverage"

const HANDLERS: EventHandler[] = [
  new TextPartHandler(),
  new ToolPartHandler(),
  new ActivityPartHandler(),
  new DeltaHandler(),
  new MessageUpdateHandler(),
  new SessionStatusHandler(),
  new SessionErrorHandler(),
  new SessionIdleHandler(),
  new SessionUpdatedHandler(),
  new QuestionHandler(),
  new SessionNextHandler(),
  new FileEditHandler(),
  new PermissionHandler(),
  new SessionDiffHandler(),
  new SessionCompactedHandler(),
  new StepFinishHandler(),
  new ServerConnectedHandler(),
  new TodoUpdatedHandler(),
  new McpToolsChangedHandler(),
  new PtyEventHandler(),
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
  const toolPartialTokens = new Map<string, number>()
  const toolPartialStdoutLengths = new Map<string, number>()
  const toolPartialStderrLengths = new Map<string, number>()
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
      toolPartialTokens.delete(statusKey)
      toolPartialStdoutLengths.delete(statusKey)
      toolPartialStderrLengths.delete(statusKey)
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
    toolPartialTokens,
    toolPartialStdoutLengths,
    toolPartialStderrLengths,
    seenUnknownTypes,
    isAssistantMessage,
    clearMessageTracking,
    rememberPart,
  }

  return {
    normalize(event: SdkEventLike): NormalizedOpencodeEvent[] {
      event = unwrapSyncEvent(event)
      const out: NormalizedOpencodeEvent[] = []
      let claimed = false

      for (const handler of HANDLERS) {
        if (handler instanceof FallbackHandler) continue
        if (handler.canHandle(event.type)) {
          claimed = true
          const results = handler.handle(event, context)
          out.push(...results)
          if (event.type !== "message.part.updated") {
            break
          }
        }
      }

      if (out.length === 0 && !claimed && !isSafeIgnoredEventType(event.type)) {
        out.push(...new FallbackHandler().handle(event, context))
      }

      return out
    },
  }
}

function unwrapSyncEvent(event: SdkEventLike): SdkEventLike {
  if (event.type !== "sync") {
    if (!event.properties && event.data && typeof event.data === "object") {
      return { ...event, properties: event.data }
    }
    return event
  }
  const syncEvent = (event as unknown as { syncEvent?: unknown }).syncEvent
  if (!syncEvent || typeof syncEvent !== "object") return event
  const rec = syncEvent as { type?: unknown; data?: unknown }
  if (typeof rec.type !== "string" || !rec.data || typeof rec.data !== "object") return event
  const type = rec.type.replace(/\.1$/, "")
  return { type, properties: rec.data as Record<string, unknown> }
}
