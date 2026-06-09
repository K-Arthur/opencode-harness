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
