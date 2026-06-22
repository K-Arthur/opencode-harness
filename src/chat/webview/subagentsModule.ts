import type { SubagentActivity, SessionState, RunActivitySnapshot } from "./types"
import { webviewLog } from "./streamHandlers"

export interface SubagentsModuleDeps {
  stateManager: {
    getState: () => { activeSessionId: string | null }
    getSession: (id: string) => SessionState | undefined
    getActiveSession: () => SessionState | undefined
    save: () => void
    setSubagentActivities: (id: string, activities: SubagentActivity[]) => void
  }
  subagentPanelApi: {
    renderActivities: (activities: SubagentActivity[]) => void
    isOpen: () => boolean
    open: () => void
    close: () => void
  } | undefined
  els: {
    subagentsBadge?: HTMLElement | null
    subagentsToggleBtn: HTMLElement
    subagentDetailView: HTMLElement
    subagentDetailBackBtn: HTMLElement
  }
  vscode: { postMessage: (msg: Record<string, unknown>) => void }
}

export function createSubagentsModule(deps: SubagentsModuleDeps) {
  const subagentDismissedBySession = new Set<string>()
  const knownSubagentIdsBySession = new Map<string, Set<string>>()
  let activeSubagentId: string | null = null
  let subagentDetailInvoker: HTMLElement | null = null
  let _panelApi: SubagentsModuleDeps["subagentPanelApi"] = deps.subagentPanelApi

  const isLiveSubagent = (activity: SubagentActivity): boolean =>
    activity.status === "running" || activity.status === "pending"

  function normalizeSubagentStatus(status: string): SubagentActivity["status"] {
    switch (status) {
      case "queued":
      case "waiting":
      case "running":
      case "completed":
      case "failed":
      case "cancelled":
      case "pending":
      case "unknown":
        return status
      default:
        return "unknown"
    }
  }

  function mapSubagentRunStatusToCardState(status: string | undefined): string | undefined {
    switch (status) {
      case "queued":
      case "waiting":
      case "unknown":
        return "pending"
      case "running":
        return "running"
      case "completed":
        return "completed"
      case "failed":
      case "cancelled":
        return "error"
      default:
        return status
    }
  }

  function getSubagentActivities(sessionId?: string): SubagentActivity[] {
    const session = sessionId ? deps.stateManager.getSession(sessionId) : deps.stateManager.getActiveSession() ?? undefined
    return session?.subagentActivities ?? []
  }

  function updateSubagentBadge(activeCount: number): void {
    const badge = deps.els.subagentsBadge
    if (!badge) return
    if (activeCount > 0) {
      badge.textContent = String(activeCount)
      badge.classList.remove("hidden")
      deps.els.subagentsToggleBtn.setAttribute("aria-label", `Toggle subagent panel (${activeCount} running)`)
    } else {
      badge.classList.add("hidden")
      deps.els.subagentsToggleBtn.setAttribute("aria-label", "Toggle subagent panel")
    }
  }

  function refreshSubagentPanel(sessionId?: string): void {
    const activities = getSubagentActivities(sessionId)
    _panelApi?.renderActivities(activities)
    updateSubagentBadge(activities.filter(isLiveSubagent).length)
  }

  function setSubagentPanelOpen(open: boolean): void {
    if (open) {
      _panelApi?.open()
      const sid = deps.stateManager.getState().activeSessionId
      if (sid) subagentDismissedBySession.delete(sid)
    } else {
      _panelApi?.close()
      const sid = deps.stateManager.getState().activeSessionId
      if (sid) subagentDismissedBySession.add(sid)
    }
    deps.els.subagentsToggleBtn.setAttribute("aria-pressed", String(open))
  }

  function requestSubagentActivities(sessionId?: string): void {
    const sid = sessionId ?? deps.stateManager.getState().activeSessionId ?? undefined
    if (sid) {
      deps.vscode.postMessage({ type: "get_subagent_activities", sessionId: sid })
    }
  }

  function mergeSubagentActivities(sessionId: string, incoming: SubagentActivity[]): SubagentActivity[] {
    const session = deps.stateManager.getSession(sessionId)
    if (!session) return []
    const merged = new Map<string, SubagentActivity>()
    for (const existing of session.subagentActivities ?? []) {
      merged.set(existing.id, existing)
    }
    for (const activity of incoming) {
      merged.set(activity.id, { ...merged.get(activity.id), ...activity })
    }
    const activities = [...merged.values()]
    deps.stateManager.setSubagentActivities(sessionId, activities)
    if (sessionId === deps.stateManager.getState().activeSessionId) {
      _panelApi?.renderActivities(activities)
      updateSubagentBadge(activities.filter(isLiveSubagent).length)
    }
    return activities
  }

  function runSubagentsToActivities(activity: RunActivitySnapshot): SubagentActivity[] {
    return (activity.subagents ?? []).map((subagent): SubagentActivity => {
      const rawStatus = typeof subagent.status === "string" ? subagent.status : "unknown"
      const status = normalizeSubagentStatus(rawStatus)
      return {
        id: subagent.childSessionId || subagent.id,
        sessionId: subagent.childSessionId,
        parentSessionId: activity.cliSessionId || activity.tabId,
        name: subagent.agentName || "subagent",
        status,
        currentActivity: subagent.currentActivity,
        isLive: rawStatus === "queued" || rawStatus === "running" || rawStatus === "waiting" || rawStatus === "unknown",
        unreadActivityCount: subagent.unreadActivityCount ?? 0,
        error: subagent.error,
      }
    })
  }

  function restoreSubagentDetailFocus(): void {
    const invoker = subagentDetailInvoker
    subagentDetailInvoker = null
    if (invoker && invoker.isConnected && typeof invoker.focus === "function") {
      invoker.focus({ preventScroll: true })
    }
  }

  function cleanupSession(sessionId: string): void {
    subagentDismissedBySession.delete(sessionId)
    knownSubagentIdsBySession.delete(sessionId)
  }

  return {
    normalizeSubagentStatus,
    isLiveSubagent,
    mapSubagentRunStatusToCardState,
    getSubagentActivities,
    updateSubagentBadge,
    refreshSubagentPanel,
    setSubagentPanelOpen,
    requestSubagentActivities,
    mergeSubagentActivities,
    runSubagentsToActivities,
    restoreSubagentDetailFocus,
    cleanupSession,
    subagentDismissedBySession,
    knownSubagentIdsBySession,
    getActiveSubagentId: () => activeSubagentId,
    setActiveSubagentId: (id: string | null) => { activeSubagentId = id },
    getSubagentDetailInvoker: () => subagentDetailInvoker,
    setSubagentDetailInvoker: (el: HTMLElement | null) => { subagentDetailInvoker = el },
    setPanelApi: (api: typeof _panelApi) => { _panelApi = api },
  }
}