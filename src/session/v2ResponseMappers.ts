import type {
  Session,
  Message,
  Part,
  SnapshotFileDiff,
} from "@opencode-ai/sdk/v2"
import { log } from "../utils/outputChannel"
import {
  expectString,
  expectNumber,
  expectObject,
  expectArray,
  expectEnum,
  validateSession,
  validateAgent,
} from "./responseValidator"

/**
 * v2→domain adapter/mapper.
 *
 * The v2 SDK client returns raw `Record<string, unknown>` from HTTP calls.
 * These mappers validate and cast to the typed v2 SDK domain types.
 *
 * Uses runtime validation at transport boundaries to catch contract drift
 * early. On validation failure, the field is set to a safe default (empty
 * string, 0, or undefined) and a warning is logged. This prevents one
 * unexpected field from crashing the entire extension.
 */
export function mapV2Session(v2: Record<string, unknown>): Session {
  const validated = validateSession(v2)
  const timeRaw = expectObject(v2.time, "session.time")
  return {
    id: validated.id || (v2.id as string) || "",
    slug: (v2.slug as string) || validated.id || "",
    projectID: validated.projectID || (v2.projectID as string) || "",
    directory: validated.directory || (v2.directory as string) || "",
    parentID: validated.parentID || (v2.parentID as string | undefined),
    summary: validated.summary || (v2.summary
      ? {
          additions: (v2.summary as Record<string, unknown>).additions as number || 0,
          deletions: (v2.summary as Record<string, unknown>).deletions as number || 0,
          files: (v2.summary as Record<string, unknown>).files as number || 0,
          diffs: undefined,
        }
      : undefined),
    share: validated.share || (v2.share ? { url: (v2.share as Record<string, unknown>).url as string || "" } : undefined),
    title: validated.title || (v2.title as string) || "",
    version: validated.version || (v2.version as string) || "",
    time: {
      created: validated.time.created || (timeRaw?.created as number) || 0,
      updated: validated.time.updated || (timeRaw?.updated as number) || 0,
      compacting: validated.time.compacting || (timeRaw?.compacting as number | undefined),
      archived: validated.time.archived,
    },
    revert: validated.revert || (v2.revert
      ? {
          messageID: (v2.revert as Record<string, unknown>).messageID as string || "",
          partID: (v2.revert as Record<string, unknown>).partID as string | undefined,
          snapshot: (v2.revert as Record<string, unknown>).snapshot as string | undefined,
          diff: (v2.revert as Record<string, unknown>).diff as string | undefined,
        }
      : undefined),
    agent: validated.agent || (v2.agent as string | undefined),
    model: validated.model || (v2.model
      ? {
          id: (v2.model as Record<string, unknown>).id as string || "",
          providerID: (v2.model as Record<string, unknown>).providerID as string || "",
          variant: (v2.model as Record<string, unknown>).variant as string | undefined,
        }
      : undefined),
    cost: v2.cost as number | undefined,
    tokens: v2.tokens as Session["tokens"],
    metadata: v2.metadata as Record<string, unknown> | undefined,
    permission: v2.permission as Session["permission"],
  }
}

export function mapV2SessionArray(v2Array: Array<Record<string, unknown>>): Session[] {
  return v2Array.map(mapV2Session)
}

