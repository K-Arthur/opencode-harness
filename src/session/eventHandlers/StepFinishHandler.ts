import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class StepFinishHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as Record<string, unknown> | undefined
    if (!props) return out

    const part = typeof props.part === "object" && props.part !== null
      ? props.part as Record<string, unknown>
      : props
    const partType = part.type as string | undefined
    if (partType !== "step-finish") return out

    const sessionId = (part as { sessionID?: string }).sessionID
    const tokens = part.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
    const cost = part.cost as number | undefined

    if (!tokens) return out

    out.push({
      type: "step_finish",
      sessionId,
      data: {
        tokens: {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          reasoning: tokens.reasoning ?? 0,
          cacheRead: tokens.cache?.read ?? 0,
          cacheWrite: tokens.cache?.write ?? 0,
        },
        cost: cost ?? 0,
      },
    })
    return out
  }
}
