import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import { log } from "../utils/outputChannel"

type RawRecord = Record<string, unknown>

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {}
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function parseInput(value: unknown): RawRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as RawRecord
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value)
      return record(parsed)
    } catch {
      return { raw: value }
    }
  }
  return {}
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : ""
  return value.map((entry) => {
    const item = record(entry)
    if (typeof item.text === "string") return item.text
    if (typeof item.uri === "string") return item.uri
    return ""
  }).filter(Boolean).join("\n")
}

function basePart(sessionId: string, messageId: string, partId: string, type: string): RawRecord {
  return { id: partId, sessionID: sessionId, messageID: messageId, type }
}

function mapAssistantContent(sessionId: string, messageId: string, content: unknown): Part[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((entry, index) => {
    const item = record(entry)
    const type = stringValue(item.type)
    const partId = stringValue(item.id, `${messageId}:part:${index}`)
    if (type === "text" || type === "reasoning") {
      return [{
        ...basePart(sessionId, messageId, partId, type),
        text: stringValue(item.text),
        ...(type === "reasoning" ? { time: record(item.time) } : {}),
      } as unknown as Part]
    }
    if (type === "tool") {
      const state = record(item.state)
      const status = stringValue(state.status, "pending")
      const mappedState: RawRecord = {
        status,
        input: parseInput(state.input),
        ...(typeof state.output === "string" ? { output: state.output } : {}),
        ...(typeof state.error === "string" ? { error: state.error } : {}),
        ...(state.metadata && typeof state.metadata === "object" ? { metadata: state.metadata } : {}),
        ...(state.time && typeof state.time === "object" ? { time: state.time } : {}),
        ...(typeof state.title === "string" ? { title: state.title } : {}),
      }
      return [{
        ...basePart(sessionId, messageId, partId, "tool"),
        callID: partId,
        tool: stringValue(item.name, "tool"),
        state: mappedState,
      } as unknown as Part]
    }
    return []
  })
}

function mappedMessageInfo(sessionId: string, raw: RawRecord, role: "user" | "assistant"): Message {
  const model = record(raw.model)
  const created = numberValue(record(raw.time).created, Date.now())
  return {
    ...raw,
    id: stringValue(raw.id),
    sessionID: sessionId,
    role,
    time: { created, ...(record(raw.time).completed !== undefined ? { completed: numberValue(record(raw.time).completed) } : {}) },
    ...(role === "assistant"
      ? {
          parentID: "",
          modelID: stringValue(model.id),
          providerID: stringValue(model.providerID),
          mode: "",
          agent: stringValue(raw.agent),
          path: { cwd: "", root: "" },
          cost: numberValue(raw.cost),
          tokens: raw.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
      : {
          agent: stringValue(raw.agent),
          model: { providerID: stringValue(model.providerID), modelID: stringValue(model.id) },
        }),
  } as unknown as Message
}

function mapMessage(sessionId: string, raw: RawRecord): { info: Message; parts: Part[] } {
  const type = stringValue(raw.type)
  const messageId = stringValue(raw.id, `${sessionId}:message`)
  if (type === "user") {
    return {
      info: mappedMessageInfo(sessionId, raw, "user"),
      parts: [{ ...basePart(sessionId, messageId, `${messageId}:text`, "text"), text: stringValue(raw.text) } as unknown as Part],
    }
  }
  if (type === "assistant") {
    return { info: mappedMessageInfo(sessionId, raw, "assistant"), parts: mapAssistantContent(sessionId, messageId, raw.content) }
  }
  const text = type === "shell" ? stringValue(raw.output) : stringValue(raw.text, stringValue(raw.summary))
  return {
    info: mappedMessageInfo(sessionId, raw, "assistant"),
    parts: text ? [{ ...basePart(sessionId, messageId, `${messageId}:text`, "text"), text } as unknown as Part] : [],
  }
}

/** Map an OpenCode 2 session info object into the legacy-compatible domain shape. */
export function mapOpenCode2Session(raw: unknown): Session {
  const value = record(raw)
  const location = record(value.location)
  const time = record(value.time)
  const model = record(value.model)
  return {
    id: stringValue(value.id),
    slug: stringValue(value.id),
    projectID: stringValue(value.projectID),
    ...(typeof value.workspaceID === "string" ? { workspaceID: value.workspaceID } : {}),
    directory: stringValue(location.directory),
    parentID: typeof value.parentID === "string" ? value.parentID : undefined,
    title: stringValue(value.title, "Untitled session"),
    version: "opencode2",
    agent: typeof value.agent === "string" ? value.agent : undefined,
    model: model.id || model.providerID ? {
      id: stringValue(model.id),
      providerID: stringValue(model.providerID),
      variant: typeof model.variant === "string" ? model.variant : undefined,
    } : undefined,
    cost: numberValue(value.cost),
    tokens: value.tokens as Session["tokens"],
    time: {
      created: numberValue(time.created),
      updated: numberValue(time.updated, numberValue(time.created)),
      archived: typeof time.archived === "number" ? time.archived : undefined,
    },
    revert: value.revert as Session["revert"],
  } as Session
}

/** Map an OpenCode 2 session message page into the existing chat history contract. */
export function mapOpenCode2MessagePage(raw: unknown, sessionId: string): Array<{ info: Message; parts: Part[] }> {
  const page = record(raw)
  const messages = Array.isArray(page.data) ? page.data : Array.isArray(raw) ? raw : []
  if (!Array.isArray(messages)) {
    log.warn(`OpenCode 2 session ${sessionId} returned a malformed message page`)
    return []
  }
  return messages.map((message) => mapMessage(sessionId, record(message)))
}

/** Convert the OpenCode 2 prompt admission response into the existing user-message shape. */
export function mapOpenCode2PromptAdmission(raw: unknown, sessionId: string): { info: Message; parts: Part[] } {
  const value = record(raw)
  const prompt = record(value.prompt)
  const text = stringValue(prompt.text)
  const messageId = stringValue(value.id, `${sessionId}:prompt`)
  return {
    info: mappedMessageInfo(sessionId, { id: messageId, type: "user", time: { created: numberValue(value.timeCreated, Date.now()) } }, "user"),
    parts: [{ ...basePart(sessionId, messageId, `${messageId}:text`, "text"), text } as unknown as Part],
  }
}
