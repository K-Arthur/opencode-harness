import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class PermissionHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "permission.updated" ||
      eventType === "permission.asked" ||
      eventType === "permission.v2.asked" ||
      eventType === "permission.replied" ||
      eventType === "permission.v2.replied"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const eventType = event.type
    const props = event.properties as Record<string, unknown> | undefined
    if (eventType === "permission.asked" || eventType === "permission.v2.asked") {
      const permission = typeof props?.permission === "string"
        ? props.permission
        : typeof props?.action === "string"
          ? props.action
          : undefined
      const patterns = Array.isArray(props?.patterns)
        ? props.patterns
        : Array.isArray(props?.resources)
          ? props.resources
          : undefined
      out.push({
        type: "permission_request",
        sessionId: typeof props?.sessionID === "string" ? props.sessionID : undefined,
        data: {
          ...props,
          type: permission,
          permissionType: permission,
          pattern: patterns,
        },
      })
      return out
    }

    out.push({
      type: eventType === "permission.updated" ? "permission_request" : "permission_replied",
      sessionId: typeof props?.sessionID === "string" ? props.sessionID : undefined,
      data: props,
    })
    return out
  }
}
