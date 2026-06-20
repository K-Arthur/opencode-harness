import type { ElementRefs } from "./dom"
import { switchToTab } from "./tabs"
import type { ScrollAnchor } from "./scrollAnchor"
import { getActiveMessageList, scrollToBottom } from "./dom"
import { selectDisplayedUsage } from "./tokenDisplayPolicy"
import * as questionBar from "./questionBar"
import type { SessionState } from "./types"

/**
 * Dependencies required by the tab-switching logic.
 * Threaded explicitly from the main IIFE to avoid closure capture.
 */
export interface TabSwitcherDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
  stateManager: {
    getActiveSession: () => SessionState | undefined
    setDraftText: (id: string, text: string) => void
    setActiveSession: (id: string) => boolean
    getDraftText: (id: string) => string
    getSession: (id: string) => SessionState | undefined
    getState: () => { activeSessionId: string | null; sessions: Record<string, SessionState> }
    getScrollPosition: (id: string) => number
    getGlobalVariant: () => string
  }
  hideWelcomeView: () => void
  syncModeUI: () => void
  composer: {
    syncSteerModeUI: () => void
    autoResizeTextarea: () => void
    probeActiveRun?: () => void
    renderQueue: (tabId: string) => void
  }
  syncSteerAffordance: () => void
  updateTabBar: () => void
  pendingPermissionBySession: Map<string, {
    permissionId: string
    permissionType?: string
    pattern?: string | string[]
    title: string
  }>
  renderPermissionBar: (sid: string, req: { permissionId: string; permissionType?: string; pattern?: string | string[]; title: string }) => void
  hidePermissionBar: () => void
  modelDropdown: {
    setCurrentModel: (model: string) => void
  }
  variantSelector: {
    setVariant: (variant: string) => void
  }
  resetContextUsagePanel: () => void
  ctxDropdownApi: { updateUsage: (data: Record<string, unknown>) => void } | null
  updateContextUsageBar: (pct: number, tokens: number, maxTokens: number) => void
  renderMethodologyChip: (sessionId: string) => void
  updateCostDisplay: (sessionId: string) => void
  updateTokenDisplay: (usage?: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }) => void
  updateContextBarFromSession: (sessionId: string) => void
  clearTokenDisplay: () => void
  cfDropdownApi: {
    setCurrentSession: (tabId: string) => void
    updateChangedFiles: (tabId: string, files: Array<{ path: string; added: number; removed: number }>) => void
  } | null
  triggerTodosRender: (sessionId: string, options?: { autoOpen?: boolean }) => void
  refreshActivityAndTasks: (sessionId?: string) => void
  attachScrollPersistence: (tabId: string, msgList: HTMLDivElement) => void
  scrollAnchors: Map<string, ScrollAnchor>
  restoreScrollPosition: (tabId: string, msgList: HTMLDivElement, autoScrollWhenUnset?: boolean) => void
  applyTimelineVisibility: (sessionId?: string) => void
  showSecondaryNav: () => void
  updateSendButtonIcon: (isStreaming?: boolean, streamCapacity?: unknown) => void
}

/**
 * Switches the active tab, coordinating scroll anchors, stream handlers, state,
 * DOM panels, model/cost/token displays, permission bar, question bar, and
 * todos/activity/tasks panels. Extracted from main.ts to reduce the
 * god-module's surface.
 *
 * @param deps - Explicit closure dependencies from the main IIFE.
 * @param tabId - The session id to switch to.
 * @param notifyHost - Whether to post a switch_tab message to the extension host.
 */
