import type { EventHandler, SdkEventLike, NormalizedOpencodeEvent, NormalizerContext } from "./types"

const HANDLED_SUFFIXES = new Set(["created", "updated", "exited", "deleted"])
const PTY_EVENT_PREFIX = "pty."

export class PtyEventHandler implements EventHandler {
  canHandle(type: string): boolean {
    if (!type.startsWith(PTY_EVENT_PREFIX)) return false
    const suffix = type.slice(PTY_EVENT_PREFIX.length)
    return HANDLED_SUFFIXES.has(suffix)
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const suffix = event.type.slice(PTY_EVENT_PREFIX.length) as "created" | "updated" | "exited" | "deleted"
    const props = event.properties as Record<string, unknown> | undefined
    const info = props?.info as Record<string, unknown> | undefined
    const ptyId = info?.id as string | undefined

    return [
      {
        type: `pty.${suffix}` as NormalizedOpencodeEvent["type"],
        sessionId: ptyId,
        data: { ptyId, pty: info },
      },
    ]
  }
}
