import type { Message, Part } from "@opencode-ai/sdk"
import type { ChatMessage, Block } from "../types"

/**
 * Convert a single SDK Message + its Parts into a ChatMessage usable by the
 * webview renderer. Parts whose type does not map to a known block type are
 * dropped — the renderer ignores unknown block types anyway, but stripping
 * here keeps the persisted history compact and avoids leaking SDK internals
 * into globalState.
 */
export function sdkMessageToChatMessage(
  info: Message,
  parts: readonly Part[]
): ChatMessage | null {
  const role = info.role === "user" || info.role === "assistant" ? info.role : null
  if (!role) return null

  const blocks: Block[] = []

  for (const part of parts) {
    const block = partToBlock(part)
    if (block) blocks.push(block)
  }

  if (blocks.length === 0) return null

  const timestamp =
    "completed" in info.time && info.time.completed
      ? info.time.completed
      : info.time.created

  return {
    role,
    id: info.id,
    blocks,
    timestamp,
    sessionId: info.sessionID,
  }
}

function partToBlock(part: Part): Block | null {
  switch (part.type) {
    case "text": {
      if (part.synthetic || part.ignored) return null
      const text = part.text?.trim()
      if (!text) return null
      return { type: "text", text }
    }
    case "reasoning": {
      const text = part.text?.trim()
      if (!text) return null
      return { type: "thinking", text }
    }
    case "tool": {
      const state = part.state
      const status = state?.status
      const isError = status === "error"
      const isCompleted = status === "completed"
      const result =
        isError && "error" in state ? state.error
          : isCompleted && "output" in state ? state.output
          : ""
      return {
        type: "tool_call",
        toolName: part.tool,
        args: state && "input" in state ? state.input : undefined,
        result,
        state: isError ? "error" : isCompleted ? "completed" : "running",
      }
    }
    case "file": {
      // Only carry image attachments through — other file refs are echoed in
      // the assistant's text already.
      if (part.mime?.startsWith("image/") && part.url) {
        return {
          type: "image",
          data: part.url,
          mimeType: part.mime,
        }
      }
      return null
    }
    default:
      return null
  }
}

/** Convert a list of SDK message+parts pairs to ChatMessages, preserving order. */
export function sdkMessagesToChatMessages(
  rows: ReadonlyArray<{ info: Message; parts: Part[] }>
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const row of rows) {
    const msg = sdkMessageToChatMessage(row.info, row.parts)
    if (msg) out.push(msg)
  }
  return out
}
