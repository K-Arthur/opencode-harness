import type { ElementRefs } from "./dom"
import type { Todo, SubagentActivity, SessionState, ChatMessage } from "./types"
import type { ScrollMarkerDeps } from "./ui/scrollMarkers"
import { setupTodosPanel } from "./todos-panel"
import { setupActivityPanel } from "./activity-panel"
import { setupTasksPanel } from "./tasks-panel"
import { setupTerminalPanel } from "./terminal-panel"
import { setupSkillsModal } from "./skills-modal"
import { setupSubagentPanel, type SubagentPanelApi } from "./subagent-panel"
import { setupSubagentDetailView, type SubagentDetailViewApi } from "./subagentDetailView"
import { scrollToTurn as scrollToTurnModule } from "./ui/scrollMarkers"
import { toolPartialStore } from "./toolPartialStore"
import { openKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal"
import { webviewLog } from "./streamHandlers"

/**
 * Dependencies required by the todo/skill/subagent panel setup.
 * Threaded explicitly from the main IIFE to avoid closure capture.
 */
export interface TodoSubagentSetupDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
  stateManager: {
    getState: () => { activeSessionId: string | null }
    getSession: (id: string) => SessionState | undefined
    save: () => void
    setSubagentActivities: (id: string, activities: SubagentActivity[]) => void
  }
  scrollMarkerDeps: ScrollMarkerDeps
  toggleTodo: (todoOrId: string | Todo) => void
  deleteTodo: (todoId: string) => void
  editUserTodo: (todoId: string, newContent: string) => void
  addUserTodo: (content: string) => void
  syncPanelVisibilityToHost: () => void
  abortStream: () => void
  pauseActiveAnchorForReflow: (ms?: number) => void
  setSubagentPanelOpen: (open: boolean) => void
  requestSubagentActivities: (sessionId?: string) => void
  restoreSubagentDetailFocus: () => void
  isLiveSubagent: (activity: SubagentActivity) => boolean
  updateSubagentBadge: (count: number) => void
  getActiveSubagentId: () => string | null
  setActiveSubagentId: (id: string | null) => void
  setSubagentDetailInvoker: (el: HTMLElement | null) => void
}

/**
 * Panel APIs returned by setupTodoSubagentPanels for the caller to assign
 * to IIFE-local variables.
 */
export interface TodoSubagentPanelApis {
  todosPanelApi: ReturnType<typeof setupTodosPanel>
  activityPanelApi: ReturnType<typeof setupActivityPanel>
  tasksPanelApi: ReturnType<typeof setupTasksPanel>
  terminalPanelApi: ReturnType<typeof setupTerminalPanel>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- skillsModalApi is intentionally any per existing policy
  skillsModalApi: any
  subagentDetailViewApi: SubagentDetailViewApi | undefined
  subagentPanelApi: SubagentPanelApi | undefined
}

/**
 * Sets up the todos, activity, tasks, terminal, skills, and subagent panels,
 * wires their toggle buttons, and registers the subagent popout and shortcuts
 * help button listeners. Extracted from main.ts to reduce the god-module's
 * surface.
 *
 * @param deps - Explicit closure dependencies from the main IIFE.
 * @returns The panel API handles for the caller to store in IIFE-local variables.
 */