export function mapV2Message(v2: Record<string, unknown>): Message {
  if (!v2 || typeof v2 !== "object") {
    log.warn("mapV2Message received non-object, returning stub")
    return { role: "user", id: "", sessionID: "", time: { created: 0 }, agent: "", model: { providerID: "", modelID: "" } } as Message
  }
  const role = v2.role as string
  if (role === "assistant") {
    return {
      ...v2,
      role: "assistant",
      id: (v2.id as string) || "",
      sessionID: (v2.sessionID as string) || "",
      time: { created: ((v2.time as Record<string, unknown>)?.created as number) || 0, completed: (v2.time as Record<string, unknown>)?.completed as number | undefined },
      parentID: (v2.parentID as string) || "",
      modelID: (v2.modelID as string) || "",
      providerID: (v2.providerID as string) || "",
      mode: (v2.mode as string) || "",
      agent: (v2.agent as string) || "",
      path: (v2.path as { cwd: string; root: string }) || { cwd: "", root: "" },
      cost: (v2.cost as number) || 0,
      tokens: (v2.tokens as { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }) || { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as Message
  }
  return {
    ...v2,
    role: "user",
    id: (v2.id as string) || "",
    sessionID: (v2.sessionID as string) || "",
    time: { created: ((v2.time as Record<string, unknown>)?.created as number) || 0 },
    agent: (v2.agent as string) || "",
    model: (v2.model as { providerID: string; modelID: string }) || { providerID: "", modelID: "" },
  } as Message
}

export function mapV2Part(v2: Record<string, unknown>): Part {
  if (!v2 || typeof v2 !== "object") {
    log.warn("mapV2Part received non-object, returning stub text part")
    return { type: "text", id: "", sessionID: "", messageID: "", text: "" } as Part
  }
  const type = v2.type as string
  if (type === "text") {
    return {
      type: "text",
      id: (v2.id as string) || "",
      sessionID: (v2.sessionID as string) || "",
      messageID: (v2.messageID as string) || "",
      text: (v2.text as string) || "",
      synthetic: v2.synthetic as boolean | undefined,
      ignored: v2.ignored as boolean | undefined,
    } as Part
  }
  if (type === "tool") {
    return {
      type: "tool",
      id: (v2.id as string) || "",
      sessionID: (v2.sessionID as string) || "",
      messageID: (v2.messageID as string) || "",
      callID: (v2.callID as string) || "",
      tool: (v2.tool as string) || "",
      state: (v2.state as Record<string, unknown>) || { status: "pending", input: {}, raw: "" },
      metadata: v2.metadata as Record<string, unknown> | undefined,
    } as Part
  }
  if (type === "file") {
    return {
      type: "file",
      id: (v2.id as string) || "",
      sessionID: (v2.sessionID as string) || "",
      messageID: (v2.messageID as string) || "",
      mime: (v2.mime as string) || "",
      url: (v2.url as string) || "",
      filename: v2.filename as string | undefined,
      source: v2.source as { text: { value: string; start: number; end: number }; type: "file" | "symbol" | "resource"; path?: string; uri?: string; clientName?: string } | undefined,
    } as Part
  }
  if (type === "reasoning") {
    return {
      type: "reasoning",
      id: (v2.id as string) || "",
      sessionID: (v2.sessionID as string) || "",
      messageID: (v2.messageID as string) || "",
      text: (v2.text as string) || "",
      time: (v2.time as { start: number; end?: number }) || { start: 0 },
      metadata: v2.metadata as Record<string, unknown> | undefined,
    } as Part
  }
  return { ...v2, type: type || "text" } as Part
}

export function mapV2MessageWithParts(
  v2: Record<string, unknown>,
): { info: Message; parts: Part[] } {
  return {
    info: mapV2Message(expectObject(v2.info, "messageWithParts.info") ?? {}),
    parts: expectArray(v2.parts, "messageWithParts.parts").map(r => mapV2Part(r as Record<string, unknown>)),
  }
}

export function mapV2MessageWithPartsArray(
  v2Array: Array<Record<string, unknown>>,
): Array<{ info: Message; parts: Part[] }> {
  return v2Array.map(mapV2MessageWithParts)
}

function mapV2SnapshotFileDiff(v2: Record<string, unknown>): SnapshotFileDiff {
  return {
    file: expectString(v2.file, "snapshotFileDiff.file"),
    patch: expectString(v2.patch, "snapshotFileDiff.patch"),
    additions: expectNumber(v2.additions, "snapshotFileDiff.additions") ?? 0,
    deletions: expectNumber(v2.deletions, "snapshotFileDiff.deletions") ?? 0,
    status: expectEnum<"added" | "deleted" | "modified">(v2.status, ["added", "deleted", "modified"] as const, "snapshotFileDiff.status", undefined),
  }
}

export function mapV2Agent(v2: Record<string, unknown>): { name: string; description?: string; mode: string; builtIn: boolean } {
  return {
    name: v2.name as string || "",
    description: v2.description as string | undefined,
    mode: v2.mode as string || "",
    builtIn: (v2.native as boolean) ?? false,
  }
}
