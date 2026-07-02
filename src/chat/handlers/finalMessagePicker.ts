/**
 * Order-independent selection of the most recent assistant message from a
 * server message list.
 *
 * The opencode server's `session.messages` endpoint returns messages in
 * DIFFERENT orders depending on the query: with `limit` it returns the last
 * N messages NEWEST-first (SQL `orderBy desc`, unreversed), without `limit`
 * it pages and reverses to OLDEST-first. Any consumer that relies on array
 * position (e.g. `[...messages].reverse().find(...)`) silently picks the
 * wrong message on one of the two paths — in the limit path it picked the
 * OLDEST assistant in the window, replacing the just-streamed output with a
 * previous turn's content at stream end.
 *
 * Selection key: `info.time.created` (ms) when present, with the message id
 * as tiebreak — opencode ids (`msg_<timestamp-ordered>`) sort
 * lexicographically by creation time, so the id alone is a safe fallback
 * when `time.created` is missing.
 */

interface MessageInfoLike {
  role?: string
  id?: string
  time?: { created?: number }
}

export interface MessageWithPartsLike {
  info: unknown
  parts: unknown[]
}

export function pickLatestAssistant<T extends MessageWithPartsLike>(messages: readonly T[]): T | undefined {
  let latest: T | undefined
  let latestCreated = -Infinity
  let latestId = ""

  for (const message of messages) {
    const info = message.info as MessageInfoLike
    if (info?.role !== "assistant") continue
    const created = typeof info.time?.created === "number" ? info.time.created : 0
    const id = typeof info.id === "string" ? info.id : ""
    if (
      latest === undefined ||
      created > latestCreated ||
      (created === latestCreated && id > latestId)
    ) {
      latest = message
      latestCreated = created
      latestId = id
    }
  }

  return latest
}
