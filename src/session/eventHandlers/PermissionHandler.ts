import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class PermissionHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "permission.updated" || eventType === "permission.replied"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const eventType = event.type
    out.push({
      type: eventType === "permission.updated" ? "permission_request" : "permission_replied",
      sessionId: (event.properties as { sessionID?: string } | undefined)?.sessionID,
      data: event.properties,
    })
    return out
  }
}
