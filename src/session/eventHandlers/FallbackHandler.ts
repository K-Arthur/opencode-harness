import { SdkEventLike, NormalizedOpencodeEvent } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class FallbackHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    // This handler is the catch-all - it handles anything
    return true
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []

    // Log unknown event types (once per type) for debuggability
    if (!context.seenUnknownTypes.has(event.type)) {
      context.seenUnknownTypes.add(event.type)
      console.warn(`[opencode-harness] Unhandled SDK event type: "${event.type}"`)
    }

    return out
  }
}
