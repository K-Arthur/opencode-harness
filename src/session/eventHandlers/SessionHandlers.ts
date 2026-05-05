import { SdkEventLike, NormalizedOpencodeEvent } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class SessionStatusHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.status"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const data = event.properties as { sessionID?: string; status?: unknown } | undefined
    out.push({
      type: "session_status",
      sessionId: data?.sessionID,
      data: { status: data?.status },
    })
    return out
  }
}

export class SessionErrorHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.error"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const data = event.properties as { sessionID?: string; error?: unknown } | undefined
    out.push({
      type: "server_error",
      sessionId: data?.sessionID,
      data: { error: data?.error },
    })
    return out
  }
}

export class SessionIdleHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.idle"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const sessionId = (event.properties as { sessionID?: string } | undefined)?.sessionID
    out.push({
      type: "session_status",
      sessionId,
      data: { status: { type: "idle" } },
    })
    return out
  }
}
