import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class SessionDiffHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.diff"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const properties = event.properties as {
      sessionID?: string
      file?: unknown
      diff?: Array<{ file?: unknown; added?: unknown; removed?: unknown }>
    } | undefined
    const changes = Array.isArray(properties?.diff)
      ? properties.diff
        .filter((entry): entry is { file: string; added?: unknown; removed?: unknown } => typeof entry.file === "string")
        .map((entry) => ({
          path: entry.file,
          added: typeof entry.added === "number" ? entry.added : 0,
          removed: typeof entry.removed === "number" ? entry.removed : 0,
        }))
      : typeof properties?.file === "string"
        ? [{ path: properties.file, added: 0, removed: 0 }]
        : []

    return [{
      type: "file_edited",
      sessionId: properties?.sessionID,
      data: {
        ...properties,
        file: changes[0]?.path,
        files: changes.map((change) => change.path),
        changes,
      },
    }]
  }
}
