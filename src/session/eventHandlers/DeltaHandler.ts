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

    const isAssistant = context.isAssistantMessage(messageId)
    if (!isAssistant) {
      console.warn(`[opencode-harness] DeltaHandler: DROPPING delta for messageId=${messageId} sessionId=${sessionId} — role check failed (known roles: ${Array.from(context.messageRoles.entries()).map(([k, v]) => `${k}=${v}`).join(",") || "none"})`)
      const role = messageId ? context.messageRoles.get(messageId) : undefined
      if (!role) {
        console.warn(`[opencode-harness] DeltaHandler: messageId=${messageId} has NO role registered. message.updated may not have arrived yet, or sessionID=${sessionId} may be mismatched.`)
      }
      return out
    }
    if (partType && partType !== "text") return out

    if (partId) {
      context.partTextLengths.set(partId, (context.partTextLengths.get(partId) || 0) + delta.length)
    }

    out.push({
      type: "text_chunk",
      sessionId,
      data: { text: delta, messageId },
    })

    console.info(`[opencode-harness] DeltaHandler: emitted text_chunk sessionId=${sessionId} messageId=${messageId} deltaLen=${delta.length} preview=${JSON.stringify(delta.slice(0, 60))}`)
    return out
  }
}
