import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

function sessionIdFromProperties(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) return undefined
  if (typeof properties.sessionID === "string") return properties.sessionID
  const info = properties.info
  if (info && typeof info === "object" && typeof (info as { sessionID?: unknown }).sessionID === "string") {
    return (info as { sessionID: string }).sessionID
  }
  return undefined
}

export class FallbackHandler implements EventHandler {
  canHandle(_eventType: string): boolean {
    // This handler is the catch-all - it handles anything
    return true
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    if (!context.seenUnknownTypes.has(event.type)) {
      context.seenUnknownTypes.add(event.type)
    }
    const properties = event.properties as Record<string, unknown> | undefined
    return [{
      type: "unknown_server_event",
      sessionId: sessionIdFromProperties(properties),
      data: {
        eventType: event.type,
        classification: "unclassified",
        preview: safePreview(properties),
      },
    }]
  }
}

function safePreview(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}).slice(0, 500)
  } catch {
    return String(value).slice(0, 500)
  }
}