export function setupTodoSubagentPanelsImpl(deps: TodoSubagentSetupDeps): TodoSubagentPanelApis {
  const {
    els,
    vscode,
    stateManager,
    scrollMarkerDeps,
    toggleTodo,
    deleteTodo,
    editUserTodo,
    addUserTodo,
    syncPanelVisibilityToHost,
    abortStream,
    pauseActiveAnchorForReflow,
    setSubagentPanelOpen,
    requestSubagentActivities,
    restoreSubagentDetailFocus,
    isLiveSubagent,
    updateSubagentBadge,
    getActiveSubagentId,
    setActiveSubagentId,
    setSubagentDetailInvoker,
  } = deps

  const todosPanelApi = setupTodosPanel(els, {
    onToggleTodo: toggleTodo,
    onDeleteTodo: deleteTodo,
    onEditTodo: editUserTodo,
    onAddTodo: addUserTodo,
    onPanelClose: () => { syncPanelVisibilityToHost() },
    postMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
    getActiveFilter: () => {
      const sid = stateManager.getState().activeSessionId
      const session = sid ? stateManager.getSession(sid) : undefined
      return session?.todoFilter ?? 'all'
    },
    setActiveFilter: (filter) => {
      const sid = stateManager.getState().activeSessionId
      const session = sid ? stateManager.getSession(sid) : undefined
      if (session) {
        session.todoFilter = filter
        stateManager.save()
      }
    },
  })
  const activityPanelApi = setupActivityPanel(els, {
    getMessages: (sessionId) => stateManager.getSession(sessionId)?.messages,
    isStreaming: (sessionId) => stateManager.getSession(sessionId)?.isStreaming ?? false,
    getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
    getFilter: (sessionId) => stateManager.getSession(sessionId)?.activityFilter ?? "all",
    setFilter: (sessionId, filter) => {
      const session = stateManager.getSession(sessionId)
      if (!session) return
      session.activityFilter = filter
      stateManager.save()
    },
    onJump: (anchorMessageId) => scrollToTurnModule(scrollMarkerDeps, anchorMessageId),
    onPanelClose: () => { syncPanelVisibilityToHost() },
  })
  const tasksPanelApi = setupTasksPanel(els, {
    getMessages: (sessionId) => stateManager.getSession(sessionId)?.messages,
    isStreaming: (sessionId) => stateManager.getSession(sessionId)?.isStreaming ?? false,
    getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
    getFilter: (sessionId) => stateManager.getSession(sessionId)?.commandFilter ?? "all",
    setFilter: (sessionId, filter) => {
      const session = stateManager.getSession(sessionId)
      if (!session) return
      session.commandFilter = filter
      stateManager.save()
    },
    getLiveToolOutput: (sessionId, toolId) => toolPartialStore.get(sessionId, toolId),
    onJump: (anchorMessageId) => scrollToTurnModule(scrollMarkerDeps, anchorMessageId),
    onCopy: (text) => vscode.postMessage({ type: "copy_text", text }),
    onOpenTerminal: (command, cwd, autorun) => vscode.postMessage({ type: "open_terminal", command, cwd, autorun }),
    onCancel: (payload) => {
      vscode.postMessage({ type: "cancel_tool", ...payload })
      abortStream()
    },
    onPanelClose: () => { syncPanelVisibilityToHost() },
  })
  const terminalPanelApi = setupTerminalPanel(els, {
    postMessage: (msg) => vscode.postMessage(msg),
    onPanelClose: () => { syncPanelVisibilityToHost() },
  })
  const skillsModalApi = setupSkillsModal(els, {
    onToggleSkill: (skillId: string, enabled: boolean) => vscode.postMessage({ type: "toggle_skill", skillId, enabled }),
    onSearchSkills: (query: string) => vscode.postMessage({ type: "search_skills", query }),
  })
  const subagentDetailViewApi = setupSubagentDetailView(els, {
    onBack: () => { subagentPanelApi?.open(); restoreSubagentDetailFocus() },
    onClose: () => { setActiveSubagentId(null); restoreSubagentDetailFocus() },
    onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
    onOpenSession: (activity: SubagentActivity) => {
      if (activity.sessionId) vscode.postMessage({ type: "open_subagent_session", childSessionId: activity.sessionId, title: activity.name })
    },
  })
  const subagentPanelApi = setupSubagentPanel(els, {
    onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
    onOpenSession: (activity: SubagentActivity) => {
      if (activity.sessionId) vscode.postMessage({ type: "open_subagent_session", childSessionId: activity.sessionId, title: activity.name })
    },
    onOpenDetail: (activity: SubagentActivity) => {
      setSubagentDetailInvoker(document.activeElement as HTMLElement | null)
      subagentPanelApi?.open()
      const normalizedId = activity.id.startsWith("subagent:")
        ? activity.id.slice("subagent:".length)
        : activity.id
      setActiveSubagentId(normalizedId)
      vscode.postMessage({ type: "get_subagent_detail", sessionId: stateManager.getState().activeSessionId ?? "", subagentId: activity.id })
      subagentDetailViewApi?.open(activity)
      subagentDetailViewApi?.renderLoading?.()
    },
    onClearCompleted: () => {
      const sid = stateManager.getState().activeSessionId
      if (sid) {
        const session = stateManager.getSession(sid)
        if (session?.subagentActivities) {
          const live = session.subagentActivities.filter(isLiveSubagent)
          stateManager.setSubagentActivities(sid, live)
          subagentPanelApi?.renderActivities(live)
          updateSubagentBadge(live.length)
        }
      }
    },
    onMarkRead: (subagentId: string) => {
      const sid = stateManager.getState().activeSessionId
      if (sid) {
        vscode.postMessage({ type: "mark_subagent_read", sessionId: sid, subagentId })
      }
    },
    onPanelClose: () => { syncPanelVisibilityToHost() },
  })

  els.activityToggleBtn.addEventListener("click", () => {
    pauseActiveAnchorForReflow()
    activityPanelApi?.toggle?.()
    syncPanelVisibilityToHost()
  })
  els.tasksToggleBtn.addEventListener("click", () => {
    pauseActiveAnchorForReflow()
    tasksPanelApi?.toggle?.()
    syncPanelVisibilityToHost()
  })
  els.terminalToggleBtn.addEventListener("click", () => {
    pauseActiveAnchorForReflow()
    terminalPanelApi?.toggle()
    syncPanelVisibilityToHost()
  })
  els.subagentsToggleBtn.addEventListener("click", () => {
    pauseActiveAnchorForReflow()
    const wasOpen = subagentPanelApi?.isOpen()
    if (wasOpen) {
      setSubagentPanelOpen(false)
    } else {
      setSubagentPanelOpen(true)
      requestSubagentActivities()
    }
    syncPanelVisibilityToHost()
  })
  window.addEventListener("oc:open-subagent-panel", () => {
    setSubagentPanelOpen(true)
    requestSubagentActivities()
    requestAnimationFrame(() => {
      const firstItem = els.subagentList?.querySelector<HTMLElement>(".subagent-item")
      if (firstItem) {
        firstItem.scrollIntoView({ block: "nearest", behavior: "smooth" })
        firstItem.classList.add("subagent-highlight-pulse")
        setTimeout(() => firstItem.classList.remove("subagent-highlight-pulse"), 3000)
      }
    })
  })

  const popoutBtn = document.getElementById("subagent-detail-popout-btn")
  popoutBtn?.addEventListener("click", () => {
    const sid = stateManager.getState().activeSessionId
    if (!sid) {
      webviewLog("[main] open_subagent_detail: no active session")
      return
    }
    const activeSubagentId = getActiveSubagentId()
    if (!activeSubagentId) {
      webviewLog("[main] open_subagent_detail: no active subagent in detail view")
      return
    }
    vscode.postMessage({
      type: "open_subagent_detail",
      sessionId: sid,
      subagentId: activeSubagentId,
    })
  })

  const shortcutsHelpBtn = document.getElementById("shortcuts-help-btn")
  shortcutsHelpBtn?.addEventListener("click", () => openKeyboardShortcutsModal())

  return {
    todosPanelApi,
    activityPanelApi,
    tasksPanelApi,
    terminalPanelApi,
    skillsModalApi,
    subagentDetailViewApi,
    subagentPanelApi,
  }
}
