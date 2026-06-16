import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"
import { countOutputLines } from "../liveToolOutput"
const NEXT_PREFIX = "session.next."

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function contentToString(content: unknown, structured: unknown): string {
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        const rec = asRecord(item)
        if (rec.type === "text" && typeof rec.text === "string") return rec.text
        if (rec.type === "file" && typeof rec.uri === "string") return rec.uri
        return ""
      })
      .filter(Boolean)
      .join("\n")
    if (text) return text
  }
  if (structured !== undefined) {
    try { return JSON.stringify(structured) } catch { return String(structured) }
  }
  return ""
}

function tokenData(tokens: unknown): { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined {
  const rec = asRecord(tokens)
  if (Object.keys(rec).length === 0) return undefined
  const cache = asRecord(rec.cache)
  return {
    input: typeof rec.input === "number" ? rec.input : undefined,
    output: typeof rec.output === "number" ? rec.output : undefined,
    reasoning: typeof rec.reasoning === "number" ? rec.reasoning : undefined,
    cache: {
      read: typeof cache.read === "number" ? cache.read : undefined,
      write: typeof cache.write === "number" ? cache.write : undefined,
    },
  }
}

export class SessionNextHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType.startsWith(NEXT_PREFIX)
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = asRecord(event.properties)
    const sessionId = stringValue(props.sessionID)
    const messageId = stringValue(props.messageID)
    const callId = stringValue(props.callID)
    const kind = event.type.slice(NEXT_PREFIX.length)

    switch (kind) {
      case "text.delta":
        return [{
          type: "text_chunk",
          sessionId,
          data: { text: stringValue(props.delta) ?? "", messageId },
        }]
      case "reasoning.delta":
        return [{
          type: "thinking",
          sessionId,
          data: { text: stringValue(props.delta) ?? "", messageId, reasoningId: props.reasoningID },
        }]
      case "tool.called":
        return [{
          type: "tool_start",
          sessionId,
          data: { id: callId, tool: stringValue(props.tool) ?? "tool", input: props.input, status: "running" },
        }]
      case "tool.progress": {
        const result = contentToString(props.content, props.structured)
        const id = callId ?? `${sessionId ?? "session"}:tool`
        const prevToken = context.toolPartialTokens.get(id) ?? 0
        const token = numberValue(props.token) ?? numberValue(props.seq) ?? numberValue(props.sequence) ?? prevToken + 1
        const events: NormalizedOpencodeEvent[] = [{
          type: "tool_update",
          sessionId,
          data: {
            id: callId,
            tool: stringValue(props.tool) ?? "tool",
            input: props.structured,
            status: "running",
            result,
          },
        }]
        if (result && token > prevToken) {
          const prevStdoutLength = context.toolPartialStdoutLengths.get(id) ?? 0
          const stdoutLength = prevStdoutLength + result.length
          context.toolPartialTokens.set(id, token)
          context.toolPartialStdoutLengths.set(id, stdoutLength)
          context.toolPartialStderrLengths.set(id, context.toolPartialStderrLengths.get(id) ?? 0)
          events.push({
            type: "tool_partial",
            sessionId,
            data: {
              id: callId,
              tool: stringValue(props.tool) ?? "tool",
              token,
              stdoutDelta: result,
              stderrDelta: "",
              stdoutLength,
              stderrLength: context.toolPartialStderrLengths.get(id) ?? 0,
              stdoutLineCount: countOutputLines(result),
              stderrLineCount: 0,
            },
          })
        }
        return events
      }
      case "tool.success":
        return [{
          type: "tool_end",
          sessionId,
          data: {
            id: callId,
            tool: "tool",
            ok: true,
            result: contentToString(props.content, props.structured),
          },
        }]
      case "tool.failed": {
        const error = asRecord(props.error)
        return [{
          type: "tool_end",
          sessionId,
          data: {
            id: callId,
            tool: "tool",
            ok: false,
            result: stringValue(error.message) ?? "Tool failed",
          },
        }]
      }
      case "step.ended":
        return [{
          type: "step_finish",
          sessionId,
          data: {
            tokens: (() => {
              const tokens = tokenData(props.tokens)
              return {
                input: tokens?.input ?? 0,
                output: tokens?.output ?? 0,
                reasoning: tokens?.reasoning ?? 0,
                cacheRead: tokens?.cache?.read ?? 0,
                cacheWrite: tokens?.cache?.write ?? 0,
              }
            })(),
            cost: typeof props.cost === "number" ? props.cost : 0,
            reason: stringValue(props.finish),
          },
        }]
      case "step.failed":
        return [{
          type: "server_error",
          sessionId,
          data: { error: props.error },
        }]
      case "retried": {
        const error = asRecord(props.error)
        return [{
          type: "retry_activity",
          sessionId,
          data: {
            id: `${sessionId ?? "session"}:retry:${props.attempt ?? "?"}`,
            attempt: props.attempt,
            error: stringValue(error.message) ?? "Provider retry",
          },
        }]
      }
      case "compaction.started":
      case "compaction.delta":
      case "compaction.ended":
        return [{
          type: "compaction_activity",
          sessionId,
          data: {
            id: `${sessionId ?? "session"}:compaction`,
            text: stringValue(props.text),
            reason: props.reason,
          },
        }]
      case "agent.switched":
      case "model.switched":
      case "moved":
      case "prompted":
      case "prompt.admitted":
      case "prompt.promoted":
      case "context.updated":
      case "synthetic":
      case "step.started":
        return [{
          type: "step_start",
          sessionId,
          data: { messageId },
        }]
      case "shell.started":
      case "shell.ended":
      case "text.started":
      case "text.ended":
      case "reasoning.started":
      case "reasoning.ended":
      case "tool.input.started":
      case "tool.input.delta":
      case "tool.input.ended":
        return [{
          type: "activity",
          sessionId,
          data: {
            eventType: event.type,
            title: this.titleFor(kind),
            detail: this.detailFor(kind, props),
            messageId,
          },
        }]
      default:
        return []
    }
  }

  private titleFor(kind: string): string {
    switch (kind) {
      case "agent.switched": return "Agent switched"
      case "model.switched": return "Model switched"
      case "moved": return "Working directory changed"
      case "prompted": return "Prompt queued"
      case "prompt.admitted": return "Prompt admitted"
      case "prompt.promoted": return "Queued prompt promoted"
      case "context.updated": return "Context updated"
      case "synthetic": return "Synthetic context added"
      case "shell.started": return "Shell command started"
      case "shell.ended": return "Shell command finished"
      case "step.started": return "Assistant step started"
      default: return "OpenCode activity"
    }
  }

  private detailFor(kind: string, props: Record<string, unknown>): string | undefined {
    if (kind === "agent.switched") return stringValue(props.agent)
    if (kind === "model.switched") {
      const model = asRecord(props.model)
      const provider = stringValue(model.providerID)
      const id = stringValue(model.id)
      return provider && id ? `${provider}/${id}` : id
    }
    if (kind === "shell.started") return stringValue(props.command)
    if (kind === "shell.ended") return stringValue(props.output)
    if (kind === "context.updated" || kind === "synthetic") return stringValue(props.text)
    return undefined
  }
}
