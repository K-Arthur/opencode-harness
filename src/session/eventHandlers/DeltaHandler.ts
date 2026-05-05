import { SdkEventLike, NormalizedOpencodeEvent } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class DeltaHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.delta"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as {
      sessionID?: string
      messageID?: string
      partID?: string
      delta?: string
    } | undefined

    const delta = props?.delta
    if (!delta) return out

    const partId = props.partID
    const messageId = props.messageID || (partId ? context.partMessageIds.get(partId) : undefined)
    const sessionId = props.sessionID || (partId ? context.partSessionIds.get(partId) : undefined)
    const partType = partId ? context.partTypes.get(partId) : undefined

    if (!context.isAssistantMessage(messageId)) return out
    if (partType && partType !== "text") return out

    if (partId) {
      context.partTextLengths.set(partId, (context.partTextLengths.get(partId) || 0) + delta.length)
    }

    out.push({
      type: "text_chunk",
      sessionId,
      data: { text: delta },
    })

    return out
  }
}