export function switchTabImpl(deps: TabSwitcherDeps, tabId: string, notifyHost = true): void {
  const {
    els,
    vscode,
    stateManager,
    hideWelcomeView,
    syncModeUI,
    composer,
    syncSteerAffordance,
    updateTabBar,
    pendingPermissionBySession,
    renderPermissionBar,
    hidePermissionBar,
    modelDropdown,
    variantSelector,
    resetContextUsagePanel,
    ctxDropdownApi,
    updateContextUsageBar,
    renderMethodologyChip,
    updateCostDisplay,
    updateTokenDisplay,
    updateContextBarFromSession,
    clearTokenDisplay,
    cfDropdownApi,
    triggerTodosRender,
    refreshActivityAndTasks,
    attachScrollPersistence,
    scrollAnchors,
    restoreScrollPosition,
    applyTimelineVisibility,
    showSecondaryNav,
    updateSendButtonIcon,
  } = deps

  // Persist draft from the current (old) tab before switching
  const prevSession = stateManager.getActiveSession()
  if (prevSession) stateManager.setDraftText(prevSession.id, els.promptInput.value)

  if (!stateManager.setActiveSession(tabId)) return
  switchToTab(els, tabId)
  hideWelcomeView()
  if (notifyHost) {
    vscode.postMessage({ type: "switch_tab", sessionId: tabId })
  }
  syncModeUI()
  composer.syncSteerModeUI()
  syncSteerAffordance()
  updateTabBar()
  // Restore this tab's pending permission, or hide the bar.
  const pendingPermission = pendingPermissionBySession.get(tabId)
  if (pendingPermission) renderPermissionBar(tabId, pendingPermission)
  else hidePermissionBar()
  // Restore draft for the new tab
  els.promptInput.value = stateManager.getDraftText(tabId)
  composer.autoResizeTextarea()

  // Sync model dropdown to active session's model
  const activeSession = stateManager.getActiveSession()
  if (activeSession?.model) {
    modelDropdown.setCurrentModel(activeSession.model)
  }
  if (activeSession?.variant) {
    variantSelector.setVariant(activeSession.variant)
  } else {
    variantSelector.setVariant(stateManager.getGlobalVariant() || "Default")
  }

  // Restore the toolbar dropdown to this session's persisted context usage data.
  resetContextUsagePanel()
  const switchedSession = stateManager.getSession(tabId)
  if (switchedSession?.contextUsage) {
    const cu = switchedSession.contextUsage
    ctxDropdownApi?.updateUsage({ type: "context_usage", ...cu } as Record<string, unknown>)
    updateContextUsageBar(cu.percent, cu.tokens, cu.maxTokens)
  } else {
    // No context data for this session — hide the bar until new data arrives
    els.contextUsage.classList.add("hidden")
  }

  // Refresh cost/token displays for the new tab — pull from the tab's
  // own stored usage so a previously-displayed tab's totals don't bleed in.
  renderMethodologyChip(tabId)
  updateCostDisplay(tabId)
  const session = stateManager.getSession(tabId)
  const displayed = selectDisplayedUsage(stateManager.getState().sessions, tabId)
  if (displayed) {
    updateTokenDisplay(displayed.usage)
    updateContextBarFromSession(tabId)
  } else {
    clearTokenDisplay()
  }
  // Tell the dropdown which session to display. This re-renders the strip
  // and (if open) the tree from this session's per-session state, so files
  // from another tab never bleed into the visible UI.
  cfDropdownApi?.setCurrentSession(tabId)
  if (session?.changedFiles && session.changedFiles.length > 0) {
    cfDropdownApi?.updateChangedFiles(
      tabId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridges to changed-files dropdown API shape
      session.changedFiles.map((p) => ({ path: p, added: 0, removed: 0 })) as any,
    )
  }

  // Sync todos panel for the switched tab
  vscode.postMessage({ type: "get_todos", sessionId: tabId })
  vscode.postMessage({ type: "get_changed_files", sessionId: tabId })
  triggerTodosRender(tabId)
  refreshActivityAndTasks(tabId)

  const msgList = getActiveMessageList(els)
  if (msgList) {
    attachScrollPersistence(tabId, msgList)
    const savedScroll = stateManager.getScrollPosition(tabId)
    if (savedScroll > 0) {
      restoreScrollPosition(tabId, msgList)
    } else if (notifyHost) {
      const anchor = scrollAnchors.get(tabId)
      if (anchor) anchor.anchor()
      else scrollToBottom(msgList)
    }
  }

  applyTimelineVisibility(tabId)
  showSecondaryNav()

  // Tab switch: derive the send button from BOTH flags. The host flag wins
  // so a tab whose backend is still generating (but whose local optimistic
  // flag was cleared by an error/reconnect) still shows Stop. Then trigger
  // a probe — if the host disagrees with our reading, it will reply with
  // run_status_result and we'll reconcile. This is the recovery path for
  // gap #9 (switchTab reads only the local flag).
  const isActiveStreaming =
    activeSession?.isStreaming === true || activeSession?.isServerStreaming === true
  updateSendButtonIcon(isActiveStreaming)
  if (isActiveStreaming) {
    els.promptInput.placeholder = "Guide the AI: correct errors, change direction, or add context…"
  } else {
    els.promptInput.placeholder = "Ask OpenCode a question about your code…"
  }
  if (!isActiveStreaming) {
    els.inputArea.classList.remove("steer-interrupt", "steer-queue")
  }
  // Ask the host to confirm whether the tab's run is still active. Cheap;
  // the host dedupes. If the host says active=true we revive the Stop button;
  // if active=false we clear any stale flag.
  composer.probeActiveRun?.()
  // Refresh queue UI for the switched-to tab
  composer.renderQueue(tabId)
  // B3: Refresh question bar for the switched-to tab. First repopulate from
  // the tab's persisted messages so a tab the user is visiting for the first
  // time in this page session (or after a partial reload) surfaces its
  // pending questions — setActiveSession alone only renders items already
  // in `state.items`, which is empty for never-visited tabs. Then
  // setActiveSession filters the rendered set to the active session.
  const switchedMessages = stateManager.getSession(tabId)?.messages ?? []
  questionBar.repopulateFromMessages(tabId, switchedMessages as Array<{ id: string; timestamp?: number; blocks: Array<{ type: string; toolCallId?: string; id?: string; requestID?: string; answered?: boolean; groups?: unknown[] }> }>)
  questionBar.setActiveSession(tabId)
  // Reconcile bar: clean stale answered items and restore any missing
  // from the active session that fell out of the DOM.
  questionBar.reconcileBar(tabId)
}
