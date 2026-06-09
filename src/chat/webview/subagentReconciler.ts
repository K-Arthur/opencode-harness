import type { SubagentActivity } from "./types"

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

const MAX_COMPLETED_VISIBLE = 10

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
      result.push({ ...existing, ...inc })
    } else {
      result.push(inc)
    }
  }

  for (const prevActivity of prev) {
    if (incomingMap.has(prevActivity.id)) continue

    if (!TERMINAL_STATUSES.has(prevActivity.status)) {
      result.push({
        ...prevActivity,
        status: "completed",
        isLive: false,
        completedAt: prevActivity.completedAt ?? now,
      })
    } else {
      result.push(prevActivity)
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
