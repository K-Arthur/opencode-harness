import { SdkEventLike, NormalizedOpencodeEvent, PartLike, ToolPartLike, MessageInfoLike } from "../EventNormalizer"

export interface NormalizerContext {
  // State Maps
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

  // Helper functions
  isAssistantMessage(messageId: string | undefined): boolean
  clearMessageTracking(messageId: string): void
  rememberPart(part: PartLike): void
}

export interface EventHandler {
  // Returns true if this handler can handle the given event type
  canHandle(eventType: string): boolean
  // Handle the event, returning normalized events
  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[]
}
