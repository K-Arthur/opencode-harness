import type { ChatMessage } from "../../types"

export interface MessageCounts {
  /** Messages with role "user" — one per user conversational turn. */
  userTurns: number
  /** Messages with role "assistant" — one per assistant conversational turn. */
  assistantTurns: number
  /** Messages with role "system" — activity/status cards, not counting as turns. */
  systemMessages: number
  /** tool-call blocks across all assistant messages. */
  toolCallBlocks: number
  /** All messages regardless of role — for storage/comparison, not display as "turns". */
  totalMessages: number
}

/**
 * Count messages by role and by block type.
 *
 * The critical distinction: user+assistant messages are *conversational turns*,
 * while system messages are activity/status cards.  Tool-call blocks live inside
 * assistant messages and must never be counted as separate messages.
 */
export function computeMessageCounts(messages: ChatMessage[]): MessageCounts {
  let userTurns = 0
  let assistantTurns = 0
  let systemMessages = 0
  let toolCallBlocks = 0

  for (const msg of messages) {
    switch (msg.role) {
      case "user":
        userTurns++
        break
      case "assistant":
        assistantTurns++
        break
      case "system":
        systemMessages++
        break
    }
    for (const block of msg.blocks) {
      const blockType = (block as Record<string, unknown>).type
      if (blockType === "tool-call" || blockType === "tool_call") {
        toolCallBlocks++
      }
    }
  }

  return {
    userTurns,
    assistantTurns,
    systemMessages,
    toolCallBlocks,
    totalMessages: messages.length,
  }
}

/**
 * Convenience: conversational turn count (user + assistant) useful for
 * session-list summaries and timeline display.
 */
export function turnCount(messages: ChatMessage[]): number {
  const c = computeMessageCounts(messages)
  return c.userTurns + c.assistantTurns
}
