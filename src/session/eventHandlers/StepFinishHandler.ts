import { SdkEventLike, NormalizedOpencodeEvent } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class StepFinishHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as Record<string, unknown> | undefined
    if (!props) return out

    const partType = props.type as string | undefined
    if (partType !== "step-finish") return out

    const sessionId = (props as { sessionID?: string }).sessionID
    const tokens = props.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined
    const cost = props.cost as number | undefined

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
