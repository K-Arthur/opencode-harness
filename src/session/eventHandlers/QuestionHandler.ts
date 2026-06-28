import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

type QuestionGroup = {
  question: string
  header?: string
  options: string[]
  multiSelect: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function toOptionLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((option) => {
      if (typeof option === "string") return option
      const rec = asRecord(option)
      if (typeof rec.label === "string") return rec.label
      if (typeof rec.value === "string") return rec.value
      return ""
    })
    .filter((label) => label.length > 0)
}

const QUESTION_KEYS = ["question", "prompt", "message", "text"] as const

function toGroups(raw: unknown, fallback?: Record<string, unknown>): QuestionGroup[] {
  const fromArray = Array.isArray(raw)
    ? raw
      .map((entry): QuestionGroup | null => {
        const rec = asRecord(entry)
        const question = typeof rec.question === "string" ? rec.question : ""
        const header = typeof rec.header === "string" ? rec.header : undefined
        const options = toOptionLabels(rec.options)
        if (!question && !header && options.length === 0) return null
        const group: QuestionGroup = {
          question,
          options,
          multiSelect: rec.multiple === true || rec.multiSelect === true,
        }
        if (header) group.header = header
        return group
      })
      .filter((group): group is QuestionGroup => group !== null)
    : []
  if (fromArray.length > 0) return fromArray
  if (!fallback) return []
  const flatQuestion = firstString(fallback, QUESTION_KEYS)
  if (flatQuestion) {
    return [{
      question: flatQuestion,
      options: toOptionLabels(fallback.options),
      multiSelect: fallback.multiSelect === true || fallback.multiple === true,
    }]
  }
  return []
}

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v) return v
  }
  return ""
}

export class QuestionHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "question.asked" ||
      eventType === "question.replied" ||
      eventType === "question.rejected" ||
      eventType === "question.v2.asked" ||
      eventType === "question.v2.replied" ||
      eventType === "question.v2.rejected"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = asRecord(event.properties)
    const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined
    const requestID = typeof props.id === "string"
      ? props.id
      : typeof props.requestID === "string"
        ? props.requestID
        : typeof event.id === "string"
          ? event.id
          : undefined

    if (event.type === "question.asked" || event.type === "question.v2.asked") {
      const groups = toGroups(props.questions, props)
      const tool = asRecord(props.tool)
      const toolCallId = typeof tool.callID === "string" ? tool.callID : requestID ?? "question"
      const messageId = typeof tool.messageID === "string" ? tool.messageID : undefined
      const allowFreeText = !Array.isArray(props.questions) || props.questions.some((entry) => asRecord(entry).custom !== false)

      return [{
        type: "question_asked",
        sessionId,
        data: {
          requestID,
          toolCallId,
          messageId,
          questions: props.questions,
          block: {
            type: "question",
            id: toolCallId,
            toolCallId,
            requestID,
            sessionId,
            groups,
            text: groups[0]?.question ?? "",
            options: groups[0]?.options ?? [],
            allowFreeText: allowFreeText || groups.every((group) => group.options.length === 0),
          },
        },
      }]
    }

    return [{
      type: event.type.endsWith(".rejected") ? "question_rejected" : "question_replied",
      sessionId,
      data: {
        requestID,
        answers: props.answers,
      },
    }]
  }
}
