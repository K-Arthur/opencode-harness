import { SdkEventLike, NormalizedOpencodeEvent, PartLike, ToolPartLike } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class ToolPartHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as { part?: PartLike } | undefined
    const part = props?.part
    if (!part || part.type !== "tool") return out

    const toolPart = part as ToolPartLike
    const statusKey = toolPart.id || toolPart.callID || `${toolPart.messageID || ""}:${toolPart.tool || ""}`
    const status = toolPart.state?.status

    if (toolPart.id) {
      context.partStatusKeys.set(toolPart.id, statusKey)
    }

    if (
      status &&
      context.toolStatuses.get(statusKey) === status &&
      status !== "completed" &&
      status !== "error"
    ) {
      return out
    }

    if (status) {
      context.toolStatuses.set(statusKey, status)
    }

    if (status === "pending" || status === "running") {
      out.push({
        type: "tool_start",
        sessionId: toolPart.sessionID,
        data: { tool: toolPart.tool, input: toolPart.state?.input, status },
      })
    } else if (status === "completed" || status === "error") {
      out.push({
        type: "tool_end",
        sessionId: toolPart.sessionID,
        data: { tool: toolPart.tool, result: toolPart.state?.output ?? toolPart.state?.error ?? "" },
      })
    }

    return out
  }
}
