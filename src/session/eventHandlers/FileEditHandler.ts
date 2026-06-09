import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class FileEditHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "file.edited"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const properties = event.properties as { sessionID?: string; file?: unknown } | undefined
    const file = typeof properties?.file === "string" ? properties.file : undefined
    return [{
      type: "file_edited",
      sessionId: properties?.sessionID,
      data: {
        ...properties,
        file,
        files: file ? [file] : [],
      },
    }]
  }
}
