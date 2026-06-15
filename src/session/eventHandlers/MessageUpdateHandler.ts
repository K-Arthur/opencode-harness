import { SdkEventLike, NormalizedOpencodeEvent, MessageInfoLike, NormalizerContext, EventHandler } from "./types"

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
        // Carry the server assistant message id so the host can correlate an
        // expected MessageAbortedError to the run it intentionally aborted,
        // independent of wall-clock timing (see IntentionalAbortRegistry).
        data: { error: msg.error, messageId: msg.id },
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
