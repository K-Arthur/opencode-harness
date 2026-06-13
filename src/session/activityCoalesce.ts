import type { ChatMessage } from "../types"

/**
 * Decision for how to record a system "activity" notification (model switched,
 * agent switched, compaction, provider retry, …).
 *
 * The same logical activity can be delivered more than once — rapid
 * re-delivery, an SSE reconnect, or the pending-event buffer replaying events
 * after a tab registers its cliSessionId. Previously each delivery minted a
 * fresh random id and was unconditionally appended, so identical activities
 * stacked as duplicate cards (e.g. two back-to-back "Model switched" cards).
 *
 * This collapses an *immediately repeated* identical activity into the
 * previous card by bumping its repeat count, while leaving genuinely
 * interleaved/non-adjacent activities as their own cards (so far-apart
 * legitimate repeats still surface near the bottom of the transcript).
 *
 * `signature` identifies an activity by content (eventType + title + detail).
 */
export type ActivityCoalesceResult =
  | { readonly kind: "append" }
  | { readonly kind: "coalesce"; readonly index: number; readonly repeatCount: number }

/**
 * Pure decision: does `signature` match the LAST message's activity block?
 * Returns `coalesce` (with the target index and the next repeat count) when it
 * does, otherwise `append`. Does not mutate `messages`.
 */
export function decideActivityCoalesce(
  messages: readonly ChatMessage[],
  signature: string,
): ActivityCoalesceResult {
  const index = messages.length - 1
  const last = messages[index]
  if (!last || last.role !== "system") return { kind: "append" }
  const block = last.blocks[0] as Record<string, unknown> | undefined
  if (!block || block.type !== "activity" || block.signature !== signature) {
    return { kind: "append" }
  }
  const prev = typeof block.repeatCount === "number" && block.repeatCount > 0 ? block.repeatCount : 1
  return { kind: "coalesce", index, repeatCount: prev + 1 }
}

/**
 * Agent/model "switched" activity classification. The normalizer stores the
 * FULL event type (`session.next.agent.switched`), so callers must match the
 * prefixed form as well as the bare `agent.switched`.
 */
export function isSwitchEventType(eventType: unknown): boolean {
  if (typeof eventType !== "string") return false
  return (
    eventType === "agent.switched" ||
    eventType === "model.switched" ||
    eventType.endsWith(".agent.switched") ||
    eventType.endsWith(".model.switched")
  )
}

/**
 * Where a switch marker should be inserted so it sits immediately BEFORE the
 * generation it configures, instead of stacking at the very bottom of the
 * transcript. `session.next.*` switch events are delivered at the END of a turn
 * (they describe the upcoming step's config), so a naive append drops them
 * below the assistant message they actually belong to.
 *
 * Rule: if the transcript currently ends in an assistant turn, insert before
 * the START of that trailing assistant run; otherwise (ends in a user/system
 * message — the next generation hasn't streamed yet) append at the end, which
 * still places the marker before the upcoming assistant message.
 */
export function switchInsertIndex(messages: readonly ChatMessage[]): number {
  if (messages.length === 0) return 0
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant") return messages.length
  let i = messages.length - 1
  while (i > 0 && messages[i - 1]?.role === "assistant") i--
  return i
}

export type SwitchPlacement =
  | { readonly kind: "insert"; readonly index: number }
  | { readonly kind: "coalesce"; readonly index: number; readonly repeatCount: number }

/**
 * Decide how to place a switch activity: coalesce into an identical switch that
 * already sits just before the insert point (preserving the ×N dedup even
 * though the marker is no longer at the array's end), otherwise insert at the
 * computed index. Pure; does not mutate `messages`.
 */
export function decideSwitchPlacement(
  messages: readonly ChatMessage[],
  signature: string,
): SwitchPlacement {
  const index = switchInsertIndex(messages)
  const prev = messages[index - 1]
  if (prev && prev.role === "system") {
    const block = prev.blocks[0] as Record<string, unknown> | undefined
    if (block && block.type === "activity" && block.signature === signature) {
      const prevCount =
        typeof block.repeatCount === "number" && block.repeatCount > 0 ? block.repeatCount : 1
      return { kind: "coalesce", index: index - 1, repeatCount: prevCount + 1 }
    }
  }
  return { kind: "insert", index }
}

/**
 * Build the stable content signature for an activity. Whitespace-normalised and
 * length-bounded so it is a stable, comparable key.
 */
export function activitySignature(
  eventType: string | undefined,
  title: string,
  detail: string | undefined,
): string {
  return `${eventType ?? ""}|${title}|${detail ?? ""}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}
