import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class SessionDiffHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.diff"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    out.push({
      type: "file_edited",
      sessionId: (event.properties as { sessionID?: string } | undefined)?.sessionID,
      data: event.properties,
    })
    return out
  }
}
