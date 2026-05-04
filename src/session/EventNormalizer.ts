export type NormalizedOpencodeEventType =
  | "tool_start"
  | "tool_end"
  | "skill_load"
  | "thinking"
  | "text_chunk"
  | "message_complete"
  | "session_status"
  | "server_connected"
  | "server_disconnected"
  | "server_error"
  | "file_edited"
  | "permission_request"
  | "permission_replied"

export interface NormalizedOpencodeEvent {
  type: NormalizedOpencodeEventType | string
  sessionId?: string
  data?: unknown
}

export interface SdkEventLike {
  type: string
  properties?: Record<string, unknown>
}

interface PartLike {
  id?: string
  type?: string
  sessionID?: string
  messageID?: string
  text?: string
}

interface ToolPartLike extends PartLike {
  type: "tool"
  callID?: string
  tool?: string
  state?: {
    status?: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: string
    error?: string
  }
}

interface MessageInfoLike {
  id?: string
  sessionID?: string
  role?: string
  time?: { completed?: number }
  finish?: string
  error?: unknown
}

export interface SdkEventNormalizer {
  normalize(event: SdkEventLike): NormalizedOpencodeEvent[]
}

// H7: Track seen unknown event types to avoid log spam
const seenUnknownTypes = new Set<string>()

export function createSdkEventNormalizer(): SdkEventNormalizer {
  const partTextLengths = new Map<string, number>()
  const partMessageIds = new Map<string, string>()
  const partSessionIds = new Map<string, string>()
  const partTypes = new Map<string, string>()
  const partStatusKeys = new Map<string, string>()
  const messageRoles = new Map<string, string>()
  const toolStatuses = new Map<string, string>()

  const isAssistantMessage = (messageId: string | undefined): boolean =>
    Boolean(messageId && messageRoles.get(messageId) === "assistant")

  const clearMessageTracking = (messageId: string): void => {
    messageRoles.delete(messageId)
    for (const [partId, trackedMessageId] of partMessageIds) {
      if (trackedMessageId !== messageId) continue
      const statusKey = partStatusKeys.get(partId) ?? partId
      partMessageIds.delete(partId)
      partSessionIds.delete(partId)
      partTypes.delete(partId)
      partTextLengths.delete(partId)
      partStatusKeys.delete(partId)
      toolStatuses.delete(statusKey)
    }
  }

  const rememberPart = (part: PartLike): void => {
    if (!part.id) return
    if (part.messageID) partMessageIds.set(part.id, part.messageID)
    if (part.sessionID) partSessionIds.set(part.id, part.sessionID)
    if (part.type) partTypes.set(part.id, part.type)
  }

  return {
    normalize(event: SdkEventLike): NormalizedOpencodeEvent[] {
      const out: NormalizedOpencodeEvent[] = []
      const props = event.properties

      switch (event.type) {
        case "message.part.updated": {
          const part = (props as { part?: PartLike } | undefined)?.part
          if (!part) break

          rememberPart(part)

          if (!isAssistantMessage(part.messageID)) break

          if (part.type === "text") {
            const stablePartId = part.id || `${part.sessionID || ""}:${part.messageID || ""}`
            const previousLength = partTextLengths.get(stablePartId) || 0
            const text = part.text ?? ""
            const delta = typeof props?.delta === "string" ? props.delta : text.slice(previousLength)

            partTextLengths.set(stablePartId, text.length)
            if (!delta) break

            out.push({
              type: "text_chunk",
              sessionId: part.sessionID,
              data: { text: delta },
            })
          } else if (part.type === "tool") {
            const toolPart = part as ToolPartLike
            const statusKey = toolPart.id || toolPart.callID || `${toolPart.messageID || ""}:${toolPart.tool || ""}`
            const status = toolPart.state?.status

            if (toolPart.id) partStatusKeys.set(toolPart.id, statusKey)
            if (status && toolStatuses.get(statusKey) === status && status !== "completed" && status !== "error") {
              break
            }
            if (status) toolStatuses.set(statusKey, status)

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
          }
          break
        }

        case "message.part.delta": {
          const deltaProps = props as {
            sessionID?: string
            messageID?: string
            partID?: string
            delta?: string
          } | undefined
          const delta = deltaProps?.delta
          if (!delta) break

          const partId = deltaProps.partID
          const messageId = deltaProps.messageID || (partId ? partMessageIds.get(partId) : undefined)
          const sessionId = deltaProps.sessionID || (partId ? partSessionIds.get(partId) : undefined)
          const partType = partId ? partTypes.get(partId) : undefined

          if (!isAssistantMessage(messageId)) break
          if (partType && partType !== "text") break

          if (partId) {
            partTextLengths.set(partId, (partTextLengths.get(partId) || 0) + delta.length)
          }

          out.push({
            type: "text_chunk",
            sessionId,
            data: { text: delta },
          })
          break
        }

        case "message.updated": {
          const msg = (props as { info?: MessageInfoLike } | undefined)?.info

          if (msg?.id && msg.role) {
            messageRoles.set(msg.id, msg.role)
          }

          if (msg?.role !== "assistant") break

          if (msg.error) {
            out.push({
              type: "server_error",
              sessionId: msg.sessionID,
              data: { error: msg.error },
            })
            if (msg.id) clearMessageTracking(msg.id)
            break
          }

          if (msg.time?.completed) {
            out.push({
              type: "message_complete",
              sessionId: msg.sessionID,
              data: { message: msg },
            })
            if (msg.id) clearMessageTracking(msg.id)
          }
          break
        }

        case "session.status": {
          const data = props as { sessionID?: string; status?: unknown } | undefined
          out.push({
            type: "session_status",
            sessionId: data?.sessionID,
            data: { status: data?.status },
          })
          break
        }

        case "session.idle": {
          const sessionId = (props as { sessionID?: string } | undefined)?.sessionID
          out.push({
            type: "session_status",
            sessionId,
            data: { status: { type: "idle" } },
          })
          break
        }

        case "session.error": {
          const data = props as { sessionID?: string; error?: unknown } | undefined
          out.push({
            type: "server_error",
            sessionId: data?.sessionID,
            data: { error: data?.error },
          })
          break
        }

        case "session.diff": {
          out.push({
            type: "file_edited",
            sessionId: (props as { sessionID?: string } | undefined)?.sessionID,
            data: props,
          })
          break
        }

        case "file.edited": {
          out.push({
            type: "file_edited",
            data: props,
          })
          break
        }

        case "permission.updated": {
          out.push({
            type: "permission_request",
            sessionId: (props as { sessionID?: string } | undefined)?.sessionID,
            data: props,
          })
          break
        }

        case "permission.replied": {
          out.push({
            type: "permission_replied",
            sessionId: (props as { sessionID?: string } | undefined)?.sessionID,
            data: props,
          })
          break
        }

        default: {
          // H7: Log unknown event types (once per type) for debuggability
          if (!seenUnknownTypes.has(event.type)) {
            seenUnknownTypes.add(event.type)
            console.warn(`[opencode-harness] Unhandled SDK event type: "${event.type}"`)
          }
          break
        }
      }

      return out
    },
  }
}
