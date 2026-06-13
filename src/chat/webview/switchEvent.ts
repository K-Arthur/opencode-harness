/**
 * Agent/model "switched" activity classification, shared with the host so the
 * webview renderers and the SessionStore placement logic agree on what counts
 * as a switch event. Single source of truth lives in the session layer.
 *
 * Why this matters: the event normalizer (SessionNextHandler) stores the FULL
 * event type on the activity block — e.g. `session.next.agent.switched` — not
 * the bare `agent.switched`. The renderers historically compared against the
 * bare form, so the comparison silently failed and these events rendered as
 * heavy verbose activity cards instead of the intended compact pill.
 */
export { isSwitchEventType } from "../../session/activityCoalesce"
