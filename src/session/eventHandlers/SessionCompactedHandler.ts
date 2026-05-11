import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class SessionCompactedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.compacted"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    out.push({
      type: "session_compacted",
      sessionId: (event.properties as { sessionID?: string } | undefined)?.sessionID,
      data: event.properties,
    })
    return out
  }
}
