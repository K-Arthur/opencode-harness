import { SdkEventLike, NormalizedOpencodeEvent, PartLike, ToolPartLike } from "../EventNormalizer"
import { NormalizerContext, EventHandler } from "./types"

export class ToolPartHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  private stableToolId(toolPart: ToolPartLike): string {
    return toolPart.id || toolPart.callID || `${toolPart.messageID || ""}:${toolPart.tool || "tool"}`
  }

  private stringify(value: unknown): string {
    return value === undefined ? "" : JSON.stringify(value)
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as { part?: PartLike } | undefined
    const part = props?.part
    if (!part || part.type !== "tool") return out

    const toolPart = part as ToolPartLike
    const statusKey = this.stableToolId(toolPart)
    const status = toolPart.state?.status

    if (toolPart.id) {
      context.partStatusKeys.set(toolPart.id, statusKey)
    }
    if (toolPart.callID) {
      context.partStatusKeys.set(toolPart.callID, statusKey)
    }

    const inputStr = this.stringify(toolPart.state?.input)
    const outputStr = this.stringify(toolPart.state?.output ?? toolPart.state?.error ?? "")
    const prevStatus = context.toolStatuses.get(statusKey)
    const prevInput = context.toolInputs.get(statusKey)
    const prevOutput = context.toolOutputs.get(statusKey)
    const alreadyStarted = context.toolStartedIds.has(statusKey)
    const statusChanged = prevStatus !== status
    const inputChanged = prevInput !== inputStr
    const outputChanged = prevOutput !== outputStr

    if (!statusChanged && !inputChanged && !outputChanged && status !== "completed" && status !== "error") {
      return out
    }

    if (status) context.toolStatuses.set(statusKey, status)
    context.toolInputs.set(statusKey, inputStr)
    context.toolOutputs.set(statusKey, outputStr)

    if (status === "pending" || status === "running") {
      if (!alreadyStarted) {
        context.toolStartedIds.add(statusKey)
        out.push({
          type: "tool_start",
          sessionId: toolPart.sessionID,
          data: { id: statusKey, tool: toolPart.tool, input: toolPart.state?.input, status },
        })
      } else if (statusChanged || inputChanged) {
        out.push({
          type: "tool_update",
          sessionId: toolPart.sessionID,
          data: { id: statusKey, tool: toolPart.tool, input: toolPart.state?.input, status },
        })
      }
    } else if (status === "completed" || status === "error") {
      if (!statusChanged && !outputChanged) return out
      out.push({
        type: "tool_end",
        sessionId: toolPart.sessionID,
        data: {
          id: statusKey,
          tool: toolPart.tool,
          ok: status === "completed",
          result: toolPart.state?.output ?? toolPart.state?.error ?? "",
        },
      })
    }

    return out
  }
}
