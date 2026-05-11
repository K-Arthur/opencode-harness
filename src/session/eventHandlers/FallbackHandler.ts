import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class FallbackHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    // This handler is the catch-all - it handles anything
    return true
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []

    // Silently skip events that no handler processed.
    // Previously logged "Unhandled SDK event type" warnings here, but those
    // were misleading because:
    //   1. For `message.part.updated` the loop continues past matched
    //      handlers (TextPartHandler, ToolPartHandler) and always reaches this.
    //   2. Events like `server.heartbeat`, `session.created`, `tui.toast.show`
    //      are lifecycle events the SDK emits — they are expected and harmless.

    return out
  }
}
