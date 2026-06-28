import type { SubagentActivity } from "./types"

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

const MAX_COMPLETED_VISIBLE = 10

/**
 * Compute the `isLive` flag from a normalized status string.
 *
 * The `isLive` property on SubagentActivity is a denormalized cache of "is this
 * subagent still running?". Host messages (subagent_update, run_activity_update)
 * do not always include `isLive`, and a naive `{...existing, ...incoming}` merge
 * preserves the stale `true` from when the subagent was running — even after the
 * status has transitioned to "completed". This helper is the single source of
 * truth: `isLive` is derived from `status`, never trusted from the wire.
 *
 * @param status - The normalized SubagentActivity status.
 * @returns true when the subagent is still running or pending.
 */
export function computeIsLive(status: string): boolean {
  return status === "running" || status === "pending" || status === "queued" || status === "waiting" || status === "unknown"
}

/**
 * Recompute the `isLive` flag and `completedAt` timestamp on an activity based
 * on its normalized status. Used after every merge to prevent stale live state.
 */
export function recomputeActivityLiveness(activity: SubagentActivity): SubagentActivity {
  const isLive = computeIsLive(activity.status)
  const isTerminal = TERMINAL_STATUSES.has(activity.status)
  const completedAt = isTerminal && !activity.completedAt ? Date.now() : activity.completedAt
  return { ...activity, isLive, completedAt }
}

export function reconcileSubagentStatuses(
  prev: SubagentActivity[],
  incoming: SubagentActivity[],
): SubagentActivity[] {
  const incomingMap = new Map(incoming.map(a => [a.id, a]))
  const result: SubagentActivity[] = []
  const now = Date.now()

  for (const inc of incoming) {
    const existing = prev.find(p => p.id === inc.id)
    if (existing) {
      // Merge then recompute liveness from the merged status so a stale
      // isLive=true from the previous running state cannot survive a
      // transition to completed/failed/cancelled.
      const merged = { ...existing, ...inc }
      result.push(recomputeActivityLiveness(merged))
    } else {
      // New subagent — recompute in case the incoming payload lacked isLive.
      result.push(recomputeActivityLiveness(inc))
    }
  }

  for (const prevActivity of prev) {
    if (incomingMap.has(prevActivity.id)) continue

    if (!TERMINAL_STATUSES.has(prevActivity.status)) {
      // A previously-live subagent that disappeared from the snapshot is
      // now completed. Recompute so isLive flips to false.
      const transitioned: SubagentActivity = {
        ...prevActivity,
        status: "completed",
        isLive: false,
        completedAt: prevActivity.completedAt ?? now,
      }
      result.push(transitioned)
    } else {
      // Already terminal — recompute to ensure isLive is consistent.
      result.push(recomputeActivityLiveness(prevActivity))
    }
  }

  return result
}

export function computeNewSubagentIds(
  prevIds: Set<string>,
  incoming: Array<{ id: string; name?: string }>,
): Set<string> {
  const newIds = new Set<string>()
  for (const item of incoming) {
    if (!prevIds.has(item.id)) {
      newIds.add(item.id)
    }
  }
  return newIds
}

export function capCompletedSubagents(
  activities: SubagentActivity[],
  maxCompleted: number = MAX_COMPLETED_VISIBLE,
): SubagentActivity[] {
  const live = activities.filter(a => a.isLive)
  const completed = activities
    .filter(a => !a.isLive && TERMINAL_STATUSES.has(a.status))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, maxCompleted)

  return [...live, ...completed]
}
