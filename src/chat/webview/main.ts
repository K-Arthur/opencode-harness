import type { ChatMessage, LegacyHostMessage, MentionItem, SessionSummary, ModelInfo, ContextChip, ToolCallState, UsageDelta, Todo, ContextUsage, RunActivitySnapshot, SubagentActivity, SessionState, ToolCallBlock } from "./types"
import type { AttachmentEls } from "./ui/attachments"
import { timers } from "./timerRegistry"
import { createState } from "./state"
import { getElementRefs, scrollToBottom, getActiveMessageList, toggleAllThinkingBlocks } from "./dom"
import { renderMessage } from "./messageRenderer"
import { setupMentions } from "./mentions"
import { setupCommandsModal, type CommandEntry } from "./commands-modal"
import { toCommandEntries, type RemoteCommandInfo } from "./slash-commands"
import { createStreamHandlers, type StreamHandlers } from "./stream"
import { upsertMessageById } from "./messageUpsert"
import { isSwitchEventType, switchInsertIndex } from "../../session/activityCoalesce"
import { createTabBar, createTabContent, switchToTab, removeTabContent, patchTabLabel } from "./tabs"
import { extractTitle, dedupeTitle } from "../../session/titleExtractor"
import { setupModelDropdown } from "./model-dropdown"
import { setVsCodeApi, setupToolKeyboardNav, webviewLog, finalizeStreamingText } from "./streamHandlers"
import { setErrorActionHandler as setCompsErrorActionHandler } from "./errorComponents"
import { setErrorActionHandler as setRendererErrorActionHandler } from "./renderer"
import { setMaxConcurrentStreams } from "./sendLogic"
import { setupModelManager } from "./model-manager"
import type { ProviderConfig } from "../../model/ProviderConfigManager"
import { setupVariantSelector } from "./variant-selector"
import { setupMcpConfig } from "./mcp-config"
import type { McpServerInfo } from "../../mcp/McpServerManager"
import { type PromptQueue, createPromptQueue } from "./queue"
import { updateContextChips, applyThemeVars, handleRateLimitExhausted } from "./theme"
import { getQuotaMonitor } from "./quotaMonitor"
import { STREAM_LIMIT_TOOLTIP, getContextUsageTooltip, initStaticButtonTooltips } from "./tooltips"
// context-usage-panel.ts removed — canonical UI is now context-usage-dropdown.ts
import { setupChangedFilesDropdown, updateChangedFiles, handleDiffResponse as handleCfDiffResponse, handleFileHunks as handleCfFileHunks, setCurrentSession as setCfCurrentSession, refreshChangedFilesVisibility, closeChangedFilesDropdown } from "./changed-files-dropdown"
import { createSurfaceCoordinator, type SurfaceCoordinator } from "./surfaceCoordinator"
import type { FileHunkView } from "./hunkRevertView"
import type { DiffLine } from "./types"
import { setupContextUsageDropdown as setupCtxDropdown, updateUsage as updateCtxDropdown, resetContextUsageDropdown, openContextUsageDropdown, closeContextUsageDropdownIfOpen } from "./context-usage-dropdown"
import { formatUsagePercent } from "./context-usage-service"
import { showCompactBanner, hideCompactBanner } from "./compact-banner"
import { setupPromptStash } from "./prompt-stash"
import { prepareHostRecentSessions, prepareLocalRecentSessions, renderRecentSessions } from "./recent-sessions"
import { renderUnifiedSessionList, setSessionListPostMessage, setUnifiedServerSessions, setUnifiedLocalSessions, setUnifiedSessionQuery, getUnifiedSessionQuery, disposePortaledMoreMenus } from "./sessionListRenderer"
import { createScrollAnchor, type ScrollAnchor } from "./scrollAnchor"
import { createChunkedLoader, prependMessagesPreservingScroll, createLoadEarlierBanner, throttleScrollMarkers } from "./messageLoader"
import { createVirtualList, getVirtualList, disposeVirtualList } from "./virtualList"
import { setupTodosPanel } from "./todos-panel"
import { setupActivityPanel } from "./activity-panel"
import { setupTasksPanel } from "./tasks-panel"
import { mergeTodos, generateTodoId } from "./todos-logic"
import { setupSkillsModal } from "./skills-modal"
import * as questionBar from "./questionBar"
import { setupSubagentPanel, type SubagentPanelApi } from "./subagent-panel"
import { setupSubagentDetailView, type SubagentDetailViewApi } from "./subagentDetailView"
import { reconcileSubagentStatuses, computeNewSubagentIds, capCompletedSubagents } from "./subagentReconciler"
import { setupSidebarResize } from "./sidebarResize"
import { applySubagentCardUpdate } from "./subagentCard"
import { selectDisplayedUsage } from "./tokenDisplayPolicy"
import { setThinkingVisible, getThinkingVisible } from "./displayPrefs"
import { setupSearch } from "./ui/messageSearch"
import { ToolElapsedTracker } from "./ui/toolElapsed"
import { setupDisplayToggles } from "./ui/displayToggles"
import { toolPartialStore } from "./toolPartialStore"
import { setupThemeCustomizer, openThemeCustomizer, populateCliList, applyThemeCustomizerConfig } from "./ui/themeCustomizer"
import { setupModeToggle, updateModeDropdown, updateModeSelectorState, syncModeUI as syncModeUIModule, cycleModeForward, isModalOrDialogOpen } from "./ui/modeDropdown"
import { setupInstructionsEditor } from "./ui/instructionsEditor"
import { setupSessionModal as setupSessionModalModule, openSessionModal as openSessionModalModule, closeSessionModal as closeSessionModalModule, trapModalFocus } from "./ui/sessionModal"
import { setupKeyboardShortcutsModal, openKeyboardShortcutsModal, closeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal"
import { setupProviderPanel, openProviderPanel, closeProviderPanel, renderProviderDiscoveryList, renderProviderCredentialList, handleOAuthStarted, handleOAuthCompleted, onProviderKeyResult } from "./ui/providerPanel"
import type { ProviderDiscoveryItem, ProviderAuthMethodInfo, ProviderCredentialInfo } from "./types"
import { createEscapeRegistry, visibleByClass } from "./escapeCoordinator"

import { handleTokenUsage as handleTokenUsageModule, accumulateTokenUsage as accumulateTokenUsageModule, accumulateCost as accumulateCostModule, applyTokenUsageTotals as applyTokenUsageTotalsModule, rememberStepUsage, isDuplicateRecentStepUsage, handleRateLimitState as handleRateLimitStateModule, updateCostDisplay as updateCostDisplayModule, updateTokenDisplay as updateTokenDisplayModule, clearTokenDisplay as clearTokenDisplayModule, updateContextBarFromSession as updateContextBarFromSessionModule, type TokenCostDeps, type RateLimitWebviewState } from "./ui/tokenCostDisplay"
import { createAttachmentManager } from "./ui/attachments"
import { showWelcomeView as showWelcomeViewModule, hideWelcomeView as hideWelcomeViewModule, renderWelcomeContext as renderWelcomeContextModule, setupWelcomeActions as setupWelcomeActionsModule, setupWelcomeSuggestions as setupWelcomeSuggestionsModule, setupWelcomeResponsive as setupWelcomeResponsiveModule, type WelcomeViewDeps } from "./ui/welcomeView"
import { shouldHonorActiveSessionChange, resolveInitStateTarget } from "./sessionFocus"
import { resolveEventSessionTarget } from "./sessionTarget"
import { renderRecentPromptsRail } from "./recentPromptsRail"
import { closeSettingsMenu as closeSettingsMenuModule, setupSettingsMenuKeyboardNav as setupSettingsMenuKeyboardNavModule } from "./ui/settingsMenu"
import { handleChangedFiles as handleChangedFilesModule, renderCheckpointPanel as renderCheckpointPanelModule, handleClearMessages as handleClearMessagesModule, type FileTrackingDeps } from "./ui/fileTracking"
import { setupButtons as setupButtonsModule } from "./ui/buttonSetup"
import { setupPermissionConfig, closePermissionConfig } from "./permissionConfig"
import { deriveState } from "./ui/contextUsageThresholds"
import { updateScrollMarkers as updateScrollMarkersModule, setupJumpToBottom as setupJumpToBottomModule, scrollToTurn as scrollToTurnModule, type ScrollMarkerDeps } from "./ui/scrollMarkers"
import { createStreamOrchestrator, type StreamOrchestratorAPI } from "./streamOrchestrator"
import { createTimeline, type TimelineAPI } from "./timeline"
import { createComposer, type ComposerAPI } from "./composer"
import { setupVoiceInput } from "./voiceInput"
import { setToolOutputRenderAnsi } from "./ansiUtils"
import { normalizeSessionMode } from "../modePolicy"
import type { VoiceInputSettings } from "../voiceInputCore"
import { TimestampUpdater } from "./timestampUpdater"

declare const acquireVsCodeApi: (() => {
  postMessage(message: Record<string, unknown>): void
  getState(): import("./types").WebviewState | undefined
  setState(state: import("./types").WebviewState): void
}) | undefined

const log = {
  warn: (...args: unknown[]) => console.warn("[opencode-harness]", ...args),
  error: (...args: unknown[]) => console.error("[opencode-harness]", ...args),
}

const STREAM_ACK_MIN_INTERVAL_MS = 200

function createWebviewId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

// Timeout handle for deferred initialization
declare global {
  var __opencodeInitTimeout: ReturnType<typeof setTimeout> | undefined
  var __opencodeDebug: boolean | undefined
}

// VS Code API shim for testing outside VS Code
function getVsCodeApi() {
  if (typeof acquireVsCodeApi === "function") {
    return acquireVsCodeApi()
  }
  // Mock for browser testing
  return {
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  }
}

(function () {
  "use strict"

  // Global error boundary - prevent white screen crashes
  // Must remove the .hidden class (display:none !important) since inline
  // style can't override !important.
  window.addEventListener("error", (event) => {
    log.error("Unhandled error:", event.error || event.message)
    const errorDiv = document.getElementById("error-boundary")
    if (errorDiv) {
      errorDiv.classList.remove("hidden")
      errorDiv.textContent = "An error occurred. Please reload the panel."
    }
  })

  window.addEventListener("unhandledrejection", (event) => {
    log.error("Unhandled promise rejection:", event.reason)
    const errorDiv = document.getElementById("error-boundary")
    if (errorDiv && !errorDiv.classList.contains("hidden")) return
    if (errorDiv) {
      errorDiv.classList.remove("hidden")
      errorDiv.textContent = "A background operation failed. Check the console for details."
      setTimeout(() => {
        errorDiv.classList.add("hidden")
      }, 8000)
    }
  })

// Flush state when page becomes hidden (tab switch, minimize, etc.)
  // Using a reference that gets populated once stateManager is created
  let _stateManagerRef: ReturnType<typeof createState> | null = null
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && _stateManagerRef) {
      _stateManagerRef.flush()
    }
  })

  const vscode = getVsCodeApi()
  const stateManager = createState(vscode)
  _stateManagerRef = stateManager
  const els = getElementRefs()
  els.promptInput.dataset.testid = els.promptInput.dataset.testid || "prompt-input"
  els.sendBtn.dataset.testid = els.sendBtn.dataset.testid || "send-button"

  // Core UI modules
  let modelManager: ReturnType<typeof setupModelManager>
  
  // Panel APIs
  let todosPanelApi: ReturnType<typeof setupTodosPanel> | null = null
  let activityPanelApi: ReturnType<typeof setupActivityPanel> | undefined
  let tasksPanelApi: ReturnType<typeof setupTasksPanel> | undefined
  let voiceInputApi: ReturnType<typeof setupVoiceInput> | undefined
  let hasQuotaState = false
  // Per-session server-side todos. Single source of truth keyed by sessionId
  // so a background tab's todos.updated event cannot poison the active tab.
  const serverTodosBySession = new Map<string, Todo[]>()
  // Tracks whether the user has manually closed the todos panel for a given
  // session. Once dismissed, that session won't auto-open on subsequent
  // todo deliveries — the user must re-open it explicitly.
  const todosDismissedBySession = new Set<string>()
  // Tracks whether we've already auto-opened for a session, to avoid re-opening
  // after the user closes the panel.
  const todosAutoOpenedForSession = new Set<string>()

  function getServerTodos(sessionId: string): Todo[] {
    return serverTodosBySession.get(sessionId) ?? []
  }

  function setServerTodos(sessionId: string, todos: Todo[]): void {
    serverTodosBySession.set(sessionId, todos)
  }

  function getMergedTodos(sessionId: string, serverTodos: Todo[]): Todo[] {
    const session = stateManager.getSession(sessionId)
    return mergeTodos(session, serverTodos)
  }

  function triggerTodosRender(sessionId: string, options?: { autoOpen?: boolean }) {
    if (!todosPanelApi) return
    const merged = getMergedTodos(sessionId, getServerTodos(sessionId))
    todosPanelApi.renderTodos(merged, false, sessionId)

    // Auto-open: only on first non-empty delivery for an active session,
    // and only if the user hasn't already dismissed the panel for this session.
    if (options?.autoOpen && merged.length > 0) {
      const activeSid = stateManager.getState().activeSessionId
      const panelIsOpen = todosPanelApi?.isOpen()
      const dismissed = todosDismissedBySession.has(sessionId)
      const alreadyOpened = todosAutoOpenedForSession.has(sessionId)
      if (
        activeSid === sessionId &&
        !panelIsOpen &&
        !dismissed &&
        !alreadyOpened
      ) {
        todosPanelApi?.open()
        todosAutoOpenedForSession.add(sessionId)
        const btn = (globalThis as any).document?.getElementById?.("todos-toggle-btn") as HTMLElement | undefined
        if (btn) btn.setAttribute("aria-pressed", "true")
        webviewLog(`[main] todos panel auto-opened for session ${sessionId} (${merged.length} items)`)
      }
    }
  }

  function refreshActivityAndTasks(sessionId?: string): void {
    activityPanelApi?.refresh(sessionId)
    tasksPanelApi?.refresh(sessionId)
    refreshSubagentPanel(sessionId)
    refreshRecentPrompts(sessionId)
  }

  // Recent / pinned prompts rail (brief Phase 5). Renders the active session's
  // recent user prompts with pinned ones floated to the top; click-to-reuse fills
  // the composer, pin toggles persist per session.
  function refreshRecentPrompts(sessionId?: string): void {
    const rail = els.recentPromptsRail
    if (!rail) return
    const id = sessionId ?? stateManager.getState().activeSessionId
    const session = id ? stateManager.getSession(id) : undefined
    if (!id || !session) {
      rail.classList.add("hidden")
      return
    }
    renderRecentPromptsRail(rail, {
      messages: session.messages,
      pinnedIds: stateManager.getSessionPinnedPrompts(id),
      onPin: (promptId) => {
        stateManager.toggleSessionPinnedPrompt(id, promptId)
        refreshRecentPrompts(id)
      },
      onPick: (text) => {
        els.promptInput.value = text
        els.promptInput.focus()
      },
    })
  }

  // Maps a server-reported subagent status string to a SubagentActivity status.
  // Unknown/non-canonical values are coerced to "unknown" (NOT "pending") so they
  // are NOT treated as live by isLiveSubagent. This prevents subagents from
  // appearing to be running forever when the server sends a status string the
  // webview doesn't recognize (e.g. a new status type from a future opencode
  // version). The reconciler will then mark them as completed when the server
  // drops them from the snapshot. See subagentReconciler.ts.
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

  function isLiveSubagent(activity: SubagentActivity): boolean {
    return activity.status === "running" || activity.status === "pending"
  }

  /**
   * Map a SubagentRunStatus (from RunActivityTracker snapshot) to the generic
   * tool-state name applySubagentCardUpdate understands. The card's own
   * `statusFromUpdate` then maps it to the final SubagentCardStatus.
   * Keeps inline-card liveness aligned with the panel's tracker view.
   */
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
        return "error"
      case "cancelled":
        return "error"
      default:
        return status
    }
  }

  function getSubagentActivities(sessionId?: string): SubagentActivity[] {
    const session = sessionId ? stateManager.getSession(sessionId) : stateManager.getActiveSession() ?? undefined
    return session?.subagentActivities ?? []
  }

  function updateSubagentBadge(activeCount: number): void {
    const badge = els.subagentsBadge
    if (!badge) return
    if (activeCount > 0) {
      badge.textContent = String(activeCount)
      badge.classList.remove("hidden")
      els.subagentsToggleBtn.setAttribute("aria-label", `Toggle subagent panel (${activeCount} running)`)
    } else {
      badge.classList.add("hidden")
      els.subagentsToggleBtn.setAttribute("aria-label", "Toggle subagent panel")
    }
  }

  function refreshSubagentPanel(sessionId?: string): void {
    const activities = getSubagentActivities(sessionId)
    subagentPanelApi?.renderActivities(activities)
    updateSubagentBadge(activities.filter(isLiveSubagent).length)
  }

  function setSubagentPanelOpen(open: boolean): void {
    if (open) {
      subagentPanelApi?.open()
      // Opening (whether by user click or by oc:open-subagent-panel) clears
      // the dismissed flag so future run_activity_updates can re-auto-open
      // if the user closes it again.
      const sid = stateManager.getState().activeSessionId
      if (sid) subagentDismissedBySession.delete(sid)
    } else {
      subagentPanelApi?.close()
      // Track explicit dismissal so the auto-open in run_activity_update
      // doesn't keep re-opening the panel during this run.
      const sid = stateManager.getState().activeSessionId
      if (sid) subagentDismissedBySession.add(sid)
    }
    els.subagentsToggleBtn.setAttribute("aria-pressed", String(open))
  }

  function requestSubagentActivities(sessionId?: string): void {
    const sid = sessionId ?? stateManager.getState().activeSessionId ?? undefined
    if (sid) {
      vscode.postMessage({ type: "get_subagent_activities", sessionId: sid })
    }
  }

  function mergeSubagentActivities(sessionId: string, incoming: SubagentActivity[]): SubagentActivity[] {
    const session = stateManager.getSession(sessionId)
    if (!session) return []
    const merged = new Map<string, SubagentActivity>()
    for (const existing of session.subagentActivities ?? []) {
      merged.set(existing.id, existing)
    }
    for (const activity of incoming) {
      merged.set(activity.id, { ...merged.get(activity.id), ...activity })
    }
    const activities = [...merged.values()]
    stateManager.setSubagentActivities(sessionId, activities)
    if (sessionId === stateManager.getState().activeSessionId) {
      subagentPanelApi?.renderActivities(activities)
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

  // These hold late-bound panel APIs whose handlers receive loosely-typed
  // webview message payloads (msg.skills/activities are unknown); typing them
  // strictly forces unsafe casts at every call site. Left as `any` per the
  // repo's "no-explicit-any needs review, not blind-fix" policy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skillsModalApi: any = null
  let subagentPanelApi: SubagentPanelApi | undefined
  let subagentDetailViewApi: SubagentDetailViewApi | undefined
  /**
   * Sessions where the user has explicitly closed the subagent panel.
   * `run_activity_update` will skip the auto-open for these sessions until
   * the user re-opens it (or until the next run starts and clears it).
   */
  const subagentDismissedBySession = new Set<string>()
  const knownSubagentIdsBySession = new Map<string, Set<string>>()

  // Tracks the most recently *interacted-with* subagent id, so the "Open in
  // editor" button in the detail view knows which subagent to pop out. We
  // intentionally track interaction rather than "the only one in the panel"
  // because the panel can show multiple subagents at once. Updated on
  // - onOpenDetail (the user clicks a panel item)
  // - subagent_update (a live update arrives while the detail view is open)
  // Cleared when the detail view closes.
  let activeSubagentId: string | null = null
  // The subagent card (or other control) that opened the detail view, so focus
  // can return to it on Back/Close instead of being dropped on <body> (WCAG 2.4.3).
  let subagentDetailInvoker: HTMLElement | null = null

  function restoreSubagentDetailFocus(): void {
    const invoker = subagentDetailInvoker
    subagentDetailInvoker = null
    if (invoker && invoker.isConnected && typeof invoker.focus === "function") {
      invoker.focus({ preventScroll: true })
    }
  }

  const modelDropdown = setupModelDropdown(els, {
    onOpen: () => {
      vscode.postMessage({ type: "get_models" })
    },
 	    onSelect: (modelId) => {
 	      // Always update global preference + UI, regardless of whether a session is active.
 	      // This allows model selection to work on the welcome screen before any session exists.
 	      stateManager.setGlobalModel(modelId)
 	      modelDropdown.setCurrentModel(modelId)
 	      syncModelViews()
 	      const model = modelManager.getEnabledModels().find((m) => `${m.provider}/${m.id}` === modelId)
 	      variantSelector.setModel(model || null)
 	      const active = stateManager.getActiveSession()
 	      if (active) {
 	        stateManager.setSessionModel(active.id, modelId)
 	        vscode.postMessage({ type: "set_model", model: modelId, sessionId: active.id })
 	      } else {
 	        vscode.postMessage({ type: "set_model", model: modelId })
 	      }
    },
    onManageModels: () => {
      surfaceCoord?.closeOthers("model-manager-panel")
      modelManager.open()
      vscode.postMessage({ type: "get_models" })
    },
  })

  modelManager = setupModelManager(els, {
	    onToggleModel: (modelId, enabled) => {
	      modelManager.updateModelEnabled(modelId, enabled)
	      stateManager.setModelDisabled(modelId, !enabled)
	      vscode.postMessage({ type: "model_toggle", modelId, enabled })
	      syncModelViews()
	    },
	    onToggleFavorite: (modelId) => {
	      const favorite = stateManager.toggleModelFavorite(modelId)
	      modelManager.updateModelFavorite(modelId, favorite)
	      vscode.postMessage({ type: "model_favorite", modelId })
	      syncModelViews()
	    },
	    onSelectModel: (modelId) => {
	      const active = stateManager.getActiveSession()
	      if (active) {
	        stateManager.setSessionModel(active.id, modelId)
	      }
	      stateManager.setGlobalModel(modelId)
	      modelDropdown.setCurrentModel(modelId)
	      syncModelViews()
	      const model = modelManager.getAllModels().find((m) => `${m.provider}/${m.id}` === modelId)
	      variantSelector.setModel(model || null)
	      vscode.postMessage({ type: "set_model", model: modelId, sessionId: active?.id })
	      modelManager.close()
	    },
		onConnectProvider: () => {
			openProviderPanel()
			vscode.postMessage({ type: "discover_providers" })
			vscode.postMessage({ type: "list_provider_credentials" })
		},
		onDeleteProvider: (id: string) => {
			vscode.postMessage({ type: "delete_provider", id })
		},
	})

	  // Make the error-display action buttons functional. Previously these clicks
	  // only hit a console.log; now they dispatch to real host/local behaviour.
	  const errorActionHandler = (action: { label: string; action: string; primary?: boolean; metadata?: Record<string, unknown> }) => {
	    const url = action.metadata && typeof action.metadata.url === "string" ? action.metadata.url : undefined
	    if (url) {
	      vscode.postMessage({ type: "open_url", url })
	      return
	    }
	    switch (action.action) {
	      case "retry":
	      case "regenerate":
	      case "wait_for_reset": {
	        const sid = stateManager.getState().activeSessionId
	        if (sid) vscode.postMessage({ type: "retry_stream", sessionId: sid })
	        break
	      }
      case "switch_model":
      case "pick_model":
        surfaceCoord?.closeOthers("model-manager-panel")
        modelManager.open()
	        vscode.postMessage({ type: "get_models" })
	        break
	      case "edit":
	        openProviderPanel()
	        vscode.postMessage({ type: "discover_providers" })
	        vscode.postMessage({ type: "list_provider_credentials" })
	        break
	      case "dismiss": {
	        const sid = stateManager.getState().activeSessionId
	        if (sid) {
	          const session = stateManager.getSession(sid)
	          if (session) {
	            const errIdx = session.messages.findIndex(m => m.role === "system" && m.blocks?.[0]?.type === "error")
	            if (errIdx >= 0) {
	              session.messages.splice(errIdx, 1)
	              stateManager.save()
	              const msgList = getActiveMessageList(els)
	              if (msgList) {
	                const errEl = msgList.querySelector(".msg-error")?.closest("[data-message-id]") as HTMLElement | null
	                if (errEl) errEl.remove()
	              }
	            }
	          }
	        }
	        break
	      }
	    }
	  }
	  setCompsErrorActionHandler(errorActionHandler)
	  setRendererErrorActionHandler(errorActionHandler)

	  const variantSelector = setupVariantSelector(els, {
    onSelect: (variant) => {
      const normalized = variant === "Default" ? "" : variant
      stateManager.setGlobalVariant(normalized)
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionVariant(active.id, normalized)
        vscode.postMessage({ type: "set_variant", variant: normalized, sessionId: active.id })
      }
    },
	  })

  function syncModelViews(models = modelManager.getAllModels()) {
    const modelsWithState = stateManager.applyModelState(models)
    // The render's checkmark follows the ACTIVE session's model when one is
    // present; only fall back to the global default on the welcome screen.
    // Using globalModel unconditionally made compaction / cross-window
    // model pushes flip the picker off the model the user had chosen for
    // the current session.
    const active = stateManager.getActiveSession()
    const currentModel = active?.model || stateManager.getState().globalModel
    modelManager.setModels(modelsWithState)
    modelDropdown.render(modelsWithState, currentModel)
  }

  const mcpConfig = setupMcpConfig(els, {
    onAddServer: (name, config) => vscode.postMessage({ type: "add_mcp_server", name, config }),
    onUpdateServer: (name, config) => vscode.postMessage({ type: "update_mcp_server", name, config }),
    onRemoveServer: (name) => vscode.postMessage({ type: "remove_mcp_server", name }),
    onToggleServer: (name, disabled) => vscode.postMessage({ type: "toggle_mcp_server", name, disabled }),
    onClose: () => {},
  })

  let cfDropdownApi: { updateChangedFiles: typeof updateChangedFiles; handleDiffResponse: typeof handleCfDiffResponse; setCurrentSession: typeof setCfCurrentSession } | null = null
  let ctxDropdownApi: { updateUsage: typeof updateCtxDropdown } | null = null
  let _contextUsageRafId: number | undefined
  let surfaceCoord: SurfaceCoordinator | null = null

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
  })

  // Streaming state per session
  const streamHandlers = new Map<string, ReturnType<typeof createStreamHandlers>>()

  // Scroll anchors per tab — disposed on tab close
  const scrollAnchors = new Map<string, ScrollAnchor>()
  const scrollSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const renderedMessageSignatures = new Map<string, string>()

  // Tracks how many messages exist before the current viewport window so the
  // webview can request earlier pages via request_more_messages.
  const sessionBeforeIndex = new Map<string, number>()
  // Tracks the turn-based count for the "Load earlier" banner display text.
  const sessionHiddenTurns = new Map<string, number>()
  // Timeline jumps to not-yet-loaded turns: remember the target and chase it
  // across a bounded number of request_more_messages pages.
  const pendingTimelineScroll = new Map<string, { messageId: string; attemptsLeft: number }>()

  // Throttled updateScrollMarkers — prevents O(n) DOM work on every chunk tick
  const debouncedUpdateScrollMarkers = throttleScrollMarkers((id) => updateScrollMarkers(id))

  // Throttled timeline refresh — the timeline walks all messages; debounce it during streaming
  const debouncedTimelineRefresh = throttleScrollMarkers((id) => refreshConversationTimeline(id))

  // Per-tab prompt queues — keyed by sessionId
  const promptQueues = new Map<string, PromptQueue>()

  // Per-session pending permission request — at most one per session. Lets
  // the permission bar survive tab switches (restored when its session
  // becomes active again) instead of bleeding into whichever tab is focused
  // when the request arrives, or vanishing if a later request from another
  // tab overwrites the shared bar.
  const pendingPermissionBySession = new Map<string, {
    permissionId: string
    permissionType?: string
    pattern?: string | string[]
    title: string
  }>()

  const mention = setupMentions(
    els,
    { query: "", selectedIndex: -1, mode: "mention" as const },
    (msg) => vscode.postMessage(msg)
  )

  // ── Commands palette (full modal). Triggered by /commands, Ctrl+/, or list_stashes flow.
  // Local entries mirror the in-prompt slash switch below so any future addition is one-stop.
  // Local slash commands live in the canonical registry (slash-commands.ts)
  // so the modal and the inline mention dropdown can't drift out of sync.
  const LOCAL_COMMAND_ENTRIES: CommandEntry[] = toCommandEntries()

  // Cached remote (server/MCP/skill) commands — updated whenever the host
  // pushes a `command_list`. Consumed by the slash dispatcher to resolve
  // MCP namespace-prefixed invocations (e.g. `/jcodemunch triage` → `/triage`).
  let cachedRemoteCommands: RemoteCommandInfo[] = []

  function runCommandEntry(entry: CommandEntry): void {
    composer.runCommandEntry(entry)
  }

  function insertIntoPrompt(text: string): void {
    composer.insertIntoPrompt(text)
  }

  const commandsModal = setupCommandsModal({
    commandsModal: els.commandsModal,
    commandsList: els.commandsList,
    commandsSearchInput: els.commandsSearchInput,
    commandsTitle: els.commandsTitle,
    commandsFilter: els.commandsFilter,
    commandsModalCloseBtn: els.commandsModalCloseBtn,
  }, {
    localCommands: LOCAL_COMMAND_ENTRIES,
    mentionDropdown: els.mentionDropdown,
    onRun: (entry) => runCommandEntry(entry),
    onInsert: (text) => insertIntoPrompt(text),
    onUseStash: (stash) => {
      // Insert the stash content into the prompt for review before sending.
      insertIntoPrompt(stash.content)
    },
    onDeleteStash: (id) => vscode.postMessage({ type: "delete_stash", id }),
    onUseTemplate: (tpl) => {
      insertIntoPrompt(tpl.content)
    },
    onDeleteTemplate: (id) => vscode.postMessage({ type: "delete_template", id }),
  })

  const attachmentManager = createAttachmentManager({
    els: {
      inputArea: els.inputArea,
      inputWrapper: els.inputWrapper,
      promptInput: els.promptInput,
    },
    postMessage: (msg) => vscode.postMessage(msg),
    updateSendButton,
    autoResizeTextarea,
    updateContextChips: (_attachmentEls: AttachmentEls, chips?: ContextChip[]) => updateContextChips(els, chips),
    getActiveSession: () => stateManager.getActiveSession(),
  })

  /* ─── INIT ─── */

  /* ─── PER-TOOL ELAPSED TIMERS ─── */

  const toolElapsedTracker = new ToolElapsedTracker()

  /* ─── STREAM ORCHESTRATOR ─── */

  let streamOrchestrator!: StreamOrchestratorAPI

  function wireStreamOrchestrator() {
    streamOrchestrator = createStreamOrchestrator({
      vscode,
      els,
      streamHandlers,
      // Bridges to StreamOrchestratorDeps' narrower shapes (same pattern as the
      // ComposerDeps note below). Tracked, not blind-fixed — see repo any policy.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      getState: () => stateManager.getState() as any,
      getSession: (id) => stateManager.getSession(id) as any,
      getAllSessions: () => stateManager.getAllSessions() as any,
      ensureSession: (init) => stateManager.ensureSession(init) as any,
      setStreaming: (sid, streaming) => stateManager.setStreaming(sid, streaming),
      save: () => stateManager.save(),
      createWebviewId,
      addMessage,
      showSystemMessage,
      createTabUI,
      switchTab,
      hideWelcomeView,
      updateTabBar,
      updateModeSelectorStateLocal,
      updateSendButtonIcon: (isStreaming?: boolean, streamCapacity?: any) => composer.updateSendButtonIcon(isStreaming, streamCapacity),
      /* eslint-enable @typescript-eslint/no-explicit-any */
      updateSendButton: () => composer.updateSendButton(),
      getMessageList,
      createStreamHandlersForTab,
      setupJumpToBottom,
      debouncedUpdateScrollMarkers,
      debouncedTimelineRefresh,
      refreshConversationTimeline,
      toolElapsedTracker,
      promptQueues,
      renderQueue: (tabId: string) => composer.renderQueue(tabId),
      syncModeUI,
      renderRecentSessionsList,
      persistQueues: () => composer.persistQueues(),
    })
  }

  let timeline!: TimelineAPI

  function wireTimeline() {
    timeline = createTimeline({
      els,
      getState: () => stateManager.getState(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridges to TimelineDeps' narrower session shape
      getSession: (id) => stateManager.getSession(id) as any,
      isTimelineVisible: () => stateManager.isTimelineVisible(),
      setTimelineVisible: (v) => stateManager.setTimelineVisible(v),
      getMessageList,
      scrollToTurn: (messageId) => scrollToTurnModule(scrollMarkerDeps, messageId),
      onUnloadedTurnClick: (sessionId, messageId) => {
        const idx = sessionBeforeIndex.get(sessionId) ?? 0
        if (idx <= 0) return
        pendingTimelineScroll.set(sessionId, { messageId, attemptsLeft: 3 })
        vscode.postMessage({ type: "request_more_messages", sessionId, beforeIndex: idx, limit: 50 })
      },
      setThinkingVisible,
      getThinkingVisible,
      toggleAllThinkingBlocks,
      vscodeSetState: (s) => vscode.setState(s),
      debouncedUpdateScrollMarkers,
    })
  }

  let composer!: ComposerAPI

  function wireComposer() {
    composer = createComposer({
      // NOTE: these `as any` casts bridge main.ts's concrete objects to
      // createComposer's intentionally-narrower ComposerDeps interface (e.g.
      // ComposerDeps.vscode.getState is generic `<T>()`, modelDropdown/tabBar/
      // updateAgentStatus use looser signatures). Removing them surfaces real
      // structural mismatches — proper resolution is to align ComposerDeps with
      // these concrete types (a reviewed cross-module refactor), per the repo's
      // "no-explicit-any needs review, not blind-fix" policy. Tracked, not blind-fixed.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      els: els as any,
      vscode: vscode as any,
      stateManager: stateManager as any,
      attachmentManager: attachmentManager as any,
      mention: mention as any,
      modelDropdown: modelDropdown as any,
      modelManager: modelManager as any,
      commandsModal: commandsModal as any,
      getServerCommands: () => cachedRemoteCommands,
      streamHandlers: streamHandlers as any,
      tabBar: tabBar as any,
      timers: timers as any,
      promptQueues: promptQueues as any,
      hideWelcomeView,
      showSystemMessage,
      handleRequestError,
      addMessage,
      updateTabBar,
      switchTab,
      switchToTab: ((id: string) => switchToTab(els as any, id)) as any,
      createTabUI,
      createNewTab,
      closeTab,
      updateAgentStatus: updateAgentStatus as any,
      syncModelViews,
      updateModeSelectorState: () => updateModeSelectorState(els as any, () => stateManager.getActiveSession()),
      renderRecentSessionsList,
      debouncedUpdateScrollMarkers,
      STREAM_LIMIT_TOOLTIP,
      getAllSessions: () => stateManager.getAllSessions() as any,
      hasPendingQuestion: () => questionBar.hasActiveQuestions(),
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })
  }

  /**
   * Popout mode: minimal initialization that only renders the subagent detail
   * view in a dedicated VS Code editor panel. Hides all chat UI (tabs, input,
   * sidebar, etc.) and shows just the detail content area. Posts
   * `popout_get_subagent_detail` to trigger a data fetch from the host, then
   * renders the returned detail in the #subagent-detail-content element.
   */
  function initPopout(parentSessionId: string, subagentId: string): void {
    // Hide everything except the detail content
    const root = document.getElementById("root") ?? document.body
    root.innerHTML = ""
    const wrapper = document.createElement("div")
    wrapper.id = "popout-root"
    wrapper.style.cssText = "height:100%;display:flex;flex-direction:column;padding:12px;overflow-y:auto;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-family:var(--vscode-font-family)"
    const header = document.createElement("div")
    header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--vscode-panel-border)"
    const title = document.createElement("h2")
    title.style.cssText = "margin:0;font-size:14px;font-weight:600"
    title.textContent = `Subagent Detail`
    header.appendChild(title)
    wrapper.appendChild(header)
    const content = document.createElement("div")
    content.id = "popout-detail-content"
    content.innerHTML = `<div style="color:var(--vscode-descriptionForeground)">Loading subagent detail...</div>`
    wrapper.appendChild(content)
    root.appendChild(wrapper)

    // Listen for subagent_detail from the host
    window.addEventListener("message", (event) => {
      const msg = event.data as Record<string, unknown>
      if (!msg || msg.type !== "subagent_detail") return
      if (msg.subagentId !== subagentId) return
      const detail = msg.detail as Record<string, unknown> | undefined
      if (!detail) {
        content.innerHTML = `<div style="color:var(--vscode-errorForeground)">No detail data available for this subagent.</div>`
        return
      }
      renderPopoutDetail(content, detail)
    })

    // Request detail from host
    vscode.postMessage({
      type: "popout_get_subagent_detail",
      sessionId: parentSessionId,
      subagentId,
    })
  }

  function renderPopoutDetail(el: HTMLElement, detail: Record<string, unknown>): void {
    const status = typeof detail.status === "string" ? detail.status : "unknown"
    const agentName = typeof detail.agentName === "string" ? detail.agentName : "subagent"
    const summary = typeof detail.summary === "string" ? detail.summary : ""
    const error = typeof detail.error === "string" ? detail.error : ""
    const result = typeof detail.result === "string" ? detail.result : ""
    const currentActivity = typeof detail.currentActivity === "string" ? detail.currentActivity : ""
    const durationMs = typeof detail.durationMs === "number" ? detail.durationMs : 0
    const messages = Array.isArray(detail.messages) ? detail.messages : []

    const esc = (s: string): string =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    const statusColor = status === "completed" ? "#22c55e" : status === "failed" ? "#ef4444" : status === "running" ? "#3b82f6" : "#888"

    let html = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="padding:2px 8px;border-radius:4px;font-size:12px;background:${statusColor};color:#fff">${esc(status)}</span>
        <span style="font-size:14px;font-weight:500">${esc(agentName)}</span>
        ${durationMs ? `<span style="color:var(--vscode-descriptionForeground);font-size:12px">${(durationMs / 1000).toFixed(1)}s</span>` : ""}
      </div>
    `
    if (currentActivity) {
      html += `<div style="margin-bottom:8px"><strong>Current Activity:</strong> ${esc(currentActivity)}</div>`
    }
    if (summary) {
      html += `<div style="margin-bottom:12px"><strong>Summary:</strong><p style="margin:4px 0;color:var(--vscode-descriptionForeground)">${esc(summary)}</p></div>`
    }
    if (result) {
      html += `<div style="margin-bottom:12px"><strong>Result:</strong><p style="margin:4px 0">${esc(result)}</p></div>`
    }
    if (error) {
      html += `<div style="margin-bottom:12px"><strong style="color:var(--vscode-errorForeground)">Error:</strong><pre style="margin:4px 0;padding:8px;border-radius:4px;background:var(--vscode-textCodeBlock-background);font-size:12px;overflow-x:auto">${esc(error)}</pre></div>`
    }
    if (messages.length > 0) {
      html += `<div style="margin-top:12px"><strong>Messages (${messages.length})</strong><div style="margin-top:8px">`
      for (const raw of messages) {
        if (!raw || typeof raw !== "object") continue
        const msg = raw as Record<string, unknown>
        const role = typeof msg.role === "string" ? msg.role : "assistant"
        const text = typeof msg.text === "string" ? msg.text : ""
        if (!text) continue
        html += `<div style="margin-bottom:8px;padding:8px;border-radius:4px;border-left:3px solid ${role === "user" ? "#3b82f6" : "#888"}">
          <div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px">${esc(role)}</div>
          <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px">${esc(text)}</pre>
        </div>`
      }
      html += `</div></div>`
    }
    el.innerHTML = html
  }

  function init() {
    // Popout mode: if the host created this webview for a single subagent
    // detail, skip the full chat initialization and just render the detail.
    const popout = (globalThis as Record<string, unknown>).__OC_POPOUT__ as
      | { parentSessionId: string; subagentId: string }
      | undefined
    if (popout) {
      initPopout(popout.parentSessionId, popout.subagentId)
      return
    }
    try {
      setupCoreInteractionControls()
      setupSessionUtilities()
      setupTodoSkillAndSubagentPanels()
      setupChangedFilesFeature()
      setupContextUsageFeature()
      setupEscapeCoordinator()
      setupSurfaceCoordinator()
      const sidebarHandle = document.querySelector<HTMLElement>(".sidebar-resize-handle")
      const mainLayout = document.querySelector<HTMLElement>(".main-layout")
      if (sidebarHandle && mainLayout) {
        setupSidebarResize(sidebarHandle, mainLayout)
      }
      finishWebviewInitialization()
    } catch (err) {
      showInitializationFailure(err)
    }
  }

  function setupGlobalKeyboardShortcuts(): void {
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return
      const isTextInput = (el: EventTarget | null): boolean => {
        const target = el as HTMLElement | null
        if (!target) return false
        const tag = target.tagName?.toLowerCase()
        return Boolean(target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select")
      }
      const switchRelativeTab = (direction: 1 | -1): void => {
        const sessions = stateManager.getAllSessions()
        const activeId = stateManager.getState().activeSessionId
        if (sessions.length <= 1 || !activeId) return
        const idx = sessions.findIndex((s) => s.id === activeId)
        if (idx < 0) return
        const nextSession = sessions[(idx + direction + sessions.length) % sessions.length]
        if (nextSession) switchTab(nextSession.id)
      }

      if (isModalOrDialogOpen()) return

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (!e.shiftKey && key === "t" && !isTextInput(e.target)) {
          e.preventDefault()
          createNewTab()
          return
        }
        if (!e.shiftKey && key === "w" && !isTextInput(e.target)) {
          const active = stateManager.getActiveSession()
          if (active) {
            e.preventDefault()
            closeTab(active.id)
          }
          return
        }
        if (key === "tab" && !isTextInput(e.target)) {
          e.preventDefault()
          switchRelativeTab(e.shiftKey ? -1 : 1)
          return
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === "l" && !isTextInput(e.target)) {
          e.preventDefault()
          els.promptInput.focus()
          return
        }
        if (key === "k" && !isTextInput(e.target)) {
          e.preventDefault()
          surfaceCoord?.closeOthers("commands-modal")
          commandsModal.open()
          vscode.postMessage({ type: "list_commands" })
          return
        }
        if (key === "f" && !isTextInput(e.target)) {
          e.preventDefault()
          const searchBar = document.getElementById("chat-search-bar")
          if (searchBar) {
            searchBar.classList.toggle("hidden")
            if (!searchBar.classList.contains("hidden")) {
              const input = document.getElementById("chat-search-input") as HTMLInputElement | null
              input?.focus()
              input?.select()
            }
          }
          return
        }
      }

      if (e.key === "/" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextInput(e.target)) {
        e.preventDefault()
        openKeyboardShortcutsModal()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey) {
        switch (e.key) {
          case "L":
          case "l":
            e.preventDefault()
            els.timelineToggleBtn.click()
            break
          case "T":
          case "t":
            e.preventDefault()
            els.todosToggleBtn.click()
            break
          case "K":
          case "k":
            e.preventDefault()
            els.checkpointToggleBtn.click()
            break
          case "A":
          case "a":
            e.preventDefault()
            els.subagentsToggleBtn.click()
            break
          case "S":
          case "s":
            e.preventDefault()
            els.skillsBtn.click()
            break
          case "N":
          case "n":
            e.preventDefault()
            vscode.postMessage({ type: "create_tab" })
            break
          case "H":
          case "h":
            e.preventDefault()
            els.historyBtn.click()
            break
        }
      }
    })
  }

  /* ─── ESCAPE COORDINATOR ───
   * One Escape press affects exactly one surface (topmost first); Escape only
   * stops the active stream when nothing is open. Replaces the host-level
   * `escape → opencode-harness.stop` keybinding that could abort a running
   * task while the user was merely dismissing an overlay. */

  // Modals the coordinator owns. Other [aria-modal] dialogs (instructions
  // editor, model manager, MCP config, theme customizer, permission config,
  // mode warning) keep their component-level Escape handling — the
  // coordinator steps aside while any of them is open.
  const ESCAPE_MANAGED_MODAL_IDS = new Set([
    "session-modal",
    "skills-modal",
    "commands-modal",
    "keyboard-shortcuts-modal",
  ])

  // Popups whose Escape semantics live on the composer/anchor element
  // (combobox pattern) — the coordinator must never race them.
  const ESCAPE_DEFERRED_POPUP_IDS = [
    "mention-dropdown",
    "slash-autocomplete",
    "mode-dropdown-menu",
    "model-dropdown-container",
    "variant-dropdown-container",
  ]

  function isElementVisibleById(id: string): boolean {
    const el = document.getElementById(id)
    return Boolean(el && !el.classList.contains("hidden"))
  }

  function hasUnmanagedModalOpen(): boolean {
    const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
    for (const m of modals) {
      if (!m.classList.contains("hidden") && !ESCAPE_MANAGED_MODAL_IDS.has(m.id)) return true
    }
    return false
  }

  function shouldDeferEscape(): boolean {
    if (ESCAPE_DEFERRED_POPUP_IDS.some(isElementVisibleById)) return true
    // Text fields other than the prompt input keep their own Escape semantics
    // (queue inline edit, todo input, modal search fields…); the prompt input
    // itself falls through so Escape-with-nothing-open can stop the stream.
    const active = document.activeElement as HTMLElement | null
    if (active && active !== els.promptInput) {
      const tag = active.tagName?.toLowerCase()
      if (active.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return true
    }
    return false
  }

  function setupEscapeCoordinator(): void {
    const registry = createEscapeRegistry({
      isStreaming: () => Boolean(stateManager.getActiveSession()?.isStreaming),
      onStop: () => abortStream(),
      hasDeferredOverlay: shouldDeferEscape,
      hasUnmanagedModal: hasUnmanagedModalOpen,
    })

    const clickById = (id: string) => () => document.getElementById(id)?.click()

    registry.register({
      id: "session-modal",
      priority: 100,
      isOpen: visibleByClass(() => els.sessionModal),
      close: () => closeSessionModalModule(els, disposePortaledMoreMenus),
    })
    registry.register({
      id: "skills-modal",
      priority: 100,
      isOpen: () => isElementVisibleById("skills-modal"),
      close: () => skillsModalApi?.close?.(),
    })
    registry.register({
      id: "commands-modal",
      priority: 100,
      isOpen: () => isElementVisibleById("commands-modal"),
      close: () => commandsModal.close(),
    })
    registry.register({
      id: "keyboard-shortcuts-modal",
      priority: 100,
      isOpen: () => isElementVisibleById("keyboard-shortcuts-modal"),
      close: () => closeKeyboardShortcutsModal(),
    })
    registry.register({
      id: "provider-panel",
      priority: 100,
      isOpen: () => isElementVisibleById("provider-panel"),
      close: () => closeProviderPanel(),
    })
    registry.register({
      id: "settings-menu",
      priority: 80,
      isOpen: visibleByClass(() => els.settingsMenu),
      close: () => {
        closeSettingsMenu()
        els.settingsBtn.focus()
      },
    })
    registry.register({
      id: "context-usage-dropdown",
      priority: 80,
      isOpen: () => isElementVisibleById("context-usage-dropdown"),
      close: clickById("ctx-dropdown-close"),
    })
    registry.register({
      id: "changed-files-dropdown",
      priority: 80,
      isOpen: () => isElementVisibleById("changed-files-dropdown"),
      close: clickById("cf-dropdown-close"),
    })
    // Back to the subagent list first; a second Escape then closes the region.
    registry.register({
      id: "subagent-detail",
      priority: 60,
      isOpen: () =>
        !els.subagentDetailView.classList.contains("hidden") && subagentPanelApi?.isOpen() === true,
      close: () => els.subagentDetailBackBtn.click(),
    })
    registry.register({
      id: "chat-search-bar",
      priority: 40,
      isOpen: () => isElementVisibleById("chat-search-bar"),
      close: clickById("chat-search-close"),
    })
    registry.register({
      id: "prompt-stash",
      priority: 40,
      isOpen: () => isElementVisibleById("prompt-stash-panel"),
      close: clickById("prompt-stash-close"),
    })
    registry.register({
      id: "side-region",
      priority: 20,
      isOpen: () => {
        // Check if any panel is open
        return (todosPanelApi?.isOpen() || activityPanelApi?.isOpen() || tasksPanelApi?.isOpen() || subagentPanelApi?.isOpen()) === true
      },
      close: () => {
        // Close all panels
        todosPanelApi?.close()
        activityPanelApi?.close()
        tasksPanelApi?.close()
        subagentPanelApi?.close()
        syncPanelVisibilityToHost()
      },
    })

    // Capture phase: runs before every component-level Escape listener so a
    // consumed event can never double-fire legacy document handlers.
    document.addEventListener("keydown", registry.handleKeydown, true)
  }

  function setupSurfaceCoordinator(): void {
    surfaceCoord = createSurfaceCoordinator()
    surfaceCoord.register({ id: "model-manager-panel", close: () => modelManager.close() })
    surfaceCoord.register({ id: "commands-modal", close: () => commandsModal.close() })
    surfaceCoord.register({ id: "changed-files-dropdown", close: closeChangedFilesDropdown })
    surfaceCoord.register({ id: "context-usage-dropdown", close: closeContextUsageDropdownIfOpen })
    surfaceCoord.register({ id: "variant-dropdown", close: () => { try { variantSelector?.close?.() } catch { /* ok */ } } })
  }

  function isWelcomeVisible(): boolean {
    return !els.welcomeView.classList.contains("hidden")
  }

  function setupCoreInteractionControls(): void {
    setupPermissionConfig({
      els,
      postMessage: (msg) => vscode.postMessage(msg),
      onClose: () => els.settingsBtn.focus(),
    })

    setupModeToggle({
      els,
      getActiveSession: () => stateManager.getActiveSession(),
      setSessionMode: (id, mode) => stateManager.setSessionMode(id, mode),
      postMessage: (msg) => vscode.postMessage(msg),
      getDefaultMode: () => stateManager.getPendingMode(),
      setDefaultMode: (mode) => stateManager.setPendingMode(mode),
    })
    setupGlobalKeyboardShortcuts()
    new TimestampUpdater().startTicking(60_000)
    wireComposer()
    composer.setupInput()
    voiceInputApi = setupVoiceInput({
      els: {
        promptInput: els.promptInput,
        voiceInputBtn: els.voiceInputBtn,
        voiceInputStatus: els.voiceInputStatus,
      },
      postMessage: (msg) => vscode.postMessage(msg),
      insertTextAtCursor: (text) => composer.insertTextAtCursor(text),
      autoResizeTextarea: () => composer.autoResizeTextarea(),
      updateSendButton: () => composer.updateSendButton(),
      submitPrompt: () => {
        const btn = els.sendBtn as HTMLButtonElement
        if (btn && !btn.disabled) btn.click()
      },
    })
    setupButtonsModule({
      els: {
        historyBtn: els.historyBtn,
        sessionModal: els.sessionModal,
        sessionModalBody: els.sessionModalBody,
        mcpBtn: els.mcpBtn,
        themeCustomizerBtn: els.themeCustomizerBtn,
        permConfigBtn: els.permissionConfigBtn,
        providerPanelBtn: els.providerPanelBtn,
        settingsBtn: els.settingsBtn,
        settingsMenu: els.settingsMenu,
        checkpointPanel: els.checkpointPanel,
        todosToggleBtn: els.todosToggleBtn,
        todosPanel: els.todosPanel,
        changedFilesList: null,
        attachBtn: els.attachBtn,
        skillsBtn: els.skillsBtn,
      },
      postMessage: (msg) => vscode.postMessage(msg),
      closeSettingsMenu,
      openMcpConfig: () => mcpConfig.open(),
      openThemeCustomizer: () => openThemeCustomizer(themeDeps),
      openPermissionConfig: () => {
        const active = stateManager.getActiveSession()
        const sid = active?.id ?? stateManager.getState().activeSessionId
        if (sid) vscode.postMessage({ type: "get_permission_config", sessionId: sid })
      },
      openProviderPanel: () => {
        openProviderPanel()
      },
      getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
      skillsModalOpen: () => skillsModalApi?.open?.(),
      onTodosToggleRequest: () => {
        const wasOpen = todosPanelApi?.isOpen()
        if (wasOpen) {
          todosPanelApi?.close()
          syncPanelVisibilityToHost()
          return false
        }
        todosPanelApi?.open()
        syncPanelVisibilityToHost()
        return true
      },
      onTodosToggle: (willBeVisible: boolean) => {
        const sid = stateManager.getState().activeSessionId
        if (!sid) return
        if (!willBeVisible) {
          // User just closed the panel via the toolbar button.
          todosDismissedBySession.add(sid)
          webviewLog(`[main] todos panel dismissed via toolbar for session ${sid}`)
        } else {
          // User re-opened the panel — reset dismissed state.
          todosDismissedBySession.delete(sid)
        }
      },
    })
  }

  function setupSessionUtilities(): void {
    setupSessionModal()
    setupKeyboardShortcutsModal(document.getElementById("app") || document.body)
    const stashHandlers = setupPromptStash(els, (msg) => vscode.postMessage(msg as Record<string, unknown>))
    els.promptStashToggleBtn.addEventListener("click", () => stashHandlers.toggle())
  }

  function syncPanelVisibilityToHost(): void {
  vscode.postMessage({
    type: "panel_visibility_state",
    panels: {
      todos: todosPanelApi?.isOpen() ?? false,
      activity: activityPanelApi?.isOpen() ?? false,
      tasks: tasksPanelApi?.isOpen() ?? false,
      subagent: subagentPanelApi?.isOpen() ?? false,
    },
  } satisfies Record<string, unknown>)
}

function setupTodoSkillAndSubagentPanels(): void {
    todosPanelApi = setupTodosPanel(els, {
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
    activityPanelApi = setupActivityPanel(els, {
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
    tasksPanelApi = setupTasksPanel(els, {
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
      // Webviews frequently lack navigator.clipboard (and `?.` on it made
      // `.catch` throw on undefined) — copy via the host clipboard instead.
      onCopy: (text) => vscode.postMessage({ type: "copy_text", text }),
      onOpenTerminal: (command, cwd, autorun) => vscode.postMessage({ type: "open_terminal", command, cwd, autorun }),
      onCancel: (payload) => {
        vscode.postMessage({ type: "cancel_tool", ...payload })
        abortStream()
      },
      onPanelClose: () => { syncPanelVisibilityToHost() },
    })
    skillsModalApi = setupSkillsModal(els, {
      onToggleSkill: (skillId: string, enabled: boolean) => vscode.postMessage({ type: "toggle_skill", skillId, enabled }),
      onSearchSkills: (query: string) => vscode.postMessage({ type: "search_skills", query }),
    })
    subagentDetailViewApi = setupSubagentDetailView(els, {
      onBack: () => { subagentPanelApi?.open(); restoreSubagentDetailFocus() },
      onClose: () => { activeSubagentId = null; restoreSubagentDetailFocus() },
      onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
      onOpenSession: (activity: SubagentActivity) => {
        if (activity.sessionId) vscode.postMessage({ type: "open_subagent_session", childSessionId: activity.sessionId, title: activity.name })
      },
    })
    subagentPanelApi = setupSubagentPanel(els, {
      onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
      onOpenSession: (activity: SubagentActivity) => {
        if (activity.sessionId) vscode.postMessage({ type: "open_subagent_session", childSessionId: activity.sessionId, title: activity.name })
      },
      onOpenDetail: (activity: SubagentActivity) => {
        // Remember the card that opened the detail so Back/Close can return
        // focus to it.
        subagentDetailInvoker = document.activeElement as HTMLElement | null
        // Ensure subagent tab is active before showing detail overlay
        subagentPanelApi?.open()
        const normalizedId = activity.id.startsWith("subagent:")
          ? activity.id.slice("subagent:".length)
          : activity.id
        activeSubagentId = normalizedId
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

    // Wire toggle buttons to individual panels
    els.activityToggleBtn.addEventListener("click", () => {
      activityPanelApi?.toggle?.()
      syncPanelVisibilityToHost()
    })
    els.tasksToggleBtn.addEventListener("click", () => {
      tasksPanelApi?.toggle?.()
      syncPanelVisibilityToHost()
    })
    els.subagentsToggleBtn.addEventListener("click", () => {
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

    // Pop-out to editor button — opens the active subagent's detail in a
    // dedicated VS Code editor webview panel. Sends the parent sessionId AND
    // the active subagentId (tracked from the last onOpenDetail /
    // subagent_update interaction) so the host can resolve and render the
    // correct child session in the new panel.
    const popoutBtn = document.getElementById("subagent-detail-popout-btn")
    popoutBtn?.addEventListener("click", () => {
      const sid = stateManager.getState().activeSessionId
      if (!sid) {
        webviewLog("[main] open_subagent_detail: no active session")
        return
      }
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
  }

  function isUserTodoId(todoId: string): boolean {
    return todoId.startsWith("todo-")
  }

  function toggleTodo(todoOrId: string | Todo): void {
    const todoId = typeof todoOrId === "string" ? todoOrId : todoOrId.id
    if (!isUserTodoId(todoId)) return
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return
    const todo = session.userTodos?.find(t => t.id === todoId)
    if (!todo) return
    todo.status = todo.status === "completed" ? "pending" : "completed"
    stateManager.save()
    triggerTodosRender(activeSid)
  }

  function deleteTodo(todoId: string): void {
    if (!isUserTodoId(todoId)) return
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return
    session.userTodos = session.userTodos?.filter(t => t.id !== todoId) || []
    stateManager.save()
    triggerTodosRender(activeSid)
  }

  function addUserTodo(content: string): void {
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return

    const normalized = content.trim().normalize("NFC")
    if (!normalized) return
    if (normalized.length > 500) {
      console.warn("Todo content exceeds 500 character limit")
      return
    }

    session.userTodos ??= []
    const dupKey = normalized.toLowerCase()
    const exists = session.userTodos.some(
      t => t.content.trim().normalize("NFC").toLowerCase() === dupKey
    )
    if (exists) {
      console.warn("Duplicate todo ignored")
      return
    }

    const id = generateTodoId()
    session.userTodos.push({
      id,
      content: normalized,
      status: "pending",
      createdAt: Date.now()
    })
    stateManager.save()
    triggerTodosRender(activeSid)
  }

  function editUserTodo(todoId: string, newContent: string): void {
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return

    const normalized = newContent.trim().normalize("NFC")
    if (!normalized || normalized.length > 500) return

    const todo = session.userTodos?.find(t => t.id === todoId)
    if (!todo) return

    todo.content = normalized
    webviewLog(`[todos] edited user todo ${todoId}`)
    stateManager.save()
    triggerTodosRender(activeSid)
  }

  function setupChangedFilesFeature(): void {
    if (!els.changedFilesDropdown || !els.cfDropdownTree) return

    setupChangedFilesDropdown({
      btn: els.changedFilesBtn ?? null,
      panel: els.changedFilesDropdown,
      treeContainer: els.cfDropdownTree,
      badge: null,
      postMessage: (msg) => vscode.postMessage(msg),
      onOpenFile: (path) => vscode.postMessage({ type: "open_file", path }),
      onOpenChangedFileDiff: (path, sessionId) => vscode.postMessage({ type: "open_changed_file_diff", path, sessionId }),
      isWelcomeVisible,
      beforeToggle: () => surfaceCoord?.closeOthers("changed-files-dropdown"),
    })
    cfDropdownApi = { updateChangedFiles, handleDiffResponse: handleCfDiffResponse, setCurrentSession: setCfCurrentSession }

    const strip = document.getElementById("changed-files-strip")
    strip?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); strip.click() }
    })
  }

  function setupContextUsageFeature(): void {
    if (!els.contextUsageDropdown || !els.ctxDropdownContent) return

    setupCtxDropdown({
      btn: null,
      panel: els.contextUsageDropdown,
      content: els.ctxDropdownContent,
      postMessage: (msg) => vscode.postMessage(msg),
    })
    ctxDropdownApi = { updateUsage: updateCtxDropdown }
    els.contextUsage.addEventListener("click", (e) => {
      e.stopPropagation()
      openPrimedContextUsageDropdown()
    })
    els.contextUsage.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPrimedContextUsageDropdown() }
    })
  }

  function openPrimedContextUsageDropdown(): void {
    const activeId = stateManager.getState().activeSessionId
    const activeSess = activeId ? stateManager.getSession(activeId) : undefined
    if (activeSess?.contextUsage) {
      ctxDropdownApi?.updateUsage({ type: "context_usage", ...activeSess.contextUsage } as Record<string, unknown>)
    }
    surfaceCoord?.closeOthers("context-usage-dropdown")
    openContextUsageDropdown()
  }

  function finishWebviewInitialization(): void {
    initStaticButtonTooltips()
    setupWelcomeSuggestions()
    setupWelcomeActions()
    wireStreamOrchestrator()
    wireTimeline()
    setupMessageListener()
    setupPermissionListener()
    questionBar.initQuestionBar((m) => vscode.postMessage(m))
    setupDiffActionListener()
    composer.restoreQueues()
    // Request fresh queue state from host — keeps our render cache in sync after reload
    vscode.postMessage({ type: "request_queue_state" })
    timeline.setupTimelineToggle()
    timeline.setupThinkingToggle()
    setupToolKeyboardNav()
    setupSettingsMenuKeyboardNav()
    composer.updateSendButton()
    setVsCodeApi(vscode)
    setSessionListPostMessage((msg) => {
      // Route history-modal session opens through openSession so clicking an
      // already-open tab switches locally instead of triggering the host's
      // full server-transcript refetch (see openSession).
      const m = msg as Record<string, unknown>
      if (m?.type === "resume_session" && typeof m.sessionId === "string") {
        openSession(m.sessionId)
        return
      }
      vscode.postMessage(m)
    })
    showWelcomeView()
    window.__opencodeInitTimeout = timers.setTimeout(() => {
      if (!stateManager.getState().activeSessionId) {
        log.warn("No init_state received, showing welcome view")
        showWelcomeView()
      }
    }, 3000)
  }

  function showInitializationFailure(err: unknown): void {
    log.error("Initialization error:", err)
    const errorDiv = document.createElement("div")
    errorDiv.className = "error-boundary"
    errorDiv.classList.add("error-boundary--visible")
    errorDiv.textContent = "Failed to initialize. Please reload."
    document.body.appendChild(errorDiv)
  }

  const welcomeViewDeps: WelcomeViewDeps = {
    els: {
      welcomeView: els.welcomeView,
      welcomeNewBtn: els.welcomeNewBtn,
      welcomeModelCtx: els.welcomeModelCtx,
      welcomeContinueBtn: els.welcomeContinueBtn,
      welcomeModelName: els.welcomeModelName,
      welcomeSearchInput: els.welcomeSearchInput,
      promptInput: els.promptInput,
      welcomeModelEmptyBanner: els.welcomeModelEmptyBanner,
      welcomeEmptyBannerLink: els.welcomeEmptyBannerLink,
    },
    postMessage: (msg) => vscode.postMessage(msg),
    getAllSessions: () => stateManager.getAllSessions(),
    getState: () => {
      const s = stateManager.getState()
      return { ...s, activeSessionId: s.activeSessionId ?? undefined }
    },
    openModelManager: () => { surfaceCoord?.closeOthers("model-manager-panel"); modelManager.open() },
    getResolvedModel: () =>
      stateManager.getState().globalModel ||
      stateManager.getActiveSession()?.model ||
      modelDropdown.getCurrentModel() ||
      undefined,
    renderRecentSessionsList,
    onDeleteRecentSession: (sessionId) => {
      vscode.postMessage({ type: "delete_session", targetSessionId: sessionId })
    },
    hideStatusStrip,
    applyTimelineVisibility,
    autoResizeTextarea,
    updateSendButton,
    sendMessage: () => composer.sendMessage(),
  }

  function showWelcomeView() {
    showWelcomeViewModule(welcomeViewDeps)
    // Re-apply the welcome guard to the changed-files strip/dropdown — its
    // render-time check can't see this transition on its own.
    refreshChangedFilesVisibility()
  }

  function hideWelcomeView() {
    hideWelcomeViewModule(els)
    refreshChangedFilesVisibility()
  }

  function renderWelcomeContext() {
    renderWelcomeContextModule(welcomeViewDeps)
  }

  function setupWelcomeActions() {
    setupWelcomeActionsModule(welcomeViewDeps)
    const welcomeShortcutsBtn = document.getElementById("welcome-shortcuts-btn")
    welcomeShortcutsBtn?.addEventListener("click", () => openKeyboardShortcutsModal())
  }

  /* ─── RECENT SESSIONS ─── */

  function renderRecentSessionsList(filterQuery: string = "", hostSessions?: SessionSummary[]) {
    const query = (filterQuery || "").trim().toLowerCase()
    const recentContainer = document.getElementById("welcome-recent-sessions") as HTMLDivElement | null
    if (!recentContainer) return

    if (hostSessions) {
      renderRecentSessions(
        prepareHostRecentSessions(hostSessions),
        recentContainer,
        () => vscode.postMessage({ type: "list_sessions", query: filterQuery.trim() }),
        (sessionId) => openSession(sessionId),
        !!query
      )
      return
    }

    const prepared = prepareLocalRecentSessions(
      stateManager.getAllSessions(),
      stateManager.getState().activeSessionId,
      filterQuery
    )
    if (!prepared.hasCandidates) {
      recentContainer.style.display = "none"
      return
    }

    renderRecentSessions(
      prepared.sessions,
      recentContainer,
      () => vscode.postMessage({ type: "list_sessions" }),
      (sessionId) => openSession(sessionId),
      prepared.isFiltered
    )
  }

  /* ─── SESSION HISTORY MODAL ─── */

  function setupSessionModal() {
    setupSessionModalModule({
      els,
      setUnifiedLocalSessions,
      setUnifiedServerSessions,
      setUnifiedSessionQuery,
      renderUnifiedSessionList,
      postMessage: (msg) => vscode.postMessage(msg),
      onClose: () => {
        // Drop any portaled ⋮ menus attached to <body> so they don't stick
        // around after the modal hides. `renderUnifiedSessionList` already
        // cleans up on every list re-render; this catches the close-without-
        // rerender path (Escape, X button, backdrop click).
        disposePortaledMoreMenus()
      },
    })
  }

  // context-usage-dropdown is set up inline below; no separate panel needed.

  const sessionModalDeps = {
    els,
    setUnifiedLocalSessions,
    setUnifiedServerSessions,
    setUnifiedSessionQuery,
    renderUnifiedSessionList,
    postMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
  }

  function openSessionModal(sessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }>, query = "") {
    openSessionModalModule(sessionModalDeps, sessions, query)
  }


  /* ─── TAB MANAGEMENT ─── */

  function contextUsageHasFill(usage: Pick<ContextUsage, "tokens" | "percent"> | undefined): boolean {
    return !!usage && (
      (Number.isFinite(usage.tokens) && usage.tokens > 0) ||
      (Number.isFinite(usage.percent) && usage.percent > 0)
    )
  }

  function getMessageRenderSignature(messages: ChatMessage[]): string {
    return messages.map((m) => {
      const blockSig = m.blocks.map((b) => {
        const textLength = "text" in b && typeof b.text === "string" ? b.text.length : 0
        return `${b.type}:${textLength}`
      }).join(",")
      return `${m.id ?? ""}:${m.role}:${m.blocks.length}:${blockSig}`
    }).join("|")
  }

  function shouldRenderHydratedMessages(sessionId: string, msgList: HTMLDivElement, messages: ChatMessage[]): boolean {
    const signature = getMessageRenderSignature(messages)
    if (renderedMessageSignatures.get(sessionId) === signature && msgList.childElementCount > 0) {
      webviewLog(`[main] init_state skipped unchanged message render for session=${sessionId}`)
      return false
    }
    renderedMessageSignatures.set(sessionId, signature)
    return true
  }

  function attachScrollPersistence(tabId: string, msgList: HTMLDivElement): void {
    if (msgList.dataset.scrollPersistAttached === "1") return
    msgList.dataset.scrollPersistAttached = "1"
    msgList.addEventListener("scroll", () => {
      const pending = scrollSaveTimers.get(tabId)
      if (pending) timers.clearTimeout(pending)
      const timer = timers.setTimeout(() => {
        scrollSaveTimers.delete(tabId)
        stateManager.setScrollPosition(tabId, msgList.scrollTop)
      }, 150)
      scrollSaveTimers.set(tabId, timer)
    }, { passive: true })
  }

  function restoreScrollPosition(tabId: string, msgList: HTMLDivElement, autoScrollWhenUnset = false): void {
    const saved = stateManager.getScrollPosition(tabId)
    if (saved > 0) {
      msgList.scrollTop = Math.min(saved, Math.max(0, msgList.scrollHeight - msgList.clientHeight))
      webviewLog(`[main] restored scroll session=${tabId} scrollTop=${Math.round(msgList.scrollTop)}`)
      return
    }
    if (autoScrollWhenUnset) {
      scrollToBottom(msgList)
    }
  }

  function createNewTab(name?: string) {
    // Adopt the pending mode chosen on the welcome screen (defaults to "build").
    const session = stateManager.createSession(name, undefined, stateManager.getPendingMode())
    createTabUI(session.id, session.name)

    // Always switch to the newly created tab — it's the user's current focus
    stateManager.setActiveSession(session.id)
    switchToTab(els, session.id)
    hideWelcomeView()

    // Reflect the new session's mode in the selector (it may differ from the
    // previously-active session's mode or the welcome-screen pending mode).
    syncModeUI()
    updateTabBar()
    renderRecentSessionsList()
    // New tab is never streaming — sync chat bar so it doesn't inherit the
    // streaming state visually from a previously-active streaming session.
    updateSendButton()
    els.promptInput.placeholder = "Ask OpenCode a question about your code…"
    // Auto-focus the prompt on new tab (matches VS Code Copilot Chat /
    // Cursor / Claude Code behavior)
    els.promptInput.focus()
    els.inputArea.classList.remove("steer-interrupt", "steer-queue")
    return session
  }

  function createTabUI(tabId: string, tabName: string) {
    // Check if content already exists
    if (els.tabPanels.querySelector(`.tab-panel[data-tab-id="${tabId}"]`)) return

    // Ensure the session exists in state — defensive guard so the tab is
    // always backed by valid state regardless of how it was triggered.
    let session = stateManager.getSession(tabId)
    if (!session) {
      session = stateManager.ensureSession({
        id: tabId,
        name: tabName || "",
        model: stateManager.getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
    }

    const [view] = createTabContent(tabId, tabName, {
      onSwitch: (tabId) => switchTab(tabId),
      onClose: (tabId) => closeTab(tabId),
      onNew: () => createNewTab(),
    })
    if (!view) return

    // Find insertion position based on state order
    const order = stateManager.getState().sessionOrder
    const targetIdx = order.indexOf(tabId)

    if (targetIdx !== -1 && targetIdx < order.length - 1) {
      // Find the next session's panel to insert before it
      const nextSessionId = order[targetIdx + 1]
      const nextPanel = els.tabPanels.querySelector(`.tab-panel[data-tab-id="${nextSessionId}"]`)
      if (nextPanel) {
        els.tabPanels.insertBefore(view, nextPanel)
      } else {
        els.tabPanels.appendChild(view)
      }
    } else {
      els.tabPanels.appendChild(view)
    }

    // Create stream handler for this tab — always, since we guaranteed session above
    const stream = createStreamHandlersForTab(tabId)
    streamHandlers.set(tabId, stream)
    const msgList = getMessageList(tabId)
    if (msgList) {
      attachScrollPersistence(tabId, msgList)
    }
    vscode.postMessage({
      type: "create_tab",
      sessionId: tabId,
      name: session.name,
      model: session.model,
      mode: session.mode,
    })
  }

  // Show/hide the streaming-only send-mode (Queue|Interrupt) affordance + placeholder
  // for the ACTIVE tab. Driven by the active session's streaming state so it stays
  // correct when switching to an already-streaming tab (streaming_state only fires on
  // real transitions, not tab switches).
  function syncSteerAffordance(): void {
    const active = stateManager.getActiveSession()
    const streaming = Boolean(active?.isStreaming)
    const selector = document.getElementById("steer-mode-selector") as HTMLElement | null
    if (selector) selector.classList.toggle("hidden", !streaming)
    // Context-aware placeholder: show model and stream capacity when idle,
    // show steer hint when streaming.
    const modelLabel = active?.model
      ? active.model.replace(/^.*\//, "").replace(/-20\d{6}/, "").slice(0, 20)
      : ""
    const cap = composer.getStreamCapacityState()
    const capLabel = !cap.isFull && cap.activeStreams < cap.maxStreams ? ` (${cap.activeStreams}/${cap.maxStreams})` : ""
    els.promptInput.placeholder = streaming
      ? "Guide the AI: correct errors, change direction, or add context…"
      : modelLabel
        ? `Ask OpenCode (${modelLabel}${capLabel})…`
        : "Ask OpenCode a question about your code…"
    if (!streaming) els.inputArea.classList.remove("steer-interrupt", "steer-queue")
  }

  function hidePermissionBar() {
    const permBar = document.getElementById("permission-bar")
    const permActions = document.getElementById("permission-bar-actions")
    permBar?.classList.add("hidden")
    if (permActions) permActions.innerHTML = ""
  }

  function renderPermissionBar(sid: string, req: { permissionId: string; permissionType?: string; pattern?: string | string[]; title: string }) {
    const permBar = document.getElementById("permission-bar")
    const permText = document.getElementById("permission-bar-text")
    const permActions = document.getElementById("permission-bar-actions")
    if (!permBar || !permText || !permActions) return

    const { permissionId, permissionType, pattern, title } = req
    permText.textContent = title
    permActions.innerHTML = ""

    const respond = (response: "once" | "always" | "reject") => {
      vscode.postMessage({ type: "accept_permission", sessionId: sid, permissionId, response, permissionType, pattern })
      pendingPermissionBySession.delete(sid)
      hidePermissionBar()
    }

    const allowBtn = document.createElement("button")
    allowBtn.className = "permission-bar-btn permission-bar-btn--allow"
    allowBtn.textContent = "Allow"
    allowBtn.type = "button"
    allowBtn.addEventListener("click", () => respond("once"))

    const alwaysBtn = document.createElement("button")
    alwaysBtn.className = "permission-bar-btn permission-bar-btn--always"
    alwaysBtn.textContent = "Always"
    alwaysBtn.type = "button"
    alwaysBtn.addEventListener("click", () => respond("always"))

    const denyBtn = document.createElement("button")
    denyBtn.className = "permission-bar-btn permission-bar-btn--deny"
    denyBtn.textContent = "Deny"
    denyBtn.type = "button"
    denyBtn.addEventListener("click", () => respond("reject"))

    permActions.appendChild(allowBtn)
    if (pattern) permActions.appendChild(alwaysBtn)
    permActions.appendChild(denyBtn)
    permBar.classList.remove("hidden")
  }

  function switchTab(tabId: string, notifyHost = true) {
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
        session.changedFiles.map((p) => ({ path: p, added: 0, removed: 0 })) as any
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

    // Restore this tab's own pending permission request (if any), or hide
    // the bar — it must never keep showing a request that belongs to the
    // tab we just switched away from.
    const pendingPermission = pendingPermissionBySession.get(tabId)
    if (pendingPermission) {
      renderPermissionBar(tabId, pendingPermission)
    } else {
      hidePermissionBar()
    }
  }

  /**
   * Open a session from the recent list / history modal. A session that is
   * already open as a tab is fully hydrated and kept current by SSE events —
   * switch to it locally instead of posting resume_session, which makes the
   * host re-fetch the ENTIRE server transcript, re-apply it to the store, and
   * re-push a 50-message payload for a tab that was already correct. Only
   * genuinely-closed sessions take the heavyweight resume path.
   */
  function openSession(targetId: string) {
    const hasPanel = !!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${CSS.escape(targetId)}"]`)
    if (hasPanel && stateManager.getSession(targetId)) {
      switchTab(targetId)
      return
    }
    vscode.postMessage({ type: "resume_session", sessionId: targetId })
  }

  function closeTab(tabId: string) {
    const wasActive = stateManager.getState().activeSessionId === tabId

    // Check if session is actively streaming and abort if needed
    const session = stateManager.getSession(tabId)
    const isStreaming = session?.isStreaming || false

    // Abort any streaming
    const stream = streamHandlers.get(tabId)
    if (stream) {
      stream.hideTypingIndicator()
    }

    // Send abort message to extension if streaming was active
    if (isStreaming) {
      vscode.postMessage({ type: "abort", sessionId: tabId })
      stateManager.setStreaming(tabId, false)
    }

    // Soft close - keep in state but remove from UI
    stateManager.deleteSession(tabId)
    stateManager.flush()  // Ensure state is persisted
    removeTabContent(els, tabId)
    
    // Delete stream handler after cleanup
    streamHandlers.delete(tabId)

    // Drop cached server-side todos for the closed tab so they cannot be
    // re-rendered into a re-used session id later.
    serverTodosBySession.delete(tabId)
    todosDismissedBySession.delete(tabId)
    todosAutoOpenedForSession.delete(tabId)

    // Clean up tool timing data
    toolElapsedTracker.clearForPrefix(tabId)

    // Clear prompt queue for this tab
    const queue = promptQueues.get(tabId)
    if (queue) {
      queue.clear()
      promptQueues.delete(tabId)
    }
    persistQueues()
    const queueContainer = els.inputArea.querySelector(".prompt-queue")
    if (queueContainer) queueContainer.remove()

    // Dispose scroll anchor for this tab
    const anchor = scrollAnchors.get(tabId)
    if (anchor) {
      anchor.dispose()
      scrollAnchors.delete(tabId)
    }

    // Dispose virtual list for this tab. The panel DOM is removed with the
    // tab, so skip restoreAll — re-rendering every detached message into a
    // container that is about to be discarded is pure wasted main-thread work.
    disposeVirtualList(tabId, { restoreDom: false })

    // Remove jump-to-bottom for this tab
    const jtb = els.tabPanels.querySelector(`.jump-to-bottom[data-tab-id="${tabId}"]`)
    if (jtb) jtb.remove()
    const markers = els.tabPanels.querySelector(`.scroll-markers[data-tab-id="${tabId}"]`)
    if (markers) markers.remove()

    // Clear question bar items for the closed tab (fixes multi-tab ghost count)
    questionBar.clearForSession(tabId)

    // Notify backend
    vscode.postMessage({ type: "close_tab", sessionId: tabId })

    if (wasActive) {
      const newActive = stateManager.getState().activeSessionId
      if (newActive) {
        switchToTab(els, newActive)
        vscode.postMessage({ type: "switch_tab", sessionId: newActive })
      }
    }

    updateTabBar()
    renderRecentSessionsList()

    // If no sessions remain, show welcome view instead of creating an empty tab
    if (stateManager.getAllSessions().length === 0) {
      showWelcomeView()
    }
  }

  function updateTabBar() {
    const sessions = stateManager.getAllSessions()
    const activeId = stateManager.getState().activeSessionId || ""
    const tabs = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      model: s.model,
      isStreaming: s.isStreaming,
    }))
    tabBar.renderTabs(tabs, activeId, getStreamCapacityState())
  }

  function getMessageList(tabId: string): HTMLDivElement | null {
    const escapedId = CSS.escape(tabId)
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${escapedId}"]`)
    return view?.querySelector<HTMLDivElement>(".message-list") || null
  }

  function getTypingIndicator(tabId: string): HTMLDivElement | null {
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${tabId}"]`)
    return view?.querySelector<HTMLDivElement>(".typing-indicator") || null
  }

  /* ─── STREAMING ─── */

  function createStreamHandlersForTab(tabId: string): StreamHandlers {
    const session = stateManager.getSession(tabId)
    if (!session) throw new Error(`No session for tab ${tabId}`)

    const msgList = getMessageList(tabId)
    const typingInd = getTypingIndicator(tabId)

    // Create or reuse scroll anchor for this tab
    let scrollAnchor = scrollAnchors.get(tabId)
    if (!scrollAnchor && msgList) {
      scrollAnchor = createScrollAnchor(msgList, typingInd || undefined)
      scrollAnchors.set(tabId, scrollAnchor)
    }

    // Create StreamElements for this tab
    const streamEls = {
      messageList: msgList || document.createElement("div"),
      typingIndicator: typingInd || document.createElement("div"),
      typingLabel: (typingInd?.querySelector(".typing-text") || document.createElement("span")) as HTMLSpanElement,
      scrollAnchor: scrollAnchor || createScrollAnchor(document.createElement("div")),
    }
    let lastRenderAckAt = 0
    let lastRenderAckSeq = 0
    const postRenderAck = (chunkSeq: number, force = false): void => {
      if (chunkSeq <= 0) return
      const now = Date.now()
      if (!force && chunkSeq <= lastRenderAckSeq) return
      if (!force && now - lastRenderAckAt < STREAM_ACK_MIN_INTERVAL_MS) return
      lastRenderAckAt = now
      lastRenderAckSeq = Math.max(lastRenderAckSeq, chunkSeq)
      vscode.postMessage({ type: "stream_ack", sessionId: tabId, lastRenderedChunkSeq: chunkSeq })
    }

    const stream = createStreamHandlers(streamEls, session.messages, () => {
      stateManager.save()
    }, {
      // Enables interactive blocks (e.g. question_answer) to post to the host
      // while a stream is still running, instead of waiting for stream_end.
      postMessage: (m) => vscode.postMessage(m),
      onRenderFlush: postRenderAck,
      // Pass this tab's id as the envelope sid. The live-streaming ChatMessage
      // this block belongs to never carries a sessionId (handleStreamStart
      // creates it with none), so block.sessionId is always empty here. Without
      // this third argument, addQuestion's fallback chain lands on whichever
      // tab the user currently has open, misattributing a background tab's
      // question to the viewed tab (multi-tab bleed).
      onQuestionBlock: (block, messageId) => questionBar.addQuestion(block, messageId, tabId),
    })

    // WARNING: Class methods live on the prototype, not as own properties.
    // Using spread (...stream) on a class instance LOSES all methods!
    // Use Object.create + Object.assign to preserve the prototype chain.
    return Object.assign(
      Object.create(Object.getPrototypeOf(stream)),
      stream,
      {
        showTypingIndicator: (label?: string) => {
          if (typingInd) {
            typingInd.classList.remove("hidden")
            const labelEl = typingInd.querySelector(".typing-text")
            if (labelEl) labelEl.textContent = label || "Thinking..."
          }
          if (msgList && scrollAnchor) scrollAnchor.scrollIfAnchored()
        },
        hideTypingIndicator: () => {
          if (typingInd) typingInd.classList.add("hidden")
        },
      }
    )
  }

  /* ─── MODE DROPDOWN ─── */

  function updateModeDropdownLocal(mode: string) {
    updateModeDropdown(mode, els)
    const app = document.getElementById("app")
    if (app) {
      app.classList.toggle("mode-plan", mode === "plan")
      app.classList.toggle("mode-build", mode === "build")
      app.classList.toggle("mode-auto", mode === "auto")
    }
  }

  function updateModeSelectorStateLocal() {
    updateModeSelectorState(els, () => stateManager.getActiveSession())
  }

  function syncModeUI() {
    syncModeUIModule(els, () => stateManager.getActiveSession(), () => stateManager.getPendingMode())
    const active = stateManager.getActiveSession()
    const app = document.getElementById("app")
    if (app) {
      const mode = normalizeSessionMode(active?.mode) || normalizeSessionMode(stateManager.getPendingMode()) || "build"
      app.classList.toggle("mode-plan", mode === "plan")
      app.classList.toggle("mode-build", mode === "build")
      app.classList.toggle("mode-auto", mode === "auto")
    }
  }

  /* ─── PER-TAB INSTRUCTIONS (GEAR) ─── */

  function setupInstructionsEditorLocal() {
    setupInstructionsEditor({
      els,
      getActiveSession: () => stateManager.getActiveSession(),
      saveSession: () => stateManager.save(),
      postMessage: (msg) => vscode.postMessage(msg),
      clearTimeout: (id) => timers.clearTimeout(id),
    })
  }

  setupInstructionsEditorLocal()

  /* ─── AUTO MODE WARNING ─── */

  let undoRedo: Array<{ themePreset: string; themeOverrides: Record<string, string> }> = []
  const UNDO_REDO_MAX_SIZE = 50

  function pushUndoRedo(state: { themePreset: string; themeOverrides: Record<string, string> }): void {
    undoRedo.push(state)
    if (undoRedo.length > UNDO_REDO_MAX_SIZE) {
      undoRedo.shift()
    }
  }

  function undoRedoPush(state: { themePreset: string; themeOverrides: Record<string, string> }): void {
    pushUndoRedo(state)
  }

  /* ─── INPUT ─── */

  function updatePromptContextChips() {
    composer.updatePromptContextChips()
  }

  function autoResizeTextarea() {
    composer.autoResizeTextarea()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thin wrapper; capacity shape is owned by composer
  function getStreamCapacityState(): any {
    return composer.getStreamCapacityState()
  }

  function updateSendButton() {
    composer.updateSendButton()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamCapacity shape is owned by composer
  function updateSendButtonIcon(isStreaming?: boolean, streamCapacity?: any) {
    composer.updateSendButtonIcon(isStreaming, streamCapacity)
  }

  function isAutoSessionName(name?: string): boolean {
    return composer.isAutoSessionName(name)
  }

  function persistQueues() {
    composer.persistQueues()
  }

  function renderQueue(tabId: string) {
    composer.renderQueue(tabId)
  }

  function sendMessage() {
    composer.sendMessage()
  }

  function abortStream() {
    composer.abortStream()
  }

  function closeSettingsMenu() {
    closeSettingsMenuModule(els)
  }

  function setupSettingsMenuKeyboardNav() {
    setupSettingsMenuKeyboardNavModule(els, closeSettingsMenu)
  }

  type ThemeCustomizerConfig = {
    preset?: string
    overrides?: Record<string, string>
  }

  const themeDeps = {
    els,
    postMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
    pushUndo: (state: { themePreset: string; themeOverrides: Record<string, string> }) => undoRedoPush(state),
  }
  setupThemeCustomizer(themeDeps)

  /* ─── PROVIDER PANEL ─── */

  const providerAuthMethods = new Map<string, ProviderAuthMethodInfo[]>()
  let providerDiscoveryItems: ProviderDiscoveryItem[] = []
  let providerCredentials: ProviderCredentialInfo[] = []

  setupProviderPanel({
    postMessage: (msg) => vscode.postMessage(msg),
    trapFocus: (container) => trapModalFocus(container),
  })

  /* ─── WELCOME ─── */

  function setupWelcomeSuggestions() {
    setupWelcomeSuggestionsModule(welcomeViewDeps)
    setupWelcomeResponsiveModule(welcomeViewDeps)
  }

  /* ─── SEARCH ─── */

  setupSearch(() => els.tabPanels.querySelector(".tab-panel.active"))

  /* ─── MESSAGES ─── */

  function showSystemMessage(sessionId: string, text: string, retryable?: boolean) {
    const msg: ChatMessage = {
      role: "system",
      id: createWebviewId("sys"),
      blocks: [{ type: "text", text }],
      timestamp: Date.now(),
      sessionId,
    }
    addMessage(sessionId, msg)

    if (retryable) {
      const msgList = getMessageList(sessionId)
      if (msgList) {
        const lastMsg = msgList.querySelector(`[data-message-id="${msg.id}"]`)
        if (lastMsg) {
          const retryBtn = document.createElement("button")
          retryBtn.className = "retry-btn"
          retryBtn.textContent = "Retry from here"
          retryBtn.addEventListener("click", () => {
            retryBtn.remove()
            vscode.postMessage({ type: "retry_stream", sessionId })
          })
          const bubble = lastMsg.querySelector(".message-bubble, .system-bubble")
          if (bubble) bubble.appendChild(retryBtn)
        }
      }
    }
  }

  function generateTitleFromBlocks(blocks: ChatMessage["blocks"]): string {
    const textBlock = blocks.find((b) => b.type === "text")
    const text = typeof textBlock?.text === "string" ? textBlock.text : ""
    // Delegate to the shared pure extractor (also used by the host) — kills
    // the duplicate-code smell where the webview's generator diverged from
    // sessionUtils.generateTitleFromMessage. extractTitle handles
    // boilerplate stripping and word-boundary truncation that the old
    // 37-char hard-slice did not, so prompts opening with the same prefix
    // no longer collapse to identical tab labels.
    return extractTitle(text)
  }

  /* ─── JUMP-TO-BOTTOM & SCROLL MARKERS ─── */

  const scrollMarkerDeps: ScrollMarkerDeps = {
    getMessageList: (id) => getMessageList(id),
    getActiveMessageList: () => getActiveMessageList(els),
    getSession: (id) => stateManager.getSession(id),
    timers,
  }

  const updateScrollMarkers = (sessionId: string) => {
    updateScrollMarkersModule(scrollMarkerDeps, sessionId)
  }

  const setupJumpToBottom = (sessionId: string) => {
    setupJumpToBottomModule(scrollMarkerDeps, sessionId)
  }

  function applyHistoryCondensation(sessionId: string): void {
    timeline.applyHistoryCondensation(sessionId)
  }

  function addMessage(sessionId: string, msg: ChatMessage) {
    // Auto-create the session locally if the extension is referring to one
    // we haven't seen yet (e.g. it was filtered from init_state for being empty,
    // or stream events arrived before init_state finished).
    let session = stateManager.getSession(sessionId)
    if (!session) {
      session = stateManager.ensureSession({
        id: sessionId,
        name: "",
        model: stateManager.getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
      if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)) {
        createTabUI(sessionId, session.name)
      }
      updateTabBar()
    }

    // Any message arriving means we're past the welcome state.
    hideWelcomeView()

    // C1: upsert by id so a stream_end re-adding the same id that streaming
    // already created does not leave a duplicate in session.messages.
    //
    // Switch markers (agent/model.switched) are placed BEFORE the trailing
    // assistant generation they configure rather than appended at the bottom —
    // matching the host's ordering (SessionStore.appendOrCoalesceActivity) so
    // live view, re-render and reload all agree. `switchAnchorId` is the message
    // the marker was inserted before, used to mirror the position in the DOM.
    const switchBlock0 = msg.blocks?.[0] as Record<string, unknown> | undefined
    const isNewSwitch =
      msg.role === "system" &&
      !!msg.id &&
      isSwitchEventType(switchBlock0?.eventType) &&
      !session.messages.some((m) => m.id === msg.id)
    let switchAnchorId: string | null = null
    if (isNewSwitch) {
      const insertIdx = switchInsertIndex(session.messages)
      session.messages.splice(insertIdx, 0, msg)
      switchAnchorId = session.messages[insertIdx + 1]?.id ?? null
    } else {
      upsertMessageById(session.messages, msg)
    }

    // Auto-generate title from first user message.
    //
    // Dedupe against the live tab set so three prompts opening with the same
    // boilerplate prefix ("# Role & Objective\n...") don't produce three
    // visually identical tabs. The dedupe suffix (e.g. " (2)") is applied
    // locally; the server may later override via session.updated →
    // session_title_updated (which always wins — see handler below).
    if (msg.role === "user" && isAutoSessionName(session.name)) {
      const generated = generateTitleFromBlocks(msg.blocks)
      if (generated) {
        const existingNames = stateManager.getAllSessions()
          .filter((s) => s.id !== sessionId)
          .map((s) => s.name)
          .filter((n) => typeof n === "string" && n.length > 0)
        const deduped = dedupeTitle(generated, new Set(existingNames))
        session.name = deduped
        stateManager.renameSession(sessionId, deduped)
        vscode.postMessage({ type: "rename_session", sessionId, name: deduped })
        // In-place patch — no focus clobber, no innerHTML wipe (D4 fix).
        patchTabLabel(els, sessionId, deduped)
      }
    }

    const msgList = getMessageList(sessionId)
    if (msgList) {
      // Avoid duplicate rendering if the message is already in the DOM (e.g. from streaming)
      const existing = msg.id ? msgList.querySelector(`[data-message-id="${CSS.escape(msg.id)}"]`) : null
      if (existing) {
        // If it's a streaming placeholder, replace it with the final rendered version.
        // This ensures the final Markdown is correctly applied and avoids double messages.
        const el = renderMessage(msg, { mode: session.mode, postMessage: (m) => vscode.postMessage(m), skipHeader: true })
        existing.replaceWith(el)
        stateManager.save()
        refreshActivityAndTasks(sessionId)
        return
      }

      const welcome = msgList.querySelector(".welcome-container")
      if (welcome) welcome.remove()

      const start = Date.now()
      const lastMsg = session.messages.length > 1 ? session.messages[session.messages.length - 2] : null
      const isConsecutive = lastMsg?.role === msg.role
      const el = renderMessage(msg, { mode: session.mode, postMessage: (m) => vscode.postMessage(m) }, isConsecutive)
      const elapsed = Date.now() - start
      if (elapsed > 50) {
        if ((window as unknown as { __opencodeDebug?: unknown }).__opencodeDebug) {
          console.debug(`[perf] renderMessage took ${elapsed}ms for ${msg.role} msg ${msg.id?.slice(0, 16)}`)
        }
      }
      const switchAnchorEl = switchAnchorId
        ? msgList.querySelector(`[data-message-id="${CSS.escape(switchAnchorId)}"]`)
        : null
      if (switchAnchorEl) {
        msgList.insertBefore(el, switchAnchorEl)
      } else {
        msgList.appendChild(el)
      }
      const vl = getVirtualList(sessionId)
      if (vl) vl.onMessageAdded(el)
      applyHistoryCondensation(sessionId)
      const anchor = scrollAnchors.get(sessionId)
      if (anchor) {
        anchor.scrollIfAnchored()
      } else {
        scrollToBottom(msgList)
      }
    }
    stateManager.save()
    refreshActivityAndTasks(sessionId)

    // Set up jump-to-bottom button on first message
    if (msgList && !msgList.querySelector(".jump-to-bottom")) {
      setupJumpToBottom(sessionId)
    }

    // Update scroll markers — debounced so rapid streaming doesn't cause O(n) DOM thrash
    debouncedUpdateScrollMarkers(sessionId)

    // Refresh conversation timeline when active session gains a new turn — debounced
	    if (sessionId === stateManager.getState().activeSessionId) {
	      debouncedTimelineRefresh(sessionId)
	    }
	  }

  /* ─── PERMISSION LISTENER ─── */

  function setupPermissionListener() {
    window.addEventListener("oc-permission", ((e: CustomEvent) => {
      const active = stateManager.getActiveSession()
      vscode.postMessage({ type: "accept_permission", sessionId: active?.id, ...e.detail })
    }) as EventListener)
  }

  function setupDiffActionListener() {
    window.addEventListener("oc-diff-action", ((e: CustomEvent) => {
      const active = stateManager.getActiveSession()
      vscode.postMessage({ sessionId: active?.id, ...e.detail })
    }) as EventListener)
  }


  /* ─── MESSAGE LISTENER ─── */

  function setupMessageListener() {
    function isValidSessionId(id: string | undefined): id is string {
      return !!id
    }

    type MsgHandler = (msg: LegacyHostMessage, sessionId: string | undefined) => void

    const messageHandlers = new Map<string, MsgHandler>([
      ["message", (msg) => { if (msg.message) handleHostMessage(msg.message as ChatMessage) }],
      ["prompt_accepted", (msg, sid) => {
        const messageId = typeof msg.messageId === "string" ? msg.messageId : undefined
        if (!sid || !messageId) return
        const el = getMessageList(sid)?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
        el?.classList.add("prompt-confirmed")
        webviewLog(`[main] prompt accepted session=${sid} message=${messageId}`)
      }],
      ["prompt_send_failed", (msg, sid) => {
        if (!sid) return
        const text = typeof msg.text === "string" ? msg.text : ""
        const reason = typeof msg.reason === "string" ? msg.reason : "Failed to send prompt"
        stateManager.setStreaming(sid, false)
        if (stateManager.getState().activeSessionId === sid && text && !els.promptInput.value.trim()) {
          els.promptInput.value = text
          autoResizeTextarea()
        }
        updateAgentStatus("idle")
        updateTabBar()
        updateModeSelectorStateLocal()
        updateSendButton()
        handleRequestError(sid, reason)
      }],
      ["unknown_server_event", (msg, sid) => {
        if (sid) return
        const targetId = sid || stateManager.getState().activeSessionId
        if (!targetId) return
        const eventType = typeof msg.eventType === "string" ? msg.eventType : "unknown"
        const preview = typeof msg.preview === "string" ? msg.preview : undefined
        addMessage(targetId, {
          role: "system",
          id: createWebviewId("activity"),
          blocks: [{
            type: "activity",
            title: "Unsupported OpenCode event",
            detail: preview,
            eventType,
          }],
          timestamp: Date.now(),
          sessionId: targetId,
        })
      }],
      ["stream_start", (_msg, sid) => {
        if (!sid) return
        const resumed = _msg.resumed as { existingText?: string; messageId?: string } | undefined
        handleStreamStart(sid, _msg.messageId as string, { skipAnchor: Boolean(resumed) })
        if (resumed?.existingText) {
          const stream = streamHandlers.get(sid)
          stream?.forceRerender(resumed.existingText)
        }
      }],
      ["stream_chunk", (_msg, sid) => { if (sid) handleStreamChunk(sid, _msg.text as string, _msg.messageId as string | undefined) }],
      ["stream_end", (_msg, sid) => {
        if (sid) handleStreamEnd(sid, _msg.messageId as string, _msg.blocks, _msg.reason as string | undefined, Boolean(_msg.partial))
        // Reconciliation: any completed stream may have invoked `todowrite`
        // and produced `todo.updated` events the SSE stream dropped or
        // delayed. Re-fetch the canonical todo list for the active session
        // to close any gaps.
        const activeSid = stateManager.getState().activeSessionId
        if (activeSid) {
          vscode.postMessage({ type: "get_todos", sessionId: activeSid })
        }
      }],
      ["stream_interrupted", (_msg, sid) => {
        if (!sid) return
        const interruptedAt = typeof _msg.interruptedAt === "number" ? _msg.interruptedAt : Date.now()
        const elapsed = Math.round((Date.now() - interruptedAt) / 1000)
        const timeAgo = elapsed < 60 ? `${elapsed}s ago` : `${Math.round(elapsed / 60)}m ago`
        const msg: ChatMessage = {
          role: "system",
          id: createWebviewId("sys"),
          blocks: [{ type: "text", text: `Stream interrupted ${timeAgo}. The server connection was lost while this tab was actively streaming.` }],
          timestamp: Date.now(),
          sessionId: sid,
        }
        addMessage(sid, msg)
        const msgList = getMessageList(sid)
        if (msgList) {
          const lastMsg = msgList.querySelector(`[data-message-id="${msg.id}"]`)
          if (lastMsg) {
            const bubble = lastMsg.querySelector(".message-bubble, .system-bubble")
            if (bubble) {
              const btnRow = document.createElement("div")
              btnRow.className = "interrupted-btn-row"
              const resumeBtn = document.createElement("button")
              resumeBtn.className = "retry-btn"
              resumeBtn.textContent = "Resume Stream"
              resumeBtn.addEventListener("click", () => {
                btnRow.remove()
                vscode.postMessage({ type: "resume_stream", sessionId: sid })
              })
              const dismissBtn = document.createElement("button")
              dismissBtn.className = "retry-btn dismissed"
              dismissBtn.textContent = "Dismiss"
              dismissBtn.addEventListener("click", () => {
                btnRow.remove()
                vscode.postMessage({ type: "decline_resume", sessionId: sid })
              })
              btnRow.appendChild(resumeBtn)
              btnRow.appendChild(dismissBtn)
              bubble.appendChild(btnRow)
            }
          }
        }
      }],
["stream_ping", (_msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          const seq = Number(_msg.seq || 0)
          const ackSeq = stream?.chunkSeq ?? 0
          vscode.postMessage({ type: "stream_ack", sessionId: sid, seq, lastRenderedChunkSeq: ackSeq })
        }
      }],
      ["force_rerender", (_msg, sid) => {
        if (sid && typeof _msg.text === "string") {
          const stream = streamHandlers.get(sid)
          if (stream) {
            stream.forceRerender(_msg.text as string)
          }
        }
      }],
      ["mention_results", (msg) => { mention.renderResults(msg.items as MentionItem[] | undefined) }],
      ["mode_change_result", (msg, sid) => {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : sid
        const mode = normalizeSessionMode(msg.mode)
        if (!sessionId || !mode) return
        stateManager.setSessionMode(sessionId, mode)
        if (stateManager.getState().activeSessionId === sessionId) {
          updateModeDropdownLocal(mode)
          updateModeSelectorStateLocal()
        }
      }],
      ["cycle_mode", (_msg, _sid) => {
        cycleModeForward({
          els,
          getActiveSession: () => stateManager.getActiveSession(),
          setSessionMode: (_id, _mode) => {},
          postMessage: (m) => vscode.postMessage(m),
        })
      }],
      ["set_mode", (msg, sid) => {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : sid
        const mode = normalizeSessionMode(msg.mode)
        if (!mode || !sessionId) return
        vscode.postMessage({ type: "change_mode", mode, sessionId })
      }],
      ["session_list", (msg) => {
        const sessions = (msg.sessions || []) as SessionSummary[]
        const isWelcomeVisible = !els.welcomeView.classList.contains("hidden")
        const query = typeof msg.query === "string" ? msg.query : ""
        if (isWelcomeVisible && !els.sessionModal.classList.contains("hidden")) {
          openSessionModal(sessions, query)
        } else if (isWelcomeVisible) {
          const currentSearchQuery = (els.welcomeSearchInput?.querySelector<HTMLInputElement>("input")?.value || "").trim()
          if (query && currentSearchQuery !== query.trim()) return
          renderRecentSessionsList(query, sessions)
        } else {
          openSessionModal(sessions, query)
        }
      }],
      ["session_list_update", (msg) => {
        const sessions = (msg.sessions || []) as SessionSummary[]
        setUnifiedLocalSessions(sessions)
        if (!els.sessionModal.classList.contains("hidden")) {
          vscode.postMessage({ type: "list_server_sessions", query: getUnifiedSessionQuery() })
        }
      }],
      ["server_session_list", (msg) => {
        const serverSessions = msg.sessions as Array<{
          id: string; title?: string; directory?: string; parentId?: string;
          created?: number; updated?: number; files?: number; additions?: number; deletions?: number;
          isCurrentWorkspace?: boolean
        }> | undefined
        setUnifiedServerSessions(serverSessions ?? [])
        if (!els.sessionModal.classList.contains("hidden")) {
          renderUnifiedSessionList()
        }
      }],
      ["server_session_deleted", (msg) => {
        if (typeof msg.serverSessionId === "string") {
          const deletedItem = els.sessionModalBody.querySelector(`[data-server-id="${msg.serverSessionId}"]`)
          if (deletedItem) {
            deletedItem.remove()
            if (els.sessionModalBody.querySelectorAll(".modal-session-item").length === 0) {
              const listContainer = els.sessionModalBody.querySelector(".modal-session-list")
              if (listContainer) {
                listContainer.replaceChildren()
                const empty = document.createElement("div")
                empty.className = "modal-empty"
                empty.textContent = "No server sessions."
                listContainer.appendChild(empty)
              }
            }
          }
        }
      }],
      ["resume_session_data", (msg) => {
        const session = msg.session as import("./types").SessionState | undefined
        if (session) {
          stateManager.ensureSession(session)
          createTabUI(session.id, session.name)
          const msgList = getMessageList(session.id)
          if (msgList) {
            attachScrollPersistence(session.id, msgList)
            const rebuildTranscript = shouldRenderHydratedMessages(session.id, msgList, session.messages)
            if (rebuildTranscript) {
              msgList.replaceChildren()

              const beforeIndex = typeof msg.initialBeforeIndex === "number" ? msg.initialBeforeIndex : 0
              sessionBeforeIndex.set(session.id, beforeIndex)
              const turnCount = typeof msg.initialHiddenTurns === "number" ? msg.initialHiddenTurns : beforeIndex
              sessionHiddenTurns.set(session.id, turnCount)

              if (beforeIndex > 0) {
                const banner = createLoadEarlierBanner(turnCount, beforeIndex, () => {
                  const idx = sessionBeforeIndex.get(session.id) ?? 0
                  if (idx <= 0) return
                  vscode.postMessage({ type: "request_more_messages", sessionId: session.id, beforeIndex: idx, limit: 50 })
                })
                banner.dataset.sessionId = session.id
                msgList.appendChild(banner)
              }

              const renderOpts = { mode: session.mode, sessionId: session.id, sessionModel: session.model, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }
              let scrollRestored = false
              const loader = createChunkedLoader({
                container: msgList,
                messages: session.messages,
                renderFn: (m) => {
                  const index = session.messages.indexOf(m)
                  const isConsecutive = index > 0 && session.messages[index - 1]?.role === m.role
                  return renderMessage(m, { ...renderOpts, turnIndex: index }, isConsecutive)
                },
                onChunkDone: (rendered, total) => {
                  if (!scrollRestored && rendered === Math.min(total, 20)) {
                    scrollRestored = true
                    restoreScrollPosition(session.id, msgList, stateManager.getScrollPosition(session.id) === 0)
                  }
                },
                onAllDone: () => {
                  applyHistoryCondensation(session.id)
                  setupJumpToBottom(session.id)
                  // C: only restore if onChunkDone didn't already (small sessions)
                  if (!scrollRestored) {
                    scrollRestored = true
                    restoreScrollPosition(session.id, msgList, stateManager.getScrollPosition(session.id) === 0)
                  }
                  debouncedUpdateScrollMarkers(session.id)
                  refreshConversationTimeline(session.id)
                },
              })
              loader.start()
            } else {
              restoreScrollPosition(session.id, msgList)
              debouncedUpdateScrollMarkers(session.id)
            }

            if (!scrollAnchors.get(session.id)) {
              const typingInd = msgList.parentElement?.querySelector(".typing-indicator") as HTMLElement | undefined
              const anchor = createScrollAnchor(msgList, typingInd)
              scrollAnchors.set(session.id, anchor)
            }

            // Virtual list lifecycle on resume:
            //  - transcript DOM untouched → keep the existing list (its
            //    observer, entries, and placeholders are all still valid).
            //    Recreating it here used to trigger restoreAll(), which
            //    synchronously re-rendered EVERY pruned message on each
            //    resume of an already-open session — a long main-thread
            //    stall exactly at session-switch time.
            //  - transcript rebuilt (replaceChildren above) → the old list's
            //    elements are gone; dispose WITHOUT the restore render and
            //    start a fresh list over the new DOM.
            if (rebuildTranscript || !getVirtualList(session.id)) {
              disposeVirtualList(session.id, { restoreDom: false })
              const vl = createVirtualList(
                session.id,
                msgList,
                // Read through stateManager: ensureSession() mutates the
                // canonical messages array in place, so this stays correct
                // across later resumes that reuse this list instance.
                (id: string) => stateManager.getSession(session.id)?.messages.find((m: ChatMessage) => m.id === id),
                () => stateManager.getSession(session.id),
                (m: ChatMessage, opts: Parameters<typeof renderMessage>[1]) => renderMessage(m, opts),
              )
              vl.start()
            }
          }
          switchTab(session.id)
          hideWelcomeView()
          updateTabBar()
          renderRecentSessionsList()
        }
      }],
      ["more_messages", (msg) => {
        const sid = msg.sessionId as string | undefined
        const moreMsgs = msg.messages as import("./types").ChatMessage[] | undefined
        const msgList = sid ? getMessageList(sid) : null
        if (!sid || !msgList) return

        // Always clean up any banner still in "Loading…" state — otherwise a
        // host reply with messages: [] (e.g. local exhausted, server has
        // nothing new) would leave the button stuck disabled forever.
        const oldBanner = msgList.querySelector<HTMLElement>(".load-earlier-banner")
        if (oldBanner) oldBanner.remove()

        // Always update pagination state so subsequent "Load earlier"
        // clicks use the freshest server-reported beforeIndex (e.g. 0 to
        // signal "no more hidden messages").
        const newBeforeIndex = typeof msg.newBeforeIndex === "number" ? msg.newBeforeIndex : 0
        sessionBeforeIndex.set(sid, newBeforeIndex)
        const newHiddenTurns = typeof msg.displayHiddenTurns === "number" ? msg.displayHiddenTurns : newBeforeIndex
        sessionHiddenTurns.set(sid, newHiddenTurns)

        // Empty-messages reply means nothing to prepend. Skip the render path
        // but still create a banner with the remaining count if any (the
        // server may have backfilled older messages since the local cache).
        if (!moreMsgs || moreMsgs.length === 0) {
          if (newBeforeIndex > 0) {
            const noMoreBanner = createLoadEarlierBanner(newHiddenTurns, newBeforeIndex, () => {
              const idx = sessionBeforeIndex.get(sid) ?? 0
              if (idx <= 0) return
              vscode.postMessage({ type: "request_more_messages", sessionId: sid, beforeIndex: idx, limit: 50 })
            })
            noMoreBanner.dataset.sessionId = sid
            msgList.insertBefore(noMoreBanner, msgList.firstElementChild)
          }
          debouncedUpdateScrollMarkers(sid)
          return
        }

        const session = stateManager.getSession(sid)
        const renderOpts = { mode: session?.mode ?? "build", sessionId: sid, sessionModel: session?.model, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }

        // Insert the page into session state BEFORE rendering: the timeline,
        // turn indexes and scroll markers are all derived from
        // session.messages, and turnIndex below reads indexOf.
        if (session) {
          const known = new Set(session.messages.map((m) => m.id))
          const fresh = moreMsgs.filter((m) => !m.id || !known.has(m.id))
          if (fresh.length > 0) session.messages.unshift(...fresh)
        }

        const elements = moreMsgs.map((m, index) => {
          const isConsecutive = index > 0 && moreMsgs[index - 1]?.role === m.role
          return renderMessage(m, { ...renderOpts, turnIndex: session?.messages.indexOf(m) }, isConsecutive)
        })

        prependMessagesPreservingScroll(msgList, elements)

        if (newBeforeIndex > 0) {
          const banner = createLoadEarlierBanner(newHiddenTurns, newBeforeIndex, () => {
            const idx = sessionBeforeIndex.get(sid) ?? 0
            if (idx <= 0) return
            vscode.postMessage({ type: "request_more_messages", sessionId: sid, beforeIndex: idx, limit: 50 })
          })
          banner.dataset.sessionId = sid
          const firstChild = msgList.firstElementChild
          if (firstChild) msgList.insertBefore(banner, firstChild)
          else msgList.appendChild(banner)
        }

        debouncedUpdateScrollMarkers(sid)
        // Keep the timeline in lock-step with the newly loaded page (no
        // 200ms debounce here — the user is waiting on this update).
        refreshConversationTimeline(sid)

        // Fulfill (or chain) a pending timeline jump to an unloaded turn.
        const pending = pendingTimelineScroll.get(sid)
        if (pending) {
          if (msgList.querySelector(`[data-message-id="${CSS.escape(pending.messageId)}"]`)) {
            pendingTimelineScroll.delete(sid)
            scrollToTurnModule(scrollMarkerDeps, pending.messageId)
          } else if (pending.attemptsLeft > 1 && newBeforeIndex > 0) {
            pendingTimelineScroll.set(sid, { messageId: pending.messageId, attemptsLeft: pending.attemptsLeft - 1 })
            vscode.postMessage({ type: "request_more_messages", sessionId: sid, beforeIndex: newBeforeIndex, limit: 50 })
          } else {
            pendingTimelineScroll.delete(sid)
          }
        }
      }],
      ["clear_messages", (_msg, sid) => { handleClearMessages(sid) }],
      ["session_messages_refreshed", (msg) => {
        const sid = msg.sessionId as string | undefined
        if (!sid) return
        const refreshedMsgs = msg.messages as import("./types").ChatMessage[] | undefined
        if (!refreshedMsgs) return
        const session = stateManager.getSession(sid)
        if (session) session.messages = refreshedMsgs
        const msgList = getMessageList(sid)
        if (!msgList) return
        msgList.innerHTML = ""
        const renderOpts = { mode: session?.mode ?? "build", sessionId: sid, sessionModel: session?.model, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }
        for (const m of refreshedMsgs) {
          const el = renderMessage(m, { ...renderOpts, turnIndex: refreshedMsgs.indexOf(m) }, false)
          msgList.appendChild(el)
        }
        sessionBeforeIndex.set(sid, refreshedMsgs.length)
        debouncedUpdateScrollMarkers(sid)
        refreshActivityAndTasks(sid)
      }],
      ["context_usage", (msg, sid) => {
        const pct = typeof msg.percent === "number" && Number.isFinite(msg.percent) ? msg.percent : 0
        const tokens = typeof msg.tokens === "number" && Number.isFinite(msg.tokens) ? Math.max(0, msg.tokens) : 0
        const maxTokens = typeof msg.maxTokens === "number" && Number.isFinite(msg.maxTokens) ? Math.max(0, msg.maxTokens) : 0
        const activeId = stateManager.getState().activeSessionId
        // Prefer explicit sessionId, then the envelope sid, then active — so a
        // background session's usage never overwrites the viewed session's bar.
        const targetId = resolveEventSessionTarget(msg.sessionId, sid, activeId, (s) => isValidSessionId(s as string))
        if (!targetId) return
        const incomingUsage: ContextUsage = {
          percent: pct,
          tokens,
          maxTokens,
          breakdown: msg.breakdown as ContextUsage["breakdown"],
          cost: typeof msg.cost === "number" && Number.isFinite(msg.cost) ? msg.cost : undefined,
          projected: msg.projected as ContextUsage["projected"],
          source: msg.source === "actual" ? "actual" : "estimated",
          updatedAt: typeof msg.updatedAt === "number" && Number.isFinite(msg.updatedAt) ? msg.updatedAt : Date.now(),
        }
        const sess = stateManager.getSession(targetId)
        const existingUsage = sess?.contextUsage
        const keepExisting = !contextUsageHasFill(incomingUsage) && contextUsageHasFill(existingUsage)
        const effectiveUsage = keepExisting ? existingUsage! : incomingUsage
        // Persist per-session so it survives tab switches, but never let an
        // empty fallback update erase a valid prior context reading.
        if (sess) {
          if (keepExisting) {
            webviewLog(`[main] ignored empty context_usage for session=${targetId}`)
          } else {
            sess.contextUsage = incomingUsage
            stateManager.save()
          }
        }
        if (targetId !== activeId) {
          return
        }
        // Throttle bar and dropdown updates to animation frame rate
        // to avoid excessive re-renders during streaming.
        if (_contextUsageRafId) cancelAnimationFrame(_contextUsageRafId)
        _contextUsageRafId = requestAnimationFrame(() => {
          _contextUsageRafId = 0
          if (targetId !== stateManager.getState().activeSessionId) return
          ctxDropdownApi?.updateUsage({ type: "context_usage", ...effectiveUsage, sessionId: targetId } as Record<string, unknown>)
          updateContextUsageBar(effectiveUsage.percent, effectiveUsage.tokens, effectiveUsage.maxTokens)
        })
      }],
      ["context_window_unknown", (msg) => {
        const activeId = stateManager.getState().activeSessionId
        const targetId = isValidSessionId(msg.sessionId as string) ? msg.sessionId as string : activeId
        if (!targetId || targetId !== activeId) return
        ctxDropdownApi?.updateUsage({ ...msg, sessionId: targetId } as Record<string, unknown>)
        if (isWelcomeVisible()) {
          document.getElementById("ctx-window-unknown-chip")?.classList.add("hidden")
          return
        }
        // Hide the context bar; if suppressStatusChip is true, skip the
        // orange "Set override" chip since models.dev likely resolved
        // the window. The "Set limit" action remains available in the
        // context-usage dropdown.
        const suppress = msg.suppressStatusChip === true
        els.contextUsage.classList.add("hidden")
        showStatusStrip()
        if (!suppress) {
          const chip = document.getElementById("ctx-window-unknown-chip") as HTMLButtonElement | null
          if (chip) {
            const modelId = typeof msg.modelId === "string" ? msg.modelId : ""
            chip.title = `Context window unknown for ${modelId || "this model"}. Click to set an override.`
            chip.classList.remove("hidden")
            // Wire the click once (guard against double-attaching on repeated messages)
            if (!chip.dataset.wired) {
              chip.dataset.wired = "1"
              chip.addEventListener("click", () => {
                vscode.postMessage({ type: "open_context_window_override_dialog" })
              })
            }
          }
        } else {
          document.getElementById("ctx-window-unknown-chip")?.classList.add("hidden")
        }
      }],
      ["context_window_known", (msg) => {
        // Context window resolved — hide the override chip.
        // Re-derive percent using the persisted context FILL (msg.tokens from ContextMonitor),
        // not tokenUsage.total which is cumulative spend and can be orders of magnitude larger.
        const activeId = stateManager.getState().activeSessionId
        const targetId = isValidSessionId(msg.sessionId as string) ? msg.sessionId as string : activeId
        const isActiveTarget = targetId === activeId
        if (isActiveTarget) {
          const chip = document.getElementById("ctx-window-unknown-chip")
          if (chip) chip.classList.add("hidden")
        }
        if (targetId && typeof msg.maxTokens === "number" && (msg.maxTokens as number) > 0) {
          const session = stateManager.getSession(targetId)
          const fill = session?.contextUsage  // set by context_usage handler, represents current fill
          if (fill) {
            const pct = Math.min(100, Math.max(0, (fill.tokens / (msg.maxTokens as number)) * 100))
            const updatedUsage = { type: "context_usage", sessionId: targetId, percent: pct, tokens: fill.tokens, maxTokens: msg.maxTokens as number, breakdown: fill.breakdown, projected: fill.projected, cost: fill.cost, source: fill.source, updatedAt: fill.updatedAt }
            session.contextUsage = { ...fill, percent: pct, maxTokens: msg.maxTokens as number }
            stateManager.save()
            if (isActiveTarget) {
              ctxDropdownApi?.updateUsage(updatedUsage as Record<string, unknown>)
              updateContextUsageBar(pct, fill.tokens, msg.maxTokens as number)
            }
          }
          // If no fill data yet, the next context_usage message will update the display correctly.
        }
      }],
      ["context_history_response", () => {
        // context usage history/statistics panel was removed — no-op
      }],
      ["server_status", (msg, sid) => { if (sid) handleServerStatus(sid, msg.status as string, msg.errorContext) }],
      ["run_activity_update", (msg, sid) => {
        if (!sid) return
        const activity = msg.activity as RunActivitySnapshot | undefined
        if (!activity) return

        streamHandlers.get(sid)?.handleRunActivityUpdate(activity)

        const incomingSubagents = runSubagentsToActivities(activity)

        // Reconcile: merge incoming with existing, transition dropped subagents
        const prevActivities = stateManager.getSession(sid)?.subagentActivities ?? []
        const reconciled = reconcileSubagentStatuses(prevActivities, incomingSubagents)
        const capped = capCompletedSubagents(reconciled)

        if (capped.length > 0) {
          stateManager.setSubagentActivities(sid, capped)
          if (sid === stateManager.getState().activeSessionId) {
            subagentPanelApi?.renderActivities(capped)
            updateSubagentBadge(capped.filter(isLiveSubagent).length)
          }
        } else if (sid === stateManager.getState().activeSessionId) {
          const session = stateManager.getSession(sid)
          if (session && session.subagentActivities?.length) {
            stateManager.setSubagentActivities(sid, [])
            subagentPanelApi?.renderActivities([])
          }
          updateSubagentBadge(0)
        }

        // Inline subagent cards in transcript
        if (incomingSubagents.length > 0 && sid === stateManager.getState().activeSessionId) {
          const msgList = getActiveMessageList(els)
          if (msgList) {
            for (const sub of activity.subagents ?? []) {
              const toolId = sub.id.startsWith("subagent:") ? sub.id.slice("subagent:".length) : sub.id
              const cardEl = msgList.querySelector<HTMLElement>(`[data-block-id="${toolId}"].subagent-card`)
              if (!cardEl) continue
              applySubagentCardUpdate(cardEl, {
                state: mapSubagentRunStatusToCardState(sub.status),
                result: sub.error,
                error: sub.error,
              })
            }
          }
        }

        // Auto-open policy: only on NEW subagent ids, not on activity churn
        const prevKnownIds = knownSubagentIdsBySession.get(sid) ?? new Set()
        const newIds = computeNewSubagentIds(prevKnownIds, incomingSubagents)
        const allIds = new Set(incomingSubagents.map(a => a.id))
        knownSubagentIdsBySession.set(sid, allIds)

        // When the last subagent completes, turn off the dismissal flag
        if (activity.activeSubagentCount === 0) {
          subagentDismissedBySession.delete(sid)
        }

        // Badge-only notification: don't auto-open the panel. The badge
        // (updateSubagentBadge) already shows "N running"; the user can
        // toggle the panel manually.
      }],
      ["instructions_changed", (msg, sid) => {
        if (sid) {
          const sess = stateManager.getSession(sid)
          if (sess) {
            sess.instructions = typeof msg.instructions === "string" ? msg.instructions : undefined
            stateManager.save()
          }
        }
      }],
      ["fork_created", (msg) => {
        const forkId = typeof msg.sessionId === "string" ? msg.sessionId : undefined
        const name = typeof msg.name === "string" ? msg.name : "Fork"
        const model = stateManager.getState().globalModel
        if (!forkId) return
        if (!stateManager.getSession(forkId)) {
          stateManager.ensureSession({ id: forkId, name, model, mode: "build", messages: [], isStreaming: false })
        }
        createTabUI(forkId, name)
        stateManager.setActiveSession(forkId)
        switchToTab(els, forkId)
        hideWelcomeView()
        updateTabBar()
      }],
      ["streaming_state", (msg, sid) => {
        if (!sid) return
        const isStreaming = Boolean(msg.isStreaming)
        // The host is the single source of truth for streaming state. Write the
        // authoritative `isServerStreaming` flag and (when true) record the
        // active run identity so we can correlate late chunks and reject stale
        // pushes from a previous run. We also keep the optimistic `isStreaming`
        // in sync so legacy readers (queue/capacity) see the same value — but
        // the send button now reads `isServerStreaming ?? isStreaming` so a
        // host `true` can revive a stale local `false`.
        stateManager.setServerStreaming(sid, isStreaming)
        // Only mutate the optimistic flag from host authority; do not let it
        // lag the host (the whole point of the backstop).
        if (stateManager.setStreaming(sid, isStreaming)) {
          // fall through
        }
        const sess = stateManager.getSession(sid)
        if (sess) {
          if (isStreaming) {
            // Stash the run identity fields if the host provided them.
            const serverMessageId = typeof msg.messageId === "string" ? msg.messageId : undefined
            const runId = typeof msg.runId === "string" ? msg.runId : undefined
            if (serverMessageId) sess.activeServerMessageId = serverMessageId
            if (runId) sess.activeRunId = runId
          } else {
            // Clear run identity on stop so a later stale push can't revive it.
            sess.activeServerMessageId = undefined
            sess.activeRunId = undefined
            sess.changedFiles = []
          }
          stateManager.save()
        }

        const isActiveSession = sid === stateManager.getState().activeSessionId
        if (isActiveSession) {
          // Single source of truth for the streaming-only affordance (selector
          // visibility, placeholder, input accent) — also used on tab switch.
          syncSteerAffordance()
        }
        updateTabBar()
        updateSendButton()
      }],
      ["run_status_result", (msg, sid) => {
        // Host's authoritative answer to a probe_run_status query. Reconcile
        // both flags to match the host's view of reality. This is the only
        // path that can *revive* a stale false (host says active=true) and
        // the only path that can definitively clear a stuck true (host says
        // active=false, server reachable).
        if (!sid) return
        const active = Boolean(msg.active)
        stateManager.setServerStreaming(sid, active)
        stateManager.setStreaming(sid, active)
        const sess = stateManager.getSession(sid)
        if (sess) {
          if (active) {
            if (typeof msg.messageId === "string") sess.activeServerMessageId = msg.messageId
            if (typeof msg.runId === "string") sess.activeRunId = msg.runId
          } else {
            sess.activeServerMessageId = undefined
            sess.activeRunId = undefined
            // If the host confirms the run is really gone, also drop any
            // streaming affordances left over from the dropped terminal
            // events. This is the recovery path for Gap #6 (stuck-streaming
            // after run completed during SSE outage).
            const activeList = getActiveMessageList(els)
            if (activeList) finalizeStreamingText(activeList)
            streamHandlers.get(sid)?.finalizePendingTools?.()
          }
          stateManager.save()
        }
        updateTabBar()
        updateSendButton()
      }],
      ["active_session_changed", (_msg, sid) => {
        if (!sid || !stateManager.getSession(sid)) return
        // The host fires this on every server-side setActive (id promotion,
        // cleanup, command-palette open). Only follow it when doing so cannot
        // steal focus from a tab the user is deliberately viewing — in
        // particular, never yank focus onto a session that is mid-stream,
        // and never yank focus away from a stream the user is watching.
        const currentActiveId = stateManager.getState().activeSessionId
        const target = stateManager.getSession(sid)
        const current = currentActiveId ? stateManager.getSession(currentActiveId) : null
        const honor = shouldHonorActiveSessionChange({
          welcomeVisible: !els.welcomeView.classList.contains("hidden"),
          currentActiveId,
          currentActiveValid: Boolean(currentActiveId && stateManager.getSession(currentActiveId)),
          currentIsStreaming: Boolean(current?.isStreaming),
          targetId: sid,
          targetIsStreaming: Boolean(target?.isStreaming),
        })
        if (honor) switchTab(sid, false)
      }],
      ["stream_tool_start", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }
            toolElapsedTracker.registerStart(toolCall.id)
            stream.handleToolStart(toolCall)
            streamOrchestrator.markToolChainProgress(sid)
          }
        }
      }],
      ["stream_tool_update", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; state?: ToolCallState; args?: unknown }
            if (toolCall.id) {
              streamOrchestrator.scheduleToolUpdate(sid, toolCall.id, {
                state: toolCall.state,
                args: toolCall.args,
              })
            }
          }
        }
      }],
      ["stream_tool_partial", (msg, sid) => {
        if (!sid) return
        const toolCall = msg.toolCall as {
          id?: string
          token?: number
          partialStdout?: string
          partialStderr?: string
          stdout?: string
          stderr?: string
          stdoutLength?: number
          stderrLength?: number
          stdoutLineCount?: number
          stderrLineCount?: number
          replace?: boolean
          durationMs?: number
          exitCode?: number
        } | undefined
        if (!toolCall?.id) return
        const live = toolPartialStore.apply(sid, toolCall.id, toolCall)
        if (!live) return
        streamOrchestrator.scheduleToolPartial(sid, toolCall.id, live)
        tasksPanelApi?.refresh(sid)
      }],
      ["stream_tool_end", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const result = msg.result as { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean; state?: ToolCallState; stderr?: string; exitCode?: number }
            toolPartialStore.markTerminal(sid, result.id)
            streamOrchestrator.flushToolUpdate(sid, result.id)
            toolElapsedTracker.unregisterEnd(result.id, result.durationMs)
            stream.handleToolEnd(result.id, result)
            streamOrchestrator.clearToolChainProgress(sid)
            tasksPanelApi?.refresh(sid)
          }
        }
      }],
      // B6 follow-up: the host posts this when a tool call never emitted a
      // completion event before the server went idle. Without this handler
      // the tool-call card stays stuck mid-stream-looking (spinner/"Running")
      // even after the Stop/Send button has already reverted to Send.
      ["stream_tool_unresolved", (msg, sid) => {
        if (!sid) return
        const toolCallId = msg.toolCallId as string | undefined
        if (!toolCallId) return
        const stream = streamHandlers.get(sid)
        if (!stream) return
        const errorMessage = msg.message as string | undefined
        const session = stateManager.getSession(sid)
        const block = session?.messages.flatMap((m) => m.blocks).find(
          (b) => b.type === "tool-call" && (b as { id?: string }).id === toolCallId,
        ) as ToolCallBlock | undefined
        if (block) {
          block.state = "unresolved"
          block.error = errorMessage
        }
        toolPartialStore.markTerminal(sid, toolCallId)
        streamOrchestrator.flushToolUpdate(sid, toolCallId)
        stream.handleToolUpdate(toolCallId, { state: "unresolved", error: errorMessage })
        streamOrchestrator.clearToolChainProgress(sid)
        tasksPanelApi?.refresh(sid)
      }],
      ["prompt_queued", (_msg, _sid) => {
        // Host queued a prompt — chips render via queue_state, no system message needed.
        vscode.postMessage({
          type: "webview_log",
          level: "info",
          message: `Prompt queued at host for session ${_sid}`,
        })
      }],
      ["queue_state", (msg, sid) => {
        if (!sid || !Array.isArray(msg.items)) return
        let q = promptQueues.get(sid)
        if (!q) {
          q = createPromptQueue()
          promptQueues.set(sid, q)
        }
        q.syncFromHost(msg.items as import("./queue").QueueItem[])
        const queuedCount = msg.items.filter((i: any) => i.state === "queued").length
        if (queuedCount > 0) {
          renderQueue(sid)
        } else {
          const container = document.querySelector<HTMLElement>(".prompt-queue")
          if (container) container.remove()
        }
      }],
      ["permission_request", (_msg, sid) => {
        if (!sid) return

        const permissionId = String(_msg.permissionId || "")
        const permissionType = typeof _msg.permissionType === "string" ? _msg.permissionType : undefined
        const pattern = typeof _msg.pattern === "string" || Array.isArray(_msg.pattern) ? _msg.pattern as string | string[] : undefined
        const title = typeof _msg.title === "string" ? _msg.title : "Allow OpenCode to perform this action?"

        // Record per-session first so the request survives tab switches even
        // though it belongs to a tab the user isn't currently looking at.
        pendingPermissionBySession.set(sid, { permissionId, permissionType, pattern, title })
        if (sid !== stateManager.getState().activeSessionId) return
        renderPermissionBar(sid, { permissionId, permissionType, pattern, title })
      }],
      ["file_edited", (msg, sid) => {
        // Record the edit for the changed-files dropdown. (The inline transcript
        // banner was removed; ChatProvider drops edits it can't tie to a session.)
        const filePath = typeof msg.file === "string" ? msg.file : undefined
        if (sid && filePath) {
          const session = stateManager.getSession(sid)
          if (session) {
            if (!session.changedFiles) session.changedFiles = []
            if (!session.changedFiles.includes(filePath)) {
              session.changedFiles.push(filePath)
              stateManager.save()
            }
          }
        }
      }],
      ["theme_vars", (msg) => { applyThemeVars(msg.vars as Record<string, string> | undefined) }],
      ["theme_config", (msg) => { applyThemeCustomizerConfig(els, msg.theme as ThemeCustomizerConfig | undefined) }],
      ["theme_config_error", (msg) => { 
        const error = msg.error as string | undefined
        console.error(`[opencode-harness] Theme config error: ${error || "Unknown error"}`)
        // Show error to user - could add a toast notification here
        alert(`Failed to save theme: ${error || "Unknown error"}`)
      }],
      ["cli_themes_list", (msg) => { populateCliList(els, msg.themes as Array<{ name: string; source: string }>, (m) => vscode.postMessage(m)) }],
      ["rate_limit_state", (msg) => {
        const quotaState = msg.state as RateLimitWebviewState | null | undefined
        hasQuotaState = Boolean(quotaState)
        handleRateLimitState(quotaState)
        const state = msg.state as RateLimitWebviewState | undefined
        if (state && typeof state.remainingTokens === "number" && typeof state.limitTokens === "number") {
          getQuotaMonitor().updateQuotaState({
            remainingTokens: state.remainingTokens,
            limitTokens: state.limitTokens,
            remainingRequests: state.remainingRequests ?? 0,
            limitRequests: state.limitRequests ?? 0,
            resetAt: state.resetAt ?? new Date().toISOString(),
          })
        }
      }],
      ["voice_settings", (msg) => {
        const settings = (msg as Record<string, unknown>).settings as VoiceInputSettings | undefined
        if (settings) voiceInputApi?.applySettings(settings)
      }],
      ["tool_output_config", (msg) => {
        setToolOutputRenderAnsi((msg as Record<string, unknown>).renderAnsi === true)
      }],
      ["voice_recording_started", (msg) => {
        voiceInputApi?.handleRecordingStarted({
          requestId: (msg as Record<string, unknown>).requestId,
        })
      }],
      ["voice_transcribing", (msg) => {
        voiceInputApi?.handleTranscribing({
          requestId: (msg as Record<string, unknown>).requestId,
        })
      }],
      ["voice_transcript", (msg) => {
        voiceInputApi?.handleTranscript({
          requestId: (msg as Record<string, unknown>).requestId,
          text: (msg as Record<string, unknown>).text,
        })
      }],
      ["voice_error", (msg) => {
        voiceInputApi?.handleError({
          requestId: (msg as Record<string, unknown>).requestId,
          message: (msg as Record<string, unknown>).message,
        })
      }],
      ["model_update", (msg) => {
        // The host pushes the GLOBAL default model here (e.g. after a model
        // change in another webview, on init, or after resume_session during
        // compaction). Per-session model is owned by:
        //   - the explicit user pick in the model dropdown (-> set_model), or
        //   - the server's resume_session_data / session restore.
        // Updating the active session's model here would silently switch the
        // session off the user's chosen model whenever compaction or any
        // other state-push fires — the bug we are fixing.
        if (!msg.model) return
        stateManager.setGlobalModel(msg.model as string)
        // Re-render the list (enabled/favorite state may have changed) and
        // explicitly sync the dropdown selection. The selection prefers the
        // active session's model so a global push doesn't clobber a
        // per-session pick; the status strip below intentionally shows the
        // GLOBAL model (it describes the workspace default).
        syncModelViews()
        const activeSession = stateManager.getActiveSession()
        modelDropdown.setCurrentModel(activeSession?.model || (msg.model as string))
        const modelParts = (msg.model as string).split("/")
        els.statusModel.textContent = modelParts[modelParts.length - 1] ?? (msg.model as string)
        renderWelcomeContext()
      }],
      ["variant_update", (msg) => {
        // Same contract as model_update: only the GLOBAL default is pushed.
        // Per-session variant is owned by the user pick (-> set_variant) and
        // by session restore; host pushes must not clobber it.
        variantSelector.setVariant(msg.variant as string)
        if (msg.variant) {
          stateManager.setGlobalVariant(msg.variant as string)
        }
      }],
      ["model_list", (msg) => {
        if (msg.items) {
          const modelsWithState = stateManager.applyModelState(msg.items as ModelInfo[])
          // Prefer the active session's model over the global model so a
          // restored session keeps its own model when this async response
          // arrives after init_state has already switched tabs. Without
          // this preference, model_list overwrites the dropdown back to
          // the global model and makes the picker disagree with the
          // session that was just restored.
          const activeSession = stateManager.getActiveSession()
          const sessionModel = activeSession?.model
          const fallbackModel = msg.model as string || stateManager.getState().globalModel
          const currentModel = sessionModel || fallbackModel
          modelDropdown.render(modelsWithState, currentModel)
          modelManager.setModels(modelsWithState)
          if (currentModel) {
            modelDropdown.setCurrentModel(currentModel)
            const model = modelsWithState.find((m) => `${m.provider}/${m.id}` === currentModel)
            variantSelector.setModel(model || null)
          }
          // The model list often resolves after init_state, so refresh the
          // welcome card here too — otherwise it can stay on "No model
          // selected" even once a model is known.
          renderWelcomeContext()
        }
      }],
      ["init_state", (msg) => {
        if (window.__opencodeInitTimeout) {
          timers.clearTimeout(window.__opencodeInitTimeout)
          window.__opencodeInitTimeout = undefined
        }
        // The host re-sends init_state on every visibility change. Capture the
        // pre-merge focus context BEFORE setInitialized()/loadSessions() mutate
        // it, so a refresh can preserve the tab the user is currently on
        // instead of snapping back to the host's active session.
        const isFirstInit = !stateManager.getState().initialized
        const priorActiveId = stateManager.getState().activeSessionId
        const welcomeVisibleBefore = !els.welcomeView.classList.contains("hidden")
        if (!stateManager.getState().initialized) {
          stateManager.setInitialized()
        }

        vscode.postMessage({ type: "get_models" })

        if (msg.workspaceName) {
          els.welcomeWorkspaceName.textContent = msg.workspaceName as string
        }

        if (typeof msg.branch === "string" && msg.branch) {
          updateBranchChip(msg.branch)
        }

        const initPayload = msg as Record<string, unknown>
        const hostSessions = Array.isArray(msg.sessions) ? msg.sessions as SessionState[] : []
        const legacyTabs = Array.isArray(initPayload.tabs) ? initPayload.tabs : []
        const globalModel = typeof msg.globalModel === "string" ? msg.globalModel : stateManager.getState().globalModel
        const sessions = hostSessions.length > 0
          ? hostSessions
          : legacyTabs.flatMap((tab): SessionState[] => {
              if (!tab || typeof tab !== "object") return []
              const t = tab as Record<string, unknown>
              const id = typeof t.id === "string" ? t.id : ""
              if (!id) return []
              return [{
                id,
                name: typeof t.name === "string" ? t.name : "Session",
                model: typeof t.model === "string" ? t.model : globalModel,
                variant: typeof t.variant === "string" ? t.variant : undefined,
                mode: t.mode === "plan" || t.mode === "auto" ? t.mode : "build",
                messages: Array.isArray(t.messages) ? t.messages as ChatMessage[] : [],
                isStreaming: t.isStreaming === true,
                tokenUsage: { prompt: 0, completion: 0, total: 0 },
              }]
            })
        stateManager.loadSessions(sessions, msg.activeSessionId as string | null, msg.globalModel as string)

        if (msg.globalModel) {
          // Prefer the restored active session's own model over the global
          // default — same rationale as model_update: a session restored with
          // a specific model should not flip back to the global one on init.
          const restoredActive = stateManager.getActiveSession()
          modelDropdown.setCurrentModel(restoredActive?.model || (msg.globalModel as string))
        }

        // Update configurable stream cap from extension
        if (typeof msg.maxConcurrentStreams === "number") {
          setMaxConcurrentStreams(msg.maxConcurrentStreams)
        }

        // Create tab UI for every session in our state (post-merge), not just
        // those that came in this init_state. loadSessions preserves locally-
        // known sessions, so we may have more than init_state sent.
        const allSessions = stateManager.getAllSessions()
        if (allSessions.length > 0) {
          allSessions.forEach((s) => {
            const escapedId = CSS.escape(s.id)
            const panelExists = !!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${escapedId}"]`)
            if (!panelExists) {
              createTabUI(s.id, s.name)
            }
            // Render persisted messages into the tab's message list. Without
            // this, restored tabs come up as empty shells until the user picks
            // them from history (which routes through resume_session_data).
            // We re-render whenever init_state arrives so the message list
            // reflects the freshest state from the extension host.
            const msgList = getMessageList(s.id)
            if (msgList && s.messages.length > 0) {
              attachScrollPersistence(s.id, msgList)

              // Re-populate question bar BEFORE rendering messages so the
              // inline fallback check (hasQuestionInBar) sees the item in
              // the bar's state and shows the compact pointer, not the
              // redundant interactive controls (RC-2 ordering fix).
              if (s.id === stateManager.getState().activeSessionId) {
                questionBar.repopulateFromMessages(s.id, s.messages as any)
              }

              if (shouldRenderHydratedMessages(s.id, msgList, s.messages)) {
                msgList.replaceChildren()
                const renderOpts = {
                  mode: s.mode,
                  sessionId: s.id,
                  sessionModel: s.model,
                  postMessage: (m: Record<string, unknown>) => vscode.postMessage(m),
                  hasQuestionInBar: (toolCallId: string) => questionBar.hasQuestionInState(toolCallId),
                }
                let scrollRestored = false
                const loader = createChunkedLoader({
                  container: msgList,
                  messages: s.messages,
                  renderFn: (m) => {
                    const index = s.messages.indexOf(m)
                    const isConsecutive = index > 0 && s.messages[index - 1]?.role === m.role
                    return renderMessage(m, { ...renderOpts, turnIndex: index }, isConsecutive)
                  },
                  onChunkDone: (rendered, total) => {
                    if (!scrollRestored && rendered === Math.min(total, 20)) {
                      scrollRestored = true
                      restoreScrollPosition(s.id, msgList, isFirstInit && stateManager.getScrollPosition(s.id) === 0)
                    }
                  },
                   onAllDone: () => {
                    applyHistoryCondensation(s.id)
                    setupJumpToBottom(s.id)
                    // C: only restore if onChunkDone didn't already (small sessions)
                    if (!scrollRestored) {
                      scrollRestored = true
                      restoreScrollPosition(s.id, msgList, isFirstInit && stateManager.getScrollPosition(s.id) === 0)
                    }
                    debouncedUpdateScrollMarkers(s.id)
                    refreshConversationTimeline(s.id)
                    refreshActivityAndTasks(s.id)
                  },
                })
                loader.start()
              } else {
                restoreScrollPosition(s.id, msgList)
                debouncedUpdateScrollMarkers(s.id)
              }

              if (!scrollAnchors.get(s.id)) {
                const typingInd = msgList.parentElement?.querySelector(".typing-indicator") as HTMLElement | undefined
                const anchor = createScrollAnchor(msgList, typingInd)
                // E: non-active sessions should not auto-scroll — the user
                // isn't looking at them. Pause the anchor so DOM changes
                // (e.g. todos_update re-renders) don't shift their scroll.
                if (s.id !== stateManager.getState().activeSessionId) {
                  anchor.pause()
                }
                scrollAnchors.set(s.id, anchor)
              }

              if (!getVirtualList(s.id)) {
                const vl = createVirtualList(
                  s.id,
                  msgList,
                  // Read through stateManager (not the init payload array):
                  // the canonical messages array is mutated in place by later
                  // appends/streams, and scrollback restore must find them.
                  (id: string) => stateManager.getSession(s.id)?.messages.find((m: ChatMessage) => m.id === id),
                  () => stateManager.getSession(s.id),
                  (m: ChatMessage, opts: Parameters<typeof renderMessage>[1]) => renderMessage(m, opts),
                )
                vl.start()
              }
            }
          })
          syncModeUI()
          updateTabBar()
        }

        // Decide what to display. First hydration honours the host's restored
        // active session; every later refresh preserves the user's current tab
        // (or keeps them on the welcome screen) so a re-push never steals focus
        // onto a session the user deliberately switched away from.
        const targetActive = resolveInitStateTarget({
          isFirstInit,
          welcomeVisibleBefore,
          priorActiveId,
          hostActiveId: (msg.activeSessionId as string | null | undefined) ?? null,
          isKnownSession: (id) => Boolean(id && stateManager.getSession(id)),
          firstSessionId: allSessions.length > 0 ? allSessions[0]!.id : null,
        })

        if (targetActive) {
          switchTab(targetActive, false)
        } else {
          showWelcomeView()
        }

        vscode.postMessage({ type: "init_ack" })
        vscode.postMessage({ type: "list_providers" })
        getQuotaMonitor().startMonitoring()
      }],
      ["panel_visibility_restore", (msg) => {
        const panels = (msg as Record<string, unknown>).panels as Record<string, boolean> | undefined
        if (!panels) return
        if (panels.todos) todosPanelApi?.open()
        if (panels.activity) activityPanelApi?.open()
        if (panels.tasks) tasksPanelApi?.open()
        if (panels.subagent) { setSubagentPanelOpen(true); requestSubagentActivities() }
      }],
      ["rate_limit_exhausted", (msg) => {
        const info = msg.info as { resetAt?: unknown } | undefined
        const resetAt = typeof info?.resetAt === "string" ? info.resetAt : undefined
        handleRateLimitExhausted(els, resetAt)
        const sid = stateManager.getState().activeSessionId ?? undefined
        const resetMsg = resetAt ? ` Resets at ${resetAt}.` : ""
        const isStreaming = sid ? stateManager.getSession(sid)?.isStreaming === true : false
        if (!isStreaming) {
          handleRequestError(sid, `Rate limit exceeded.${resetMsg} Please wait and try again.`)
        }
      }],
      ["prompt_rejected", (msg, sid) => {
        if (sid) {
          stateManager.setStreaming(sid, false)
          updateTabBar()
          updateSendButton()
          const stream = streamHandlers.get(sid)
          if (stream) stream.hideTypingIndicator()
          if (sid === stateManager.getState().activeSessionId) {
            updateSendButtonIcon(false)
          }
          const reason = typeof (msg as Record<string, unknown>).reason === "string"
            ? (msg as Record<string, unknown>).reason as string
            : "Your request could not be processed."
          handleRequestError(sid, reason)
        }
      }],
      ["webview_request_error", (msg, sid) => {
        handleRequestError(sid ?? stateManager.getState().activeSessionId ?? undefined, typeof msg.error === "string" ? msg.error : undefined, (msg as Record<string, unknown>).errorContext)
      }],
      ["show_error", (msg) => {
        const msgText = typeof (msg as Record<string, unknown>).message === "string"
          ? (msg as Record<string, unknown>).message as string
          : "An error occurred."
        handleRequestError(stateManager.getState().activeSessionId ?? undefined, msgText)
      }],
      ["provider_error", (msg) => {
        const raw = msg as Record<string, unknown>
        const errText = typeof raw.error === "string" ? raw.error as string : "Provider configuration error."
        const pId = typeof raw.providerId === "string" ? raw.providerId as string : undefined
        if (pId) onProviderKeyResult(pId, false, errText)
        handleRequestError(stateManager.getState().activeSessionId ?? undefined, `Provider error: ${errText}`)
      }],
      ["provider_list", (msg) => {
        const providers = (msg as Record<string, unknown>).providers as ProviderConfig[] | undefined
        if (providers) modelManager.setProviders(providers)
      }],
      ["provider_added", (msg) => {
        const id = (msg as Record<string, unknown>).id as string | undefined
        if (id) onProviderKeyResult(id, true)
        vscode.postMessage({ type: "list_providers" })
        vscode.postMessage({ type: "get_models" })
        vscode.postMessage({ type: "discover_providers" })
      }],
      ["provider_deleted", () => {
        vscode.postMessage({ type: "list_providers" })
      }],
      ["provider_discovery_list", (msg) => {
        const providers = (msg as Record<string, unknown>).providers as ProviderDiscoveryItem[] | undefined
        if (providers) {
          providerDiscoveryItems = providers
          renderProviderDiscoveryList(providers, providerAuthMethods, (m) => vscode.postMessage(m))
        }
      }],
      ["provider_auth_methods", (msg) => {
        const providerId = (msg as Record<string, unknown>).providerId as string | undefined
        const methods = (msg as Record<string, unknown>).methods as ProviderAuthMethodInfo[] | undefined
        if (providerId && methods) {
          providerAuthMethods.set(providerId, methods)
          renderProviderDiscoveryList(providerDiscoveryItems, providerAuthMethods, (m) => vscode.postMessage(m))
        }
      }],
      ["provider_oauth_started", (msg) => {
        const providerId = (msg as Record<string, unknown>).providerId as string | undefined
        const url = (msg as Record<string, unknown>).authorizationUrl as string | undefined
        if (providerId && url) handleOAuthStarted(providerId, url, (m) => vscode.postMessage(m))
      }],
      ["provider_oauth_completed", (msg) => {
        const providerId = (msg as Record<string, unknown>).providerId as string | undefined
        const ok = (msg as Record<string, unknown>).ok as boolean
        const error = (msg as Record<string, unknown>).error as string | undefined
        if (providerId) handleOAuthCompleted(providerId, ok, error)
        if (ok) {
          vscode.postMessage({ type: "discover_providers" })
          vscode.postMessage({ type: "list_provider_credentials" })
        }
      }],
      ["provider_credential_list", (msg) => {
        const credentials = (msg as Record<string, unknown>).credentials as ProviderCredentialInfo[] | undefined
        if (credentials) {
          providerCredentials = credentials
          renderProviderCredentialList(credentials, (m) => vscode.postMessage(m))
        }
      }],
      ["request_error", (msg, sid) => { handleRequestError(sid ?? stateManager.getState().activeSessionId ?? undefined, typeof msg.message === "string" ? msg.message : undefined, msg.errorContext) }],
      ["diff_result", (msg) => {
        handleDiffResult(typeof msg.sessionId === "string" ? msg.sessionId : undefined, msg.blockId as string, msg.ok as boolean, typeof msg.message === "string" ? msg.message : undefined, Boolean(msg.checkpointCreated))
      }],
      ["cost_update", (msg) => {
        const cost = msg.cost
        if (isValidSessionId(msg.sessionId as string) && typeof cost === "number" && Number.isFinite(cost)) {
          handleCostUpdate(msg.sessionId as string, cost)
          updateCostDisplay(msg.sessionId as string)
        }
      }],
      ["token_usage", (msg, sid) => {
        if (isValidSessionId(sid)) {
          const rawUsage = msg.usage as Partial<UsageDelta> | undefined
          const rawTokens = msg.tokens as number | { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } | undefined
          let usage: UsageDelta | null = null
          if (
            rawUsage
            && typeof rawUsage === "object"
            && typeof rawUsage.prompt === "number"
            && Number.isFinite(rawUsage.prompt)
            && typeof rawUsage.completion === "number"
            && Number.isFinite(rawUsage.completion)
          ) {
            const prompt = rawUsage.prompt as number
            const completion = rawUsage.completion as number
            usage = {
              prompt,
              completion,
              total: typeof rawUsage.total === "number" && Number.isFinite(rawUsage.total) ? rawUsage.total : prompt + completion + (rawUsage.reasoning ?? 0) + (rawUsage.cacheRead ?? 0) + (rawUsage.cacheWrite ?? 0),
              reasoning: rawUsage.reasoning ?? 0,
              cacheRead: rawUsage.cacheRead ?? 0,
              cacheWrite: rawUsage.cacheWrite ?? 0,
            }
          } else if (typeof rawTokens === "number" && Number.isFinite(rawTokens)) {
            usage = { prompt: rawTokens, completion: 0, total: rawTokens, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
          } else if (rawTokens && typeof rawTokens === "object") {
            const input = rawTokens.input ?? 0
            const output = rawTokens.output ?? 0
            usage = {
              prompt: input,
              completion: output,
              total: input + output + (rawTokens.reasoning ?? 0) + (rawTokens.cacheRead ?? 0) + (rawTokens.cacheWrite ?? 0),
              reasoning: rawTokens.reasoning ?? 0,
              cacheRead: rawTokens.cacheRead ?? 0,
              cacheWrite: rawTokens.cacheWrite ?? 0,
            }
          }
          if (!usage) return
          const cumulative = readCumulativeTotals(msg)
          if (cumulative) {
            // Host ledger snapshot: SET, never add — idempotent on replay.
            applyTokenUsageTotals(sid, cumulative, typeof msg.cumulativeCost === "number" ? msg.cumulativeCost : undefined)
            return
          }
          if (!isDuplicateRecentStepUsage(sid, usage)) {
            handleTokenUsage(sid, usage)
          }
        }
      }],
      ["step_tokens", (msg, sid) => {
        if (isValidSessionId(sid) && msg.tokens) {
          const t = msg.tokens as { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }
          const usage = {
            prompt: t.input,
            completion: t.output,
            total: t.input + t.output + (t.reasoning ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
            reasoning: t.reasoning ?? 0,
            cacheRead: t.cacheRead ?? 0,
            cacheWrite: t.cacheWrite ?? 0,
          }
          const cumulative = readCumulativeTotals(msg)
          if (cumulative) {
            // Host ledger snapshot: SET, never add — idempotent on replay.
            applyTokenUsageTotals(sid, cumulative, typeof msg.cumulativeCost === "number" ? msg.cumulativeCost : undefined)
            rememberStepUsage(sid, usage)
            return
          }
          accumulateTokenUsage(sid, usage)
          rememberStepUsage(sid, usage)
          if (typeof msg.cost === "number" && Number.isFinite(msg.cost) && msg.cost > 0) {
            accumulateCost(sid, msg.cost)
          }
        }
      }],
      ["revert_result", (msg, sid) => {
        if (sid) {
          if (msg.ok) {
            showSystemMessage(sid, "Reverted changes from the selected message.")
          } else {
            showSystemMessage(sid, `Revert failed: ${msg.error || "Unknown error"}`)
          }
        }
      }],
      ["unrevert_result", (msg, sid) => {
        if (sid) {
          if (msg.ok) {
            showSystemMessage(sid, "All reverted messages restored.")
          } else {
            showSystemMessage(sid, `Unrevert failed: ${msg.error || "Unknown error"}`)
          }
        }
      }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose webview message payload (msg.diffId/path are unknown)
      ["revert_success", (msg: any, sid) => {
        const diffId = msg.diffId as string | undefined
        if (diffId) {
          const el = document.querySelector(`.diff-block[data-diff-id="${CSS.escape(diffId)}"]`)
          if (el) {
            const actionBar = el.querySelector(".diff-action-bar")
            if (actionBar) {
              actionBar.innerHTML = ""
              const chip = document.createElement("span")
              chip.className = "diff-state-chip diff-state-chip--reverted"
              chip.textContent = "Reverted"
              actionBar.appendChild(chip)
            }
            el.classList.remove("diff-block--accepted")
            el.classList.add("diff-block--discarded")
          }
        }
        if (sid) showSystemMessage(sid, `Changes reverted${msg.path ? ` for ${msg.path}` : ""}.`)
      }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose webview message payload (msg.error is unknown)
      ["revert_failed", (msg: any, sid) => {
        if (sid) showSystemMessage(sid, `Revert failed: ${msg.error || "Unknown error"}`)
      }],
      ["checkpoint_list", (msg) => {
        if (msg.checkpoints) {
          renderCheckpointPanel(msg.checkpoints as Array<{ id: string; sessionId: string; messageId?: string; createdAt?: number; filesChanged?: string[]; action?: string }>)
        }
      }],
      ["checkpoint_restored", (msg, sid) => {
        if (sid) {
          if (msg.ok) {
            showSystemMessage(sid, "Checkpoint restored successfully.")
          } else {
            showSystemMessage(sid, `Checkpoint restore failed: ${msg.error || "Unknown error"}`)
          }
        }
      }],
      ["session_renamed", (msg) => {
        if (typeof msg.sessionId === "string" && typeof msg.name === "string") {
          stateManager.renameSession(msg.sessionId, msg.name)
          updateTabBar()
        }
      }],
      // Fast, race-free title push. Distinct from session_renamed: this
      // handler is wired to SessionStore.setTitleAppliedCallback on the
      // host, which fires SYNCHRONOUSLY from inside applyServerTitle /
      // setTitle / updateName — independent of the onDidChangeSession
      // subscriber's registration order (D3 fix). Patches the tab label
      // in place via patchTabLabel (no innerHTML wipe, no focus clobber
      // — D4 fix). Server titles always win over local dedupe-suffixed
      // auto-titles.
      ["session_title_updated", (msg) => {
        if (typeof msg.sessionId === "string" && typeof msg.name === "string") {
          stateManager.renameSession(msg.sessionId, msg.name)
          // In-place patch. If the tab isn't mounted yet (race with
          // init_state), fall back to updateTabBar so the structural
          // rebuild happens.
          if (!patchTabLabel(els, msg.sessionId, msg.name)) {
            updateTabBar()
          }
        }
      }],
      ["session_deleted", (msg) => {
        if (typeof msg.sessionId === "string") {
          // Check if session is actively streaming and abort if needed
          const session = stateManager.getSession(msg.sessionId)
          const isStreaming = session?.isStreaming || false

          // Abort streaming if active before cleanup
          if (isStreaming) {
            vscode.postMessage({ type: "abort", sessionId: msg.sessionId })
            stateManager.setStreaming(msg.sessionId, false)
          }

          // Clean up stream handler
          const stream = streamHandlers.get(msg.sessionId)
          if (stream) {
            stream.hideTypingIndicator()
          }
          streamHandlers.delete(msg.sessionId)

          // Clean up tool timing data
          toolElapsedTracker.clearForPrefix(msg.sessionId)

          // Clear prompt queue for this session
          const queue = promptQueues.get(msg.sessionId)
          if (queue) {
            queue.clear()
            promptQueues.delete(msg.sessionId)
          }
          persistQueues()

          // The session's panel is removed below — skip the restoreAll render.
          disposeVirtualList(msg.sessionId, { restoreDom: false })
          const escapedId = CSS.escape(msg.sessionId)
          const wasActive = stateManager.getState().activeSessionId === msg.sessionId
          stateManager.deleteSession(msg.sessionId)
          const deletedPanel = els.tabPanels.querySelector(`.tab-panel[data-tab-id="${escapedId}"]`)
          if (deletedPanel) deletedPanel.remove()
          const tabEl = els.tabBar.querySelector(`.tab[data-tab-id="${escapedId}"]`)
          if (tabEl) tabEl.remove()
          const remaining = stateManager.getAllSessions()
          if (wasActive) {
            const nextId = remaining.length > 0 ? remaining[0]?.id : null
            if (nextId) {
              switchTab(nextId)
            }
          }
          updateTabBar()
          if (remaining.length === 0) {
            showWelcomeView()
          } else {
            hideWelcomeView()
          }
        }
      }],
      ["compact_banner", (msg, sid) => {
        // Surfaced when autoCompact === "ask" and the active session crosses
        // the threshold. Previously there was no handler and the banner was
        // silently dropped, leaving the default "ask" mode unusable.
        const sessionId = sid || (typeof msg.sessionId === "string" ? msg.sessionId : "")
        if (!sessionId) return
        showCompactBanner(
          {
            getContainer: (id) =>
              els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${CSS.escape(id)}"]`),
            postMessage: (m) => vscode.postMessage(m),
          },
          {
            sessionId,
            percent: typeof msg.percent === "number" ? msg.percent : 0,
            tokens: typeof msg.tokens === "number" ? msg.tokens : 0,
            maxTokens: typeof msg.maxTokens === "number" ? msg.maxTokens : 0,
            actions: Array.isArray(msg.actions) ? (msg.actions as string[]) : undefined,
          },
        )
      }],
      ["compact_banner_dismissed", (_msg, sid) => {
        if (sid) hideCompactBanner(sid)
      }],
      ["compaction_started", (_msg, sid) => {
        if (sid) {
          showSystemMessage(sid, "Compacting session...")
          // The banner is no longer relevant once compaction begins.
          hideCompactBanner(sid)
        }
      }],
      ["session_compacted", (_msg, sid) => {
        if (sid) {
          showSystemMessage(sid, "Session compacted successfully.")
          hideCompactBanner(sid)
          // Re-fetch the session so the visual message list reflects the
          // post-compact state. Before this, the chat said "compacted" but
          // continued to show the old (uncompacted) messages — making
          // compaction look like a no-op to the user. resume_session
          // re-attaches the server session, pulls fresh messages, and
          // re-renders the bubble list in place.
          vscode.postMessage({ type: "resume_session", sessionId: sid })
        }
      }],
      ["command_list", (msg) => {
        const commands = (msg.commands || []) as Array<{ name: string; description?: string; template?: string; isCustom?: boolean; source?: string; agent?: string }>
        const promptCommands = commands.filter((c) => c.isCustom)
        const remoteCommands = commands.filter((c) => !c.isCustom)
        // Cache remote commands (with origin/agent) so the slash dispatcher
        // can resolve MCP namespace prefixes like `/jcodemunch triage`.
        cachedRemoteCommands = remoteCommands.map((c) => ({
          name: c.name,
          source: c.source,
          origin: c.agent,
        }))
        const commandSuggestions = [...remoteCommands, ...promptCommands]
        mention.updateServerCommands(commandSuggestions)
        commandsModal.updateServerCommands(remoteCommands)
        commandsModal.updatePromptCommands(promptCommands)
        // When the server list fetch failed (partial), the modal shows a note
        // so users understand why server/MCP commands may be missing.
        if (msg.partial === true && msg.showInChat === true) {
          const active = stateManager.getActiveSession()
          if (active) {
            showSystemMessage(active.id, "Could not fetch the full command list from the server. Only custom commands are shown. Server/MCP commands will appear once the server is reachable.")
          }
        }
        if (msg.showInChat !== true) return
        // /commands now opens a real modal instead of dumping into chat history.
        surfaceCoord?.closeOthers("commands-modal")
        commandsModal.open()
      }],
      ["stash_success", (msg) => {
        const active = stateManager.getActiveSession()
        if (active) {
          const name = typeof msg.name === "string" ? msg.name : ""
          showSystemMessage(active.id, `Stashed prompt${name ? ` as "${name}"` : ""}.`)
        }
      }],
      ["stash_error", (msg) => {
        const active = stateManager.getActiveSession()
        const errText = typeof msg.error === "string" ? msg.error : "Stash operation failed."
        if (active) showSystemMessage(active.id, `Stash error: ${errText}`)
      }],
      ["stash_list", (msg) => {
        const stashes = (msg as unknown as { stashes?: Array<{ id: string; name: string; content: string; isGlobal: boolean }> }).stashes || []
        commandsModal.openStashList(stashes)
      }],
      ["stash_deleted", () => {
        // Refresh the stash list if open
        vscode.postMessage({ type: "list_stashes" })
      }],
      ["template_saved", (msg) => {
        const active = stateManager.getActiveSession()
        const template = msg.template as { name?: string } | undefined
        if (active && template?.name) {
          showSystemMessage(active.id, `Template "${template.name}" saved.`)
        }
        // Refresh template list if modal is open
        vscode.postMessage({ type: "list_templates" })
      }],
      ["template_list", (msg) => {
        const templates = (msg as unknown as { templates?: Array<{ id: string; name: string; content: string; tags: string[] }> }).templates || []
        commandsModal.openTemplateList(templates)
        commandsModal.updateTemplateCommands(templates)
      }],
      ["template_deleted", () => {
        vscode.postMessage({ type: "list_templates" })
      }],
      ["template_error", (msg) => {
        const active = stateManager.getActiveSession()
        const errText = typeof msg.error === "string" ? msg.error : "Template operation failed."
        if (active) showSystemMessage(active.id, `Template error: ${errText}`)
      }],
      ["open_commands_palette", () => {
        surfaceCoord?.closeOthers("commands-modal")
        commandsModal.open()
        // Fetch fresh so host-triggered opens (e.g. a "browse commands" CTA)
        // don't show a stale list — MCP / server commands may have changed
        // since the last fetch. The webview-triggered open paths
        // (/commands, palette button, Ctrl+K) already send this themselves.
        vscode.postMessage({ type: "list_commands" })
      }],
      ["methodology_selected", (msg) => {
        // The host classified the outgoing prompt and injected a strategy
        // addendum. Surface it so the user can see — and override via
        // /methodology — what guidance was attached.
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : ""
        const label = typeof msg.label === "string" ? msg.label : ""
        if (!sid || !label) return
        methodologyBySession.set(sid, {
          label,
          strategy: typeof msg.strategy === "string" ? msg.strategy : "",
          taskType: typeof msg.taskType === "string" ? msg.taskType : "",
          auto: msg.auto === true,
        })
        if (stateManager.getState().activeSessionId === sid) renderMethodologyChip(sid)
      }],
      ["prefill_prompt", (msg) => {
        if (typeof msg.text === "string") {
          els.promptInput.value = msg.text
          autoResizeTextarea()
          updatePromptContextChips()
          updateSendButton()
          els.promptInput.focus()
          if (msg.autoSend) sendMessage()
        }
      }],
      ["edit_message_prefill", (msg, sid) => {
        if (sid && typeof msg.messageId === "string" && typeof msg.text === "string") {
          const active = stateManager.getActiveSession()
          if (active) {
            const msgList = getActiveMessageList(els)
            if (msgList) {
              let found = false
              for (const child of Array.from(msgList.children)) {
                const el = child as HTMLElement
                if (el.dataset.messageId === msg.messageId) {
                  found = true
                } else if (found) {
                  el.remove()
                }
              }
            }
            const msgIdx = active.messages.findIndex((m) => m.id === msg.messageId)
            if (msgIdx !== -1) {
              active.messages.splice(msgIdx + 1)
              stateManager.save()
              refreshActivityAndTasks(sid)
            }

            els.promptInput.value = msg.text as string
            autoResizeTextarea()
            updatePromptContextChips()
            updateSendButton()
            els.promptInput.focus()
          }
        }
      }],
      ["insert_text", (msg) => {
        if (typeof msg.text === "string") {
          insertTextAtCursor(msg.text)
        }
      }],
      ["skill_indicator", (msg, sid) => {
        if (sid && typeof msg.skillName === "string") {
          showSkillIndicator(sid, msg.skillName as string)
        }
      }],
      ["mcp_servers", (msg) => {
        if (Array.isArray(msg.servers)) {
          mcpConfig.setServers(msg.servers as McpServerInfo[])
        }
      }],
      ["todos_update", (msg) => {
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : null
        if (!sid) {
          webviewLog(`[main] dropped todos_update without sessionId`)
          return
        }
        if (!stateManager.getSession(sid)) {
          webviewLog(`[main] dropped todos_update for unknown sessionId=${sid}`)
          return
        }
        const rawTodos = Array.isArray(msg.todos) ? msg.todos : []
        const validTodos = rawTodos.flatMap((t): Todo[] => {
          if (!t || typeof t !== "object") return []
          const obj = t as Record<string, unknown>
          const id = typeof obj.id === "string" ? obj.id : ""
          if (!id) {
            webviewLog(`[main] dropped malformed todo (id=<missing>)`)
            return []
          }
          const status = obj.status
          const priority = typeof obj.priority === "string" ? obj.priority : undefined
          const normalizedStatus: Todo["status"] =
            status === "pending" || status === "in-progress" || status === "completed" || status === "cancelled"
              ? status
              : "pending"
          return [{
            id,
            content: typeof obj.content === "string" ? obj.content : "",
            status: normalizedStatus,
            createdAt: typeof obj.createdAt === "number" ? obj.createdAt : 0,
            ...(priority ? { priority } : {}),
          }]
        })
        setServerTodos(sid, validTodos)
        todosPanelApi?.clearError?.()
        webviewLog(`[main] todos_update received ${validTodos.length} todos for session ${sid}`)
        if (sid === stateManager.getState().activeSessionId) {
          triggerTodosRender(sid, { autoOpen: true })
        }
      }],
      ["todos_error", (msg) => {
        const message = typeof msg.message === "string" ? msg.message : "Failed to load tasks."
        webviewLog(`[main] todos_error: ${message}`)
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : stateManager.getState().activeSessionId
        if (sid && sid === stateManager.getState().activeSessionId) {
          todosPanelApi?.renderError?.(message, () => {
            // Retry: re-request todos from the host.
            vscode.postMessage({ type: "get_todos", sessionId: sid })
          })
        }
      }],
      ["changed_files_update", (msg) => {
        // Strict: never fall back to the active tab for changed-file sync.
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : null
        if (!sid) {
          webviewLog(`[main] dropped changed_files_update without sessionId`)
          return
        }
        const files = Array.isArray(msg.files) ? msg.files : []
        const paths = files
          .map((file) => typeof file === "string" ? file : (file && typeof file === "object" && "path" in file ? String((file as { path?: unknown }).path || "") : ""))
          .filter((path) => path.length > 0)
        handleChangedFiles(sid, paths)
        // Always store per-session state; the dropdown itself decides whether
        // to render based on its current session.
        cfDropdownApi?.updateChangedFiles(sid, files as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- bridges to changed-files dropdown API shape
      }],
      ["file_diff_response", (msg) => {
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : null
        if (!sid) {
          webviewLog(`[main] dropped file_diff_response without sessionId`)
          return
        }
        const path = typeof msg.path === "string" ? msg.path : ""
        const lines = Array.isArray(msg.lines) ? msg.lines as DiffLine[] : null
        const error = typeof msg.error === "string" ? msg.error : undefined
        if (path) cfDropdownApi?.handleDiffResponse(sid, path, lines, error)
      }],
      ["file_hunks", (msg, envSid) => {
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : envSid
        const path = typeof msg.path === "string" ? msg.path : ""
        const hunks = Array.isArray(msg.hunks) ? (msg.hunks as FileHunkView[]) : []
        if (sid && path) handleCfFileHunks(sid, path, hunks)
      }],
      ["hunk_reverted", (msg) => {
        // Host already re-emits file_hunks with the remaining hunks; surface a
        // failure to the user if the revert didn't apply (e.g. stale diff).
        if (msg.ok === false) webviewLog(`[main] revert_hunk failed for ${String(msg.path)} (${String(msg.reason ?? "error")})`)
      }],
      ["skills_list", (msg) => {
        if (skillsModalApi && skillsModalApi.renderSkills) {
          skillsModalApi.renderSkills(msg.skills || [])
        }
      }],
      ["skills_search_results", (msg) => {
        if (skillsModalApi && skillsModalApi.renderSearchResults) {
          skillsModalApi.renderSearchResults(msg.results || [])
        }
      }],
      ["subagent_activities", (msg) => {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : stateManager.getState().activeSessionId
        if (!sessionId) return
        const activities = Array.isArray(msg.activities) ? msg.activities as SubagentActivity[] : []
        mergeSubagentActivities(sessionId, activities)
        if (sessionId === stateManager.getState().activeSessionId) {
          refreshSubagentPanel(sessionId)
        }
      }],
      ["subagent_detail", (msg: Record<string, unknown>) => {
        const sessionId = msg.sessionId as string | undefined
        if (subagentDetailViewApi && msg.detail && sessionId) {
          if (subagentDetailViewApi.showDetail) {
            const sessions = stateManager.getState().sessions
            const session = sessions[sessionId]
            const activities: SubagentActivity[] = (session?.subagentActivities as SubagentActivity[]) ?? []
            const sid = msg.subagentId as string ?? ""
            const activity = activities.find((a) => a.id === sid) ?? { id: sid, name: "subagent", status: "completed" as const }
            subagentDetailViewApi.showDetail(activity, msg.detail as Record<string, unknown>)
          }
        }
      }],
      ["subagent_update", (msg) => {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : undefined
        const subagent = msg.subagent as SubagentActivity | undefined
        if (sessionId && subagent?.id) {
          const merged = mergeSubagentActivities(sessionId, [subagent])

          // Auto-open only if this is a NEW subagent id
          const prevKnownIds = knownSubagentIdsBySession.get(sessionId) ?? new Set()
          const newIds = computeNewSubagentIds(prevKnownIds, [subagent])
          const allIds = new Set([...prevKnownIds, subagent.id])
          knownSubagentIdsBySession.set(sessionId, allIds)

          // Badge-only notification: don't auto-open the panel on new
          // subagent activity. The badge already shows the count; users
          // toggle the panel manually.
          if (merged.length > 0 && sessionId === stateManager.getState().activeSessionId) {
            refreshSubagentPanel(sessionId)
          }
        }
        // Update the active subagent tracking used by the "Open in editor" button.
        if (sessionId && subagent?.id) {
          const normalized = subagent.id.startsWith("subagent:")
            ? subagent.id.slice("subagent:".length)
            : subagent.id
          activeSubagentId = normalized
        }
        if (subagentDetailViewApi && msg.subagent) {
          const subagent = msg.subagent as Record<string, unknown>
          if (subagentDetailViewApi.showDetail) {
            subagentDetailViewApi.showDetail(subagent as unknown as SubagentActivity, subagent)
          }
        }
      }],
      ["push_all_state", () => {
        requestStateSyncDebounced()
      }],
      ["push_visible_state", () => {
        requestStateSyncDebounced()
      }],
      ["question_asked", (msg, sid) => {
        const block = msg.block as any
        const messageId = msg.messageId as string || ""
        if (block && block.type === "question") {
          // Pass the envelope sid so a background session's question is never
          // attributed to the tab the user is currently viewing (multi-tab fix).
          questionBar.addQuestion(block, messageId, sid)
        }
      }],
      ["question_acknowledged", (_msg, _sid) => {
        const toolCallId = _msg.toolCallId as string || _msg.requestID as string || ""
        // The host confirms the answer was received — remove the answered
        // item from the bar immediately so the user gets fast feedback. The
        // webview already posted the answer and showed a local "Answered"
        // state via markQuestionAnswered, so this just cleans it up.
        if (toolCallId) questionBar.removeQuestion(toolCallId)
      }],
      ["question_unacknowledged", (_msg, _sid) => {
        // B9/B10: the host's answer submission failed. Check the error
        // category to decide whether to revert (transient — user can retry)
        // or remove (expired — question is dead on the server).
        const toolCallId = _msg.toolCallId as string || _msg.requestID as string || ""
        const category = _msg.category as string || ""
        if (category === "expired") {
          // B10: Question expired on the server. Remove from bar entirely
          // — there's no point showing interactive controls for a dead question.
          if (toolCallId) questionBar.removeQuestion(toolCallId)
        } else {
          // B9: Transient error — revert to interactive state so user can retry.
          if (toolCallId) questionBar.unmarkQuestionAnswered(toolCallId)
        }
      }],
      ["expired_question_recovery_failed", (msg, sid) => {
        // B10-recovery: The expired-question fallback startPrompt didn't
        // produce a model response within the hard timeout (or threw
        // outright). Pre-fill the prompt input with the user's original
        // answer text and auto-send so the user doesn't have to manually
        // resend — seamless recovery.
        const answerText = typeof (msg as Record<string, unknown>).answerText === "string"
          ? (msg as Record<string, unknown>).answerText as string
          : ""
        const reason = typeof (msg as Record<string, unknown>).reason === "string"
          ? (msg as Record<string, unknown>).reason as string
          : "unknown"
        const targetSessionId = sid ?? stateManager.getState().activeSessionId ?? undefined
        webviewLog(`[main] expired_question_recovery_failed (reason=${reason}); auto-forwarding answer text (${answerText.length} chars)`)
        if (answerText.length > 0) {
          // Switch to the correct tab before sending.
          if (targetSessionId) switchTab(targetSessionId)
          els.promptInput.value = answerText
          // Raise input event so autosize/character count update.
          els.promptInput.dispatchEvent(new Event("input", { bubbles: true }))
          els.promptInput.focus()
          // Defer auto-send to let the stream_end handler clear streaming
          // state first, then auto-fire the send — no manual Enter needed.
          setTimeout(() => {
            if (els.promptInput.value.trim().length > 0) {
              sendMessage()
            }
          }, 100)
        }
      }],
    ])

    // I3: surface unknown host message types and capture handler exceptions so silent
    // drops do not mask schema drift between the host and webview bundles.
    const loggedUnknownTypes = new Set<string>()
    function dispatchHostMessage(msg: LegacyHostMessage): void {
      if (!msg || !msg.type) return

      const sessionId = ((msg.message as { sessionId?: string } | undefined)?.sessionId || msg.sessionId) as string | undefined
      const handler = messageHandlers.get(msg.type)
      if (!handler) {
        if (!loggedUnknownTypes.has(msg.type)) {
          loggedUnknownTypes.add(msg.type)
          webviewLog(`[main] unknown host message type: ${msg.type}`)
        }
        return
      }
      try {
        handler(msg, sessionId)
      } catch (err) {
        webviewLog(`[main] handler for ${msg.type} threw: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    window.addEventListener("message", (event) => {
      const msg = event.data as LegacyHostMessage
      if (msg?.type === "host_message_batch" && Array.isArray((msg as { messages?: unknown }).messages)) {
        for (const item of (msg as { messages: unknown[] }).messages) {
          dispatchHostMessage(item as LegacyHostMessage)
        }
        return
      }
      dispatchHostMessage(msg)
    })

    window.addEventListener("beforeunload", () => {
      stateManager.flush()
      todosPanelApi?.dispose?.()
      activityPanelApi?.dispose?.()
      tasksPanelApi?.dispose?.()
      subagentPanelApi?.dispose?.()
      voiceInputApi?.dispose()
    })

    let stateSyncDebounce: ReturnType<typeof setTimeout> | undefined

    function requestStateSyncDebounced(): void {
      if (stateSyncDebounce) timers.clearTimeout(stateSyncDebounce)
      stateSyncDebounce = timers.setTimeout(() => {
        vscode.postMessage({ type: "request_state_sync" })
      }, 300)
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        requestStateSyncDebounced()
      }
    })

    // Mirror webview focus to a host context key so keybindings can override VS
    // Code defaults (e.g. Alt+1/2/3 = openEditorAtIndex, Ctrl+W = close editor)
    // ONLY while the chat is focused. `focusedView` is unreliable for webview
    // views (vscode#234683), so we report focus explicitly from the iframe.
    const reportChatFocus = (focused: boolean) => {
      try { vscode.postMessage({ type: "chat_focus", focused }) } catch { /* host gone */ }
    }
    window.addEventListener("focus", () => {
      reportChatFocus(true)
      requestStateSyncDebounced()
    })
    window.addEventListener("blur", () => reportChatFocus(false))
    // The iframe usually loads already focused; seed the context key so the very
    // first keystroke is covered without waiting for a focus event.
    if (document.hasFocus()) reportChatFocus(true)
  }

  /* ─── TURN NAVIGATION ─── */
  // #turn-nav (prev/next/select) removed — the conversation timeline sidebar
  // is the single navigation aid. scrollToTurn is still used by the timeline.
  /* ─── CONVERSATION TIMELINE ─── (delegated to timeline.ts) */

  function applyTimelineVisibility(sessionId?: string) { timeline.applyTimelineVisibility(sessionId) }
  function refreshConversationTimeline(sessionId?: string) { timeline.refreshConversationTimeline(sessionId) }

	  /* ─── DISPLAY TOGGLES (Phase 4.2) ─── */

  setupDisplayToggles({ els, getState: () => stateManager.getState(), save: () => stateManager.save() })

  // Last methodology selection per session, fed by methodology_selected.
  // Rendered as a compact status-strip chip scoped to the active session so
  // selections from a background tab never bleed into the visible strip.
  const methodologyBySession = new Map<string, { label: string; strategy: string; taskType: string; auto: boolean }>()

  function renderMethodologyChip(sessionId: string) {
    const info = methodologyBySession.get(sessionId)
    if (!info) {
      els.statusMethodology.classList.add("hidden")
      els.statusMethodology.textContent = ""
      return
    }
    els.statusMethodology.textContent = `◆ ${info.label}`
    els.statusMethodology.title =
      `Methodology (${info.auto ? "auto-selected" : "manual"}): ${info.label}` +
      (info.strategy ? ` · ${info.strategy}` : "") +
      (info.taskType ? `\nTask type: ${info.taskType}` : "") +
      `\nDisable for this tab with /methodology off`
    els.statusMethodology.setAttribute("aria-label", `Selected methodology: ${info.label}`)
    els.statusMethodology.classList.remove("hidden")
  }

  function showSecondaryNav() {
    els.displayToggles.classList.remove("hidden")
    const activeId = stateManager.getState().activeSessionId
    if (activeId) {
      const model = stateManager.getSession(activeId)?.model || stateManager.getState().globalModel
      if (model) {
        const parts = model.split("/")
        els.statusModel.textContent = parts[parts.length - 1] ?? model
      }
      updateCostDisplay(activeId)
      const session = stateManager.getSession(activeId)
      if (session?.tokenUsage) updateTokenDisplay(session.tokenUsage)
    }
  }

  function showSkillIndicator(sessionId: string, skillName: string) {
    streamOrchestrator.showSkillIndicator(sessionId, skillName)
  }

  function insertTextAtCursor(text: string) {
    composer.insertTextAtCursor(text)
  }

  function handleCostUpdate(sessionId: string, cost: number) {
    streamOrchestrator.handleCostUpdate(sessionId, cost)
  }

  function handleHostMessage(msg: ChatMessage) {
    streamOrchestrator.handleHostMessage(msg)
  }

  function updateAgentStatus(status: "idle" | "thinking" | "executing") {
    streamOrchestrator.updateAgentStatus(status)
  }

  function handleStreamStart(sessionId: string, messageId?: string, opts?: { skipAnchor?: boolean }) {
    // Reset the subagent-panel dismissal flag at the start of each new run —
    // user dismissal is per-run; a fresh prompt should respect auto-open again.
    subagentDismissedBySession.delete(sessionId)
    knownSubagentIdsBySession.delete(sessionId)
    streamOrchestrator.handleStreamStart(sessionId, messageId, opts)
    // Stamp the active model onto the new streaming message so the per-turn
    // model indicator badge can show which model generated each response.
    const session = stateManager.getSession(sessionId)
    if (session?.model) {
      const msgs = session.messages
      const streamingMsg = messageId
        ? msgs.find((m) => m.id === messageId)
        : msgs[msgs.length - 1]
      if (streamingMsg && streamingMsg.role === "assistant" && !streamingMsg.model) {
        streamingMsg.model = session.model
      }
    }
  }

  function handleStreamChunk(sessionId: string, text?: string, messageId?: string) {
    streamOrchestrator.handleStreamChunk(sessionId, text, messageId)
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) {
    streamOrchestrator.handleStreamEnd(sessionId, messageId, blocks, reason, partial)
  }

  function handleServerStatus(sessionId: string, status?: string, errorContext?: unknown) {
    streamOrchestrator.handleServerStatus(sessionId, status, errorContext)
  }

  function handleRequestError(sessionId: string | undefined, message?: string, errorContext?: unknown) {
    streamOrchestrator.handleRequestError(sessionId, message, errorContext)
  }

  function handleDiffResult(sessionId: string | undefined, blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) {
    streamOrchestrator.handleDiffResult(sessionId, blockId, ok, message, checkpointCreated)
  }

  /* ─── TOKEN/COST DISPLAY ─── */

  const tokenCostDeps: TokenCostDeps = {
    els,
    getSession: (id: string) => stateManager.getSession(id),
    getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
    save: () => stateManager.save(),
    getContextWindow: (modelKey?: string) => modelManager.getContextWindow(modelKey),
    showStatusStrip,
    getActiveMessageList: () => getActiveMessageList(els),
    timers,
    isWelcomeVisible,
  }

  function handleTokenUsage(sessionId: string, usage: UsageDelta) {
    handleTokenUsageModule(tokenCostDeps, sessionId, usage)
  }

  function accumulateTokenUsage(sessionId: string, delta: UsageDelta) {
    accumulateTokenUsageModule(tokenCostDeps, sessionId, delta)
  }

  function accumulateCost(sessionId: string, costDelta: number) {
    accumulateCostModule(tokenCostDeps, sessionId, costDelta)
  }

  function applyTokenUsageTotals(sessionId: string, totals: UsageDelta, cumulativeCost?: number) {
    applyTokenUsageTotalsModule(tokenCostDeps, sessionId, totals, cumulativeCost)
  }

  /** Parse the host's cumulative token ledger off a step_tokens/token_usage payload. */
  function readCumulativeTotals(msg: Record<string, unknown>): UsageDelta | null {
    const raw = msg.cumulative as Partial<UsageDelta> | undefined
    if (!raw || typeof raw !== "object") return null
    if (typeof raw.prompt !== "number" || !Number.isFinite(raw.prompt)) return null
    if (typeof raw.completion !== "number" || !Number.isFinite(raw.completion)) return null
    return {
      prompt: raw.prompt,
      completion: raw.completion,
      total: typeof raw.total === "number" && Number.isFinite(raw.total)
        ? raw.total
        : raw.prompt + raw.completion + (raw.reasoning ?? 0) + (raw.cacheRead ?? 0) + (raw.cacheWrite ?? 0),
      reasoning: raw.reasoning ?? 0,
      cacheRead: raw.cacheRead ?? 0,
      cacheWrite: raw.cacheWrite ?? 0,
    }
  }

  function handleRateLimitState(state?: RateLimitWebviewState | null) {
    handleRateLimitStateModule(tokenCostDeps, state)
  }

  function clearTokenDisplay() {
    clearTokenDisplayModule(els)
  }

  function updateTokenDisplay(usage?: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }) {
    updateTokenDisplayModule(els, usage)
  }

  function updateCostDisplay(sessionId: string) {
    updateCostDisplayModule(tokenCostDeps, sessionId)
  }

  function updateContextBarFromSession(sessionId: string) {
    updateContextBarFromSessionModule(tokenCostDeps, sessionId)
  }

  function resetContextUsagePanel() {
    resetContextUsageDropdown()
    els.contextUsage.classList.add("hidden")
    document.getElementById("ctx-window-unknown-chip")?.classList.add("hidden")
  }

  // Update the always-visible status-strip context bar (progress + label text).
  // Separate from ctxDropdownApi which drives the floating detail panel.
  function updateContextUsageBar(pct: number, tokens: number, maxTokens: number): void {
    try {
      const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
      const safeTokens = Number.isFinite(tokens) ? Math.max(0, tokens) : 0
      const safeMaxTokens = Number.isFinite(maxTokens) ? Math.max(0, maxTokens) : 0
      const bar = els.contextUsage
      const fill = els.contextProgressFill
      const label = els.contextLabel

      if (fill) {
        fill.style.setProperty("--usage-pct", String(Math.min(1, Math.max(0, safePct / 100))))
      }
      bar.setAttribute("aria-valuenow", String(Math.round(safePct)))
      bar.setAttribute("aria-valuetext", `${Math.round(safePct)}% used`)
      bar.setAttribute("aria-label", `Context usage — ${Math.round(safePct)}% used`)
      if (label) {
        label.textContent = `${formatUsagePercent(safePct)} used`
        label.title = getContextUsageTooltip({
          percent: safePct,
          tokens: safeTokens,
          maxTokens: safeMaxTokens,
          unknownWindow: safeMaxTokens <= 0,
        })
      }
      const shouldHide = safePct === 0 && safeTokens === 0
      bar.classList.toggle("hidden", shouldHide)
      if (isWelcomeVisible()) {
        bar.classList.add("hidden")
      } else if (!shouldHide) {
        showStatusStrip()
      }
      // Apply visual state based on utilisation thresholds
      const state = deriveState(safePct, safeTokens, safeMaxTokens)
      bar.classList.toggle("context-usage-bar--good", state === "good")
      bar.classList.toggle("context-usage-bar--caution", state === "caution")
      bar.classList.toggle("context-usage-bar--warning", state === "warning")
      bar.classList.toggle("context-usage-bar--critical", state === "critical" || state === "over")
      bar.setAttribute("data-state", state)
      if (state === "over") bar.setAttribute("aria-valuetext", `${Math.round(safePct)}% used — over limit`)
    } catch (e) {
      console.warn("[opencode-harness] Context usage bar update failed:", e instanceof Error ? e.message : String(e))
    }
  }



  function showStatusStrip() {
    if (isWelcomeVisible()) return
    els.statusStrip.removeAttribute("hidden")
  }

  function hideStatusStrip() {
    els.statusStrip.setAttribute("hidden", "")
    els.statusCost.classList.add("hidden")
    els.statusTokens.classList.add("hidden")
    els.quotaBar.classList.add("hidden")
    if (hasQuotaState && !isWelcomeVisible()) {
      els.statusStrip.removeAttribute("hidden")
      els.quotaBar.classList.remove("hidden")
    }
    els.contextUsage.classList.add("hidden")
    document.getElementById("ctx-window-unknown-chip")?.classList.add("hidden")
  }

  function updateBranchChip(branch: string): void {
    const chip = document.getElementById("status-branch")
    const name = chip?.querySelector(".status-strip-branch-name")
    if (chip && name && branch) {
      name.textContent = branch
      chip.classList.remove("hidden")
      showStatusStrip()
    }
  }

  const fileTrackingDeps: FileTrackingDeps = {
    getSession: (id) => stateManager.getSession(id),
    save: () => stateManager.save(),
    postMessage: (msg) => vscode.postMessage(msg),
    getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
    changedFilesList: null,
    checkpointPanel: els.checkpointPanel,
    checkpointToggleBtn: els.checkpointToggleBtn,
    clearMessages: (sessionId) => streamHandlers.get(sessionId)?.clearMessages(),
    getMessageList: (id) => getMessageList(id),
    getAllSessions: () => stateManager.getAllSessions(),
  }


  function handleChangedFiles(sessionId: string, files: string[]) {
    handleChangedFilesModule(fileTrackingDeps, sessionId, files)
  }

  function renderCheckpointPanel(checkpoints: Array<{ id: string; sessionId: string; messageId?: string; createdAt?: number; filesChanged?: string[]; action?: string }>) {
    renderCheckpointPanelModule(fileTrackingDeps, checkpoints)
  }

  function handleClearMessages(sessionId?: string) {
    handleClearMessagesModule(fileTrackingDeps, sessionId)
  }

  /* ─── START ─── */

function boot() {
    try {
      init()
      // Sprint 1 typography: toggle data-density on the document element
      // based on the webview's rendered width so the sidebar gets compact
      // spacing/typography and the panel/editor column gets comfortable.
      // Thresholds from the research: ≤340px compact, ≥500px comfortable,
      // in-between defaults to compact (matches VS Code's narrow-sidebar
      // behavior). The ResizeObserver is cheap (browser-coalesced) and
      // fires only on actual width changes.
      try {
        const updateDensity = () => {
          const w = document.documentElement.clientWidth || window.innerWidth || 0
          const density = w >= 500 ? "comfortable" : "compact"
          if (document.documentElement.getAttribute("data-density") !== density) {
            document.documentElement.setAttribute("data-density", density)
          }
        }
        updateDensity()
        const ro = new ResizeObserver(updateDensity)
        ro.observe(document.documentElement)
      } catch (densityErr) {
        // ResizeObserver missing (very old webview) — fall back to comfortable
        // (the default in tokens.css's :root:not([data-density]) branch).
        log.warn("ResizeObserver unavailable; density adaptation disabled", densityErr)
      }
      vscode.postMessage({ type: "webview_ready" })
      vscode.postMessage({ type: "list_commands" })

      // Periodic question bar reconciliation: clean stale answered items
      // and restore any that fell out of the DOM (RC-1 defense).
      setInterval(() => {
        const activeId = stateManager.getState().activeSessionId
        if (activeId) questionBar.reconcileBar(activeId)
      }, 30_000)
    } catch (err) {
      log.error("Fatal init error:", err)
      vscode.postMessage({ type: "webview_error", message: "Initialization failed" })
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})()
