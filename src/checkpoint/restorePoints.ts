/**
 * Restore-point collection (audit §14.5 — checkpoint restore granularity).
 *
 * opencode anchors snapshots to message parts: `SnapshotPart {snapshot}`,
 * `StepStartPart {snapshot?}`, `StepFinishPart {snapshot?}`, and supports
 * `session.revert({ sessionID, messageID, partID?, snapshot? })` / `unrevert`.
 * Message-level revert is already wired (`SessionClient.revertMessage`). The
 * remaining gap is *granularity* + *surfacing*: turning the snapshot-bearing
 * parts of a session into an ordered "restore to here" rail (Cline-style time
 * travel), each entry carrying the precise revert coordinates.
 *
 * This module is the pure, DOM-free, IO-free core: messages/parts → RestorePoint[]
 * and RestorePoint → the SDK revert request. The host calls
 * `session.revert(buildRevertRequest(point))`.
 */

/** Minimal part shape we read (decoupled from canonical block/SDK types). */
export interface RestorePointPart {
  id: string
  type: string
  snapshot?: string
  tool?: string
  title?: string
}

export interface RestorePointMessage {
  id: string
  role: "user" | "assistant"
  time?: number
  parts: RestorePointPart[]
}

export type RestoreKind = "user-turn" | "step" | "snapshot"

export interface RestorePoint {
  /** Ordinal (0-based) in chronological order. */
  index: number
  messageID: string
  partID?: string
  snapshot: string
  label: string
  kind: RestoreKind
  time?: number
}

function labelFor(part: RestorePointPart, role: "user" | "assistant"): { kind: RestoreKind; label: string } {
  if (part.type === "step-start" || part.type === "step-finish") {
    return { kind: "step", label: part.title?.trim() || "Step checkpoint" }
  }
  if (role === "user") return { kind: "user-turn", label: "Before this prompt" }
  return { kind: "snapshot", label: part.tool ? `After ${part.tool}` : "Checkpoint" }
}

/**
 * Collect ordered restore points from a session's messages. One point per
 * snapshot-bearing part; consecutive duplicate snapshots are collapsed (the agent
 * re-emits the same snapshot across no-op steps).
 */
export function collectRestorePoints(messages: readonly RestorePointMessage[]): RestorePoint[] {
  const out: RestorePoint[] = []
  let lastSnapshot: string | undefined
  for (const msg of messages) {
    for (const part of msg.parts) {
      const snap = part.snapshot
      if (!snap) continue
      if (snap === lastSnapshot) continue
      lastSnapshot = snap
      const { kind, label } = labelFor(part, msg.role)
      out.push({
        index: out.length,
        messageID: msg.id,
        partID: part.id,
        snapshot: snap,
        label,
        kind,
        ...(msg.time !== undefined ? { time: msg.time } : {}),
      })
    }
  }
  return out
}

/** Build the `session.revert` request for a restore point (omits undefined fields). */
export function buildRevertRequest(
  sessionID: string,
  point: { messageID: string; partID?: string; snapshot?: string },
): { sessionID: string; messageID: string; partID?: string; snapshot?: string } {
  return {
    sessionID,
    messageID: point.messageID,
    ...(point.partID !== undefined ? { partID: point.partID } : {}),
    ...(point.snapshot !== undefined ? { snapshot: point.snapshot } : {}),
  }
}
