import { SdkEventLike, NormalizedOpencodeEvent, PartLike, NormalizerContext, EventHandler } from "./types"

interface PartLikeExtended extends PartLike {
  agent?: string
  description?: string
  prompt?: string
  name?: string
  error?: string
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export class ActivityPartHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = event.properties as { part?: PartLikeExtended } | undefined
    const part = props?.part
    if (!part) return []

    context.rememberPart(part)

    if (!context.isAssistantMessage(part.messageID)) {
      return []
    }

    const id = part.id || `${part.sessionID || ""}:${part.messageID || ""}:${part.type || "part"}`

    if (part.type === "subtask") {
      return [{
        type: "subagent_update",
        sessionId: part.sessionID,
        data: {
          id,
          messageId: part.messageID,
          agentName: stringOrUndefined(part.agent) || "subagent",
          status: "running",
          currentActivity: stringOrUndefined(part.description) || stringOrUndefined(part.prompt),
          inputPrompt: stringOrUndefined(part.prompt),
          // part.sessionID is the parent session — the SDK subtask part has no
          // child-session field. The real child id arrives via the task-tool
          // bridge (StreamCoordinator) and SubagentHeartbeat discovery.
          childSessionId: undefined,
          error: stringOrUndefined(part.error),
        },
      }]
    }

    if (part.type === "agent") {
      return [{
        type: "agent_activity",
        sessionId: part.sessionID,
        data: {
          id,
          messageId: part.messageID,
          name: stringOrUndefined(part.name) || stringOrUndefined(part.agent) || "agent",
        },
      }]
    }

    if (part.type === "retry") {
      return [{
        type: "retry_activity",
        sessionId: part.sessionID,
        data: {
          id,
          messageId: part.messageID,
          error: part.error,
        },
      }]
    }

    if (part.type === "compaction") {
      return [{
        type: "compaction_activity",
        sessionId: part.sessionID,
        data: {
          id,
          messageId: part.messageID,
        },
      }]
    }

    if (part.type === "step-start") {
      return [{
        type: "step_start",
        sessionId: part.sessionID,
        data: {
          id,
          messageId: part.messageID,
        },
      }]
    }

    return []
  }
}
