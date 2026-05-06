import { SdkEventLike, NormalizedOpencodeEvent, PartLike } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class TextPartHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as { part?: PartLike; delta?: string } | undefined
    const part = props?.part
    if (!part) return out

    context.rememberPart(part)

    if (!context.isAssistantMessage(part.messageID)) {
      const role = part.messageID ? context.messageRoles.get(part.messageID) : undefined
      if (!role) {
        console.warn(`[opencode-harness] TextPartHandler: messageId=${part.messageID} has NO role registered — text may be dropped prematurely`)
      }
      return out
    }

    if (part.type === "text") {
      const stablePartId = part.id || `${part.sessionID || ""}:${part.messageID || ""}`
      const previousLength = context.partTextLengths.get(stablePartId) || 0
      const text = part.text ?? ""
      const delta = typeof props?.delta === "string" ? props.delta : text.slice(previousLength)

      context.partTextLengths.set(stablePartId, text.length)

      if (delta) {
        out.push({
          type: "text_chunk",
          sessionId: part.sessionID,
          data: { text: delta },
        })
      }
    }

    return out
  }
}
