import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class SessionDiffHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.diff"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const properties = event.properties as {
      sessionID?: string
      file?: unknown
      // SDK FileDiff uses additions/deletions (not added/removed)
      diff?: Array<{ file?: unknown; additions?: unknown; deletions?: unknown }>
    } | undefined
    const changes = Array.isArray(properties?.diff)
      ? properties.diff
        .filter((entry): entry is { file: string; additions?: unknown; deletions?: unknown } => typeof entry.file === "string")
        .map((entry) => ({
          path: entry.file,
          added: typeof entry.additions === "number" ? entry.additions : 0,
          removed: typeof entry.deletions === "number" ? entry.deletions : 0,
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
