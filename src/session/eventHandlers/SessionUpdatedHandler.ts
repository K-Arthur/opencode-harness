import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

/**
 * Bridges the SDK's `session.updated` SSE event to the extension's internal
 * `session_updated` event. The handler is purely a normaliser — it does
 * not touch SessionStore directly; downstream consumers (in ChatProvider
 * or the extension's event dispatcher) call `SessionStore.applyServerTitle`
 * with the carried `(sessionId, title)` pair.
 *
 * Why route through a handler at all? Symmetry with the existing event
 * pipeline (`SessionCompactedHandler`, `SessionDiffHandler`, …) and a
 * single place to normalise the SDK's `properties.info: Session` shape.
 *
 * Spec: ADR-008 §5.4.
 */
export class SessionUpdatedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.updated"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const info = (event.properties?.info ?? {}) as { id?: string; title?: string }
    return [
      {
        type: "session_updated",
        sessionId: info.id,
        data: { title: info.title },
      },
    ]
  }
}
