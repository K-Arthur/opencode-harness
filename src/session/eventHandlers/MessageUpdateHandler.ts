import { SdkEventLike, NormalizedOpencodeEvent, MessageInfoLike } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class MessageUpdateHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.updated"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as { info?: MessageInfoLike } | undefined
    const msg = props?.info

    if (msg?.id && msg.role) {
      context.messageRoles.set(msg.id, msg.role)
    }

    if (msg?.role !== "assistant") return out

    if (msg.error) {
      out.push({
        type: "server_error",
        sessionId: msg.sessionID ?? msg.sessionId,
        data: { error: msg.error },
      })
      if (msg.id) context.clearMessageTracking(msg.id)
      return out
    }

    if (msg.time?.completed) {
      out.push({
        type: "message_complete",
        sessionId: msg.sessionID ?? msg.sessionId,
        data: { message: msg },
      })
      if (msg.id) context.clearMessageTracking(msg.id)
    }

    return out
  }
}
