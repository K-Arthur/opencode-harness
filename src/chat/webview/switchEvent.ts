/**
 * Agent/model "switched" activity classification.
 *
 * The event normalizer (SessionNextHandler) stores the FULL event type on the
 * activity block — e.g. `session.next.agent.switched` — not the bare
 * `agent.switched`. The message/badge renderers historically compared against
 * the bare form, so the comparison silently failed and these events rendered as
 * heavy verbose activity cards (with the raw `session.next.*` meta line) instead
 * of the intended compact pill. Matching both the bare and prefixed forms keeps
 * the renderers correct regardless of which shape the normalizer emits.
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
