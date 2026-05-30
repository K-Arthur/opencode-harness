import type { ChatMessage } from "../../types"

/**
 * Insert `msg` into `messages`, replacing any existing entry that shares the
 * same non-empty `id`. Returns true when an existing entry was replaced.
 *
 * Why this exists (C1): the streaming path populates `session.messages` with
 * the in-flight assistant message during `handleStreamStart`, then `stream_end`
 * routes the server's authoritative blocks back through `addMessage` using the
 * SAME message id. A bare `push` left two array entries with one id — the DOM
 * deduped visually but the duplicate persisted to globalState and reappeared on
 * reload. Upserting by id keeps the array a faithful 1:1 with what is rendered.
 *
 * Messages without an id can never be deduplicated and are always appended.
 */
export function upsertMessageById(messages: ChatMessage[], msg: ChatMessage): boolean {
  if (msg.id) {
    const idx = messages.findIndex((m) => m.id === msg.id)
    if (idx >= 0) {
      messages[idx] = msg
      return true
    }
  }
  messages.push(msg)
  return false
}
