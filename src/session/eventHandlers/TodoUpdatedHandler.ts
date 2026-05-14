import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class TodoUpdatedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "todo.updated"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = event.properties as { sessionID?: string; todos?: unknown[] } | undefined
    return [{
      type: "todo_updated",
      sessionId: props?.sessionID,
      data: { todos: props?.todos ?? [] },
    }]
  }
}
