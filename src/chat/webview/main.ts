import type { ChatMessage, HostMessage, LegacyHostMessage, MentionItem, SessionSummary, ModelInfo, WebviewState, ContextChip, ToolCallState, TokenUsageSnapshot, UsageDelta, Block } from "./types"
import type { AttachmentEls } from "./ui/attachments"
import { timers } from "./timerRegistry"
import { createState } from "./state"
import { getElementRefs, scrollToBottom, getActiveMessageList, toggleAllThinkingBlocks, type ElementRefs } from "./dom"
import { renderMessage } from "./messageRenderer"
import { groupMessagesIntoTurns } from "./renderer"
import { setupMentions } from "./mentions"
import { setupCommandsModal, type CommandEntry } from "./commands-modal"
import { toCommandEntries } from "./slash-commands"
import { createStreamHandlers, type StreamHandlers } from "./stream"
import { createTabBar, createTabContent, switchToTab, removeTabContent } from "./tabs"
import { setupModelDropdown } from "./model-dropdown"
import { setVsCodeApi, setupToolKeyboardNav, webviewLog } from "./streamHandlers"
import { setupModelManager } from "./model-manager"
import { setupVariantSelector } from "./variant-selector"
import { setupMcpConfig } from "./mcp-config"
import type { McpServerInfo } from "../../mcp/McpServerManager"
import { REMOVE_SVG } from "./icons"
import { createPromptQueue, type PromptQueue, type QueueItem } from "./queue"
import { updateContextChips, updateContextUsage, applyThemeVars, handleRateLimitExhausted } from "./theme"
import { setupContextUsagePanel as setupContextUsagePanelInit, setContextUsagePanel, setContextUsagePostMessage, handleContextUsageMessage, resetContextUsagePanel } from "./context-usage-panel"
import { showCompactBanner, hideCompactBanner } from "./compact-banner"
import { setupContextMonitor } from "./context-monitor"
import { setupPromptStash } from "./prompt-stash"
import { renderRecentSessions } from "./recent-sessions"
import { renderUnifiedSessionList, setSessionListPostMessage, setUnifiedServerSessions, setUnifiedLocalSessions } from "./sessionListRenderer"
import { createScrollAnchor, type ScrollAnchor } from "./scrollAnchor"
import { createChunkedLoader, prependMessagesPreservingScroll, createLoadEarlierBanner, throttleScrollMarkers } from "./messageLoader"
import { createVirtualList, getVirtualList, disposeVirtualList } from "./virtualList"
import { setupTodosPanel } from "./todos-panel"
import { setupSkillsModal } from "./skills-modal"
import { setupSubagentPanel } from "./subagent-panel"
import { shouldRefreshOnUpdate, selectDisplayedUsage } from "./tokenDisplayPolicy"
import { setThinkingVisible, getThinkingVisible } from "./displayPrefs"
import { setupSearch } from "./ui/messageSearch"
import { ToolElapsedTracker } from "./ui/toolElapsed"
import { FileEditBatcher } from "./ui/fileEditBatcher"
import { setupDisplayToggles } from "./ui/displayToggles"
import { setupThemeCustomizer, openThemeCustomizer, closeThemeCustomizer, populateCliList, applyThemeCustomizerConfig, collectThemeCustomizerConfig, type ThemeCustomizerConfig } from "./ui/themeCustomizer"
import { setupModeToggle, updateModeDropdown, closeModeDropdown, updateModeSelectorState, syncModeUI as syncModeUIModule, getCurrentMode } from "./ui/modeDropdown"
import { setupInstructionsEditor } from "./ui/instructionsEditor"
import { setupSessionModal as setupSessionModalModule, openSessionModal as openSessionModalModule, closeSessionModal as closeSessionModalModule, trapModalFocus } from "./ui/sessionModal"
import { setupModeWarning as setupModeWarningModule, showAutoModeWarning as showAutoModeWarningModule, closeModeWarning as closeModeWarningModule, isModeWarningOpen, type ModeWarningEls } from "./ui/modeWarning"
import { handleTokenUsage as handleTokenUsageModule, accumulateTokenUsage as accumulateTokenUsageModule, accumulateCost as accumulateCostModule, rememberStepUsage, isDuplicateRecentStepUsage, handleRateLimitState as handleRateLimitStateModule, recordUsageSnapshot as recordUsageSnapshotModule, updateCostDisplay as updateCostDisplayModule, updateTokenDisplay as updateTokenDisplayModule, clearTokenDisplay as clearTokenDisplayModule, updateContextBarFromSession as updateContextBarFromSessionModule, checkOverflowWarnings as checkOverflowWarningsModule, formatTokenCount as formatTokenCountModule, type TokenCostDeps, type RateLimitWebviewState } from "./ui/tokenCostDisplay"
import { createAttachmentManager, parsePromptMentions, removePromptToken } from "./ui/attachments"
import { showWelcomeView as showWelcomeViewModule, hideWelcomeView as hideWelcomeViewModule, renderWelcomeContext as renderWelcomeContextModule, setupWelcomeActions as setupWelcomeActionsModule, setupWelcomeSuggestions as setupWelcomeSuggestionsModule, setupWelcomeResponsive as setupWelcomeResponsiveModule, type WelcomeViewDeps } from "./ui/welcomeView"
import { closeSettingsMenu as closeSettingsMenuModule, closeCurrentModal as closeCurrentModalModule, setupSettingsMenuKeyboardNav as setupSettingsMenuKeyboardNavModule, type SettingsMenuDeps } from "./ui/settingsMenu"
import { trackFileChange as trackFileChangeModule, undoMessage as undoMessageModule, handleChangedFiles as handleChangedFilesModule, renderChangedFilesList as renderChangedFilesListModule, renderCheckpointPanel as renderCheckpointPanelModule, handleClearMessages as handleClearMessagesModule, type FileTrackingDeps } from "./ui/fileTracking"
import { setupButtons as setupButtonsModule, type ButtonSetupDeps } from "./ui/buttonSetup"
import { updateScrollMarkers as updateScrollMarkersModule, setupJumpToBottom as setupJumpToBottomModule, scrollMessageToTop as scrollMessageToTopModule, scrollToTurn as scrollToTurnModule, type ScrollMarkerDeps } from "./ui/scrollMarkers"

declare const acquireVsCodeApi: (() => {
  postMessage(message: Record<string, unknown>): void
  getState(): import("./types").WebviewState | undefined
  setState(state: import("./types").WebviewState): void
}) | undefined

const log = {
  warn: (...args: unknown[]) => console.warn("[opencode-harness]", ...args),
  error: (...args: unknown[]) => console.error("[opencode-harness]", ...args),
}

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
  window.addEventListener("error", (event) => {
    log.error("Unhandled error:", event.error || event.message)
    const errorDiv = document.getElementById("error-boundary")
    if (errorDiv) {
      errorDiv.style.display = "block"
      errorDiv.textContent = "An error occurred. Please reload the panel."
    }
  })

  window.addEventListener("unhandledrejection", (event) => {
    log.error("Unhandled promise rejection:", event.reason)
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
  let todosPanelApi: any = null
  let skillsModalApi: any = null
  let subagentPanelApi: any = null

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
      modelManager.open()
      vscode.postMessage({ type: "get_models" })
    },
  })

  modelManager = setupModelManager(els, {
	    onToggleModel: (modelId, enabled) => {
	      modelManager.updateModelEnabled(modelId, enabled)
	      // Persist disabled state to webview state
	      stateManager.setModelDisabled(modelId, !enabled)
	      syncModelViews()
	    },
	    onToggleFavorite: (modelId) => {
	      const favorite = stateManager.toggleModelFavorite(modelId)
	      modelManager.updateModelFavorite(modelId, favorite)
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
      vscode.postMessage({ type: "connect_provider" })
    },
  })

	  const variantSelector = setupVariantSelector(els, {
    onSelect: (variant) => {
      const active = stateManager.getActiveSession()
      if (active) {
        vscode.postMessage({ type: "set_variant", variant, sessionId: active.id })
      }
    },
	  })

	  function syncModelViews(models = modelManager.getAllModels()) {
	    const modelsWithState = stateManager.applyModelState(models)
	    const currentModel = stateManager.getState().globalModel
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

  let contextMonitorHandlers: { toggle: () => void } | null = null

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
    onToggleContextMonitor: () => contextMonitorHandlers?.toggle(),
    onSetContextWindowOverride: () => vscode.postMessage({ type: "open_context_window_override_dialog" }),
  })

  // Streaming state per session
  const streamHandlers = new Map<string, ReturnType<typeof createStreamHandlers>>()
  let streamChunkLogCount = 0
  const MAX_CONCURRENT_STREAMS = 3
  const STREAM_LIMIT_TOOLTIP = "3 streams active — wait or stop another tab first"

  // Scroll anchors per tab — disposed on tab close
  const scrollAnchors = new Map<string, ScrollAnchor>()

  // Tracks how many messages exist before the current viewport window so the
  // webview can request earlier pages via request_more_messages.
  const sessionBeforeIndex = new Map<string, number>()

  // Throttled updateScrollMarkers — prevents O(n) DOM work on every chunk tick
  const debouncedUpdateScrollMarkers = throttleScrollMarkers((id) => updateScrollMarkers(id))

  // Throttled timeline refresh — the timeline walks all messages; debounce it during streaming
  const debouncedTimelineRefresh = throttleScrollMarkers((id) => refreshConversationTimeline(id))

  // Per-tab prompt queues — keyed by sessionId
  const promptQueues = new Map<string, PromptQueue>()

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

  function runCommandEntry(entry: CommandEntry): void {
    const active = stateManager.getActiveSession()
    if (!active) return
    if (entry.source === "local" && entry.insertText) {
      // Locals that take no args run immediately; ones that take args (trailing space) get inserted.
      if (entry.insertText.endsWith(" ")) {
        els.promptInput.value = entry.insertText
        autoResizeTextarea()
        updateSendButton()
        els.promptInput.focus()
        return
      }
      // Reuse the existing switch — just fire-and-forget via execute_command or local routing.
      els.promptInput.value = entry.insertText
      sendMessage()
      return
    }
    if (entry.source === "server") {
      vscode.postMessage({ type: "execute_command", command: `/${entry.name}`, sessionId: active.id })
      return
    }
    // Custom prompt — host expands template and pushes prefill_prompt back.
    vscode.postMessage({ type: "execute_command", command: `/${entry.name}`, sessionId: active.id })
  }

  function insertIntoPrompt(text: string): void {
    els.promptInput.value = text
    autoResizeTextarea()
    updateSendButton()
    els.promptInput.focus()
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
  })

  // Mode state: "plan" or "build"
  let currentMode = getCurrentMode()

  // Steering mode state: "interrupt", "append", or "queue"
  let currentSteerMode: 'interrupt' | 'append' | 'queue' = 'interrupt'

  function setSteerMode(mode: 'interrupt' | 'append' | 'queue') {
    currentSteerMode = mode

    // Update UI to reflect selected mode
    const interruptBtn = document.getElementById("steer-mode-interrupt") as HTMLButtonElement
    const appendBtn = document.getElementById("steer-mode-append") as HTMLButtonElement
    const queueBtn = document.getElementById("steer-mode-queue") as HTMLButtonElement

    if (interruptBtn) {
      interruptBtn.classList.toggle("active", mode === "interrupt")
      interruptBtn.setAttribute("aria-pressed", String(mode === "interrupt"))
    }
    if (appendBtn) {
      appendBtn.classList.toggle("active", mode === "append")
      appendBtn.setAttribute("aria-pressed", String(mode === "append"))
    }
    if (queueBtn) {
      queueBtn.classList.toggle("active", mode === "queue")
      queueBtn.setAttribute("aria-pressed", String(mode === "queue"))
    }

    // Update input area border color to indicate steering mode
    els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
    els.inputArea.classList.add(`steer-${mode}`)
  }

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
  const pendingToolUpdates = new Map<string, {
    sessionId: string
    toolId: string
    update: { state?: ToolCallState; args?: unknown }
    timer: ReturnType<typeof setTimeout>
  }>()
  const toolChainProgressTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function scheduleToolUpdate(sessionId: string, toolId: string, update: { state?: ToolCallState; args?: unknown }): void {
    const key = `${sessionId}:${toolId}`
    const pending = pendingToolUpdates.get(key)
    if (pending) {
      pending.update = { ...pending.update, ...update }
      return
    }
    const timer = timers.setTimeout(() => {
      const latest = pendingToolUpdates.get(key)
      pendingToolUpdates.delete(key)
      const stream = streamHandlers.get(sessionId)
      if (latest && stream) stream.handleToolUpdate(toolId, latest.update)
    }, 50)
    pendingToolUpdates.set(key, { sessionId, toolId, update, timer })
  }

  function flushToolUpdate(sessionId: string, toolId: string): void {
    const key = `${sessionId}:${toolId}`
    const pending = pendingToolUpdates.get(key)
    if (!pending) return
    timers.clearTimeout(pending.timer)
    pendingToolUpdates.delete(key)
    const stream = streamHandlers.get(sessionId)
    if (stream) stream.handleToolUpdate(toolId, pending.update)
  }

  function markToolChainProgress(sessionId: string): void {
    if (toolChainProgressTimers.has(sessionId)) return
    const timer = timers.setTimeout(() => {
      toolChainProgressTimers.delete(sessionId)
      const msgList = getMessageList(sessionId)
      if (!msgList || msgList.querySelector(".tool-chain-progress")) return
      const progress = document.createElement("div")
      progress.className = "tool-chain-progress"
      progress.textContent = "Tool chain running..."
      progress.setAttribute("role", "status")
      progress.setAttribute("aria-live", "polite")
      msgList.appendChild(progress)
    }, 900)
    toolChainProgressTimers.set(sessionId, timer)
  }

  function clearToolChainProgress(sessionId: string): void {
    const timer = toolChainProgressTimers.get(sessionId)
    if (timer) timers.clearTimeout(timer)
    toolChainProgressTimers.delete(sessionId)
    getMessageList(sessionId)?.querySelectorAll(".tool-chain-progress").forEach((el) => el.remove())
  }

  function init() {
    try {
      setupModeToggle({
        els,
        getActiveSession: () => stateManager.getActiveSession(),
        setSessionMode: (id, mode) => stateManager.setSessionMode(id, mode),
        postMessage: (msg) => vscode.postMessage(msg),
        showAutoModeWarning,
      })
      setupInput()
      setupButtonsModule({
        els: {
          historyBtn: els.historyBtn,
          sessionModal: els.sessionModal,
          sessionModalBody: els.sessionModalBody,
          mcpBtn: els.mcpBtn,
          themeCustomizerBtn: els.themeCustomizerBtn,
          settingsBtn: els.settingsBtn,
          settingsMenu: els.settingsMenu,
          checkpointPanel: els.checkpointPanel,
          todosToggleBtn: els.todosToggleBtn,
          todosPanel: els.todosPanel,
          changedFilesList: els.changedFilesList,
          attachBtn: els.attachBtn,
          skillsBtn: els.skillsBtn,
        },
        postMessage: (msg) => vscode.postMessage(msg),
        closeSettingsMenu,
        openMcpConfig: () => mcpConfig.open(),
        openThemeCustomizer: () => openThemeCustomizer(themeDeps),
        getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
        skillsModalOpen: () => skillsModalApi?.open?.(),
      })
      
      setupSessionModal()
      setupContextUsagePanel()
      contextMonitorHandlers = setupContextMonitor(els, (msg) => vscode.postMessage(msg as Record<string, unknown>))
      setupPromptStash(els, (msg) => vscode.postMessage(msg as Record<string, unknown>))
      
      // Setup panels
      todosPanelApi = setupTodosPanel(els, {
        onToggleTodo: (todoId: string) => vscode.postMessage({ type: "toggle_todo", todoId }),
        onDeleteTodo: (todoId: string) => vscode.postMessage({ type: "delete_todo", todoId }),
        onOpenFile: (filePath: string) => vscode.postMessage({ type: "open_file", path: filePath }),
      })
      skillsModalApi = setupSkillsModal(els, {
        onToggleSkill: (skillId: string, enabled: boolean) => vscode.postMessage({ type: "toggle_skill", skillId, enabled }),
        onSearchSkills: (query: string) => vscode.postMessage({ type: "search_skills", query }),
      })
      subagentPanelApi = setupSubagentPanel(els, {
        onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
      })
      
      setupWelcomeSuggestions()
      setupWelcomeActions()
      setupMessageListener()
      setupPermissionListener()
      setupDiffActionListener()
      restoreQueues()
      setupTimelineToggle()
      setupThinkingToggle()
      const cleanupToolKeyboardNav = setupToolKeyboardNav()
      setupSettingsMenuKeyboardNav()
      updateSendButton()
      setVsCodeApi(vscode)
      setSessionListPostMessage((msg) => vscode.postMessage(msg as Record<string, unknown>))

      // Show welcome view by default — no session created until user sends a message
      showWelcomeView()

      // Let the extension be the source of truth - wait for init_state
      const initTimeout = timers.setTimeout(() => {
        // If we haven't received init_state after 3 seconds, just show welcome
        if (!stateManager.getState().activeSessionId) {
          log.warn("No init_state received, showing welcome view")
          showWelcomeView()
        }
      }, 3000)

      // Store timeout so we can clear it when init_state is received
      window.__opencodeInitTimeout = initTimeout
    } catch (err) {
      log.error("Initialization error:", err)
      const errorDiv = document.createElement("div")
      errorDiv.className = "error-boundary"
      errorDiv.textContent = "Failed to initialize. Please reload."
      document.body.appendChild(errorDiv)
    }
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
    },
    postMessage: (msg) => vscode.postMessage(msg),
    getAllSessions: () => stateManager.getAllSessions(),
    getState: () => {
      const s = stateManager.getState()
      return { ...s, activeSessionId: s.activeSessionId ?? undefined }
    },
    openModelManager: () => modelManager.open(),
    renderRecentSessionsList,
    hideStatusStrip,
    applyTimelineVisibility,
    autoResizeTextarea,
    updateSendButton,
  }

  function showWelcomeView() {
    showWelcomeViewModule(welcomeViewDeps)
  }

  function hideWelcomeView() {
    hideWelcomeViewModule(els)
  }

  function renderWelcomeContext() {
    renderWelcomeContextModule(welcomeViewDeps)
  }

  function setupWelcomeActions() {
    setupWelcomeActionsModule(welcomeViewDeps)

    const recentContainer = document.getElementById("welcome-recent-sessions")
    if (recentContainer) {
      recentContainer.addEventListener("recent-session-delete", ((e: CustomEvent) => {
        const sid = e.detail?.sessionId
        if (sid) {
          vscode.postMessage({ type: "delete_session", targetSessionId: sid })
        }
      }) as EventListener)
    }
  }

  /* ─── RECENT SESSIONS ─── */

  function renderRecentSessionsList(filterQuery: string = "") {
    // Defensive trim: this is called from many call sites (welcome init,
    // session list updates, etc.) — not all of them sanitize the query.
    const query = (filterQuery || "").trim().toLowerCase()
    const activeId = stateManager.getState().activeSessionId
    // Without a query: only show sessions that have visible messages (a clean
    // welcome page). With a query: also surface sessions whose backfill
    // hasn't landed yet, so the user can find them by name. Sessions match
    // by name only in that case (no message text yet to search).
    const allValidSessions = stateManager.getAllSessions()
      .filter((s) => s.id !== activeId && (s.messages.length > 0 || (!!query && !!s.name)))

    const recentContainer = document.getElementById("welcome-recent-sessions") as HTMLDivElement | null
    if (!recentContainer) return

    if (allValidSessions.length === 0) {
      recentContainer.style.display = "none"
      return
    }

    const matchesQuery = (s: typeof allValidSessions[number]): boolean => {
      if (!query) return true
      const name = (s.name || "").toLowerCase()
      if (name.includes(query)) return true
      for (const msg of s.messages) {
        for (const block of msg.blocks || []) {
          const text = (block as { type?: string; text?: string }).type === "text"
            ? (block as { text?: string }).text
            : undefined
          if (text && text.toLowerCase().includes(query)) return true
        }
      }
      return false
    }

    const filteredSessions = allValidSessions
      .filter(matchesQuery)
      .sort((a, b) => {
        const tA = a.messages[a.messages.length - 1]?.timestamp ?? 0
        const tB = b.messages[b.messages.length - 1]?.timestamp ?? 0
        return tB - tA
      })
      .map((s) => ({
        id: s.id,
        title: s.name,
        time: s.messages[s.messages.length - 1]?.timestamp,
        messageCount: s.messages.filter((m) => m.role === "user").length,
        cost: s.cost || 0,
      }))

    renderRecentSessions(
      filteredSessions,
      recentContainer,
      () => vscode.postMessage({ type: "list_sessions" }),
      (sessionId) => {
        vscode.postMessage({ type: "resume_session", sessionId })
      },
      !!query
    )
  }

  /* ─── SESSION HISTORY MODAL ─── */

  function setupSessionModal() {
    setupSessionModalModule({
      els,
      setUnifiedLocalSessions,
      setUnifiedServerSessions,
      renderUnifiedSessionList,
      postMessage: (msg) => vscode.postMessage(msg),
    })
  }

  function setupContextUsagePanel() {
    setContextUsagePanel(els.contextUsagePanel)
    setContextUsagePostMessage((msg) => vscode.postMessage(msg as Record<string, unknown>))
    setupContextUsagePanelInit()
    
    // Close button
    els.closeContextUsageBtn.addEventListener("click", () => {
      els.contextUsagePanel.classList.add("hidden")
    })
  }

  const sessionModalDeps = {
    els,
    setUnifiedLocalSessions,
    setUnifiedServerSessions,
    renderUnifiedSessionList,
    postMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
  }

  function openSessionModal(sessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }>, query = "") {
    openSessionModalModule(sessionModalDeps, sessions, query)
  }

  function closeSessionModal() {
    closeSessionModalModule(els)
  }

  /* ─── TAB MANAGEMENT ─── */

  function createNewTab(name?: string) {
    const session = stateManager.createSession(name)
    createTabUI(session.id, session.name)

    // Always switch to the newly created tab — it's the user's current focus
    stateManager.setActiveSession(session.id)
    switchToTab(els, session.id)
    hideWelcomeView()

    updateTabBar()
    renderRecentSessionsList()
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
      onToggleContextMonitor: () => contextMonitorHandlers?.toggle(),
      onSetContextWindowOverride: () => vscode.postMessage({ type: "open_context_window_override_dialog" }),
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
    vscode.postMessage({
      type: "create_tab",
      sessionId: tabId,
      name: session.name,
      model: session.model,
      mode: session.mode,
    })
  }

  function switchTab(tabId: string, notifyHost = true) {
    if (!stateManager.setActiveSession(tabId)) return
    switchToTab(els, tabId)
    hideWelcomeView()
    if (notifyHost) {
      vscode.postMessage({ type: "switch_tab", sessionId: tabId })
    }
    syncModeUI()
    updateTabBar()
    // Sync model dropdown to active session's model
    const activeSession = stateManager.getActiveSession()
    if (activeSession?.model) {
      modelDropdown.setCurrentModel(activeSession.model)
    }
    
    // Reset context usage panel to prevent stale data from bleeding into the new tab
    resetContextUsagePanel()
    
    // Refresh cost/token displays for the new tab — pull from the tab's
    // own stored usage so a previously-displayed tab's totals don't bleed in.
    updateCostDisplay(tabId)
    const session = stateManager.getSession(tabId)
    const displayed = selectDisplayedUsage(stateManager.getState().sessions, tabId)
    if (displayed) {
      updateTokenDisplay(displayed.usage)
      updateContextBarFromSession(tabId)
    } else {
      clearTokenDisplay()
    }
    // Refresh changed files list for the new tab, clearing stale chips when
    // the newly active session has no tracked edits.
    renderChangedFilesList(session?.changedFiles ?? [])
    
    // Scroll to bottom of active tab using anchor if available
    const anchor = scrollAnchors.get(tabId)
    if (anchor) {
      anchor.anchor()
    } else {
      const msgList = getActiveMessageList(els)
      if (msgList) scrollToBottom(msgList)
	  }
    
	  applyTimelineVisibility(tabId)
	  showSecondaryNav()
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

    // Dispose virtual list for this tab
    disposeVirtualList(tabId)

    // Remove jump-to-bottom for this tab
    const jtb = els.tabPanels.querySelector(`.jump-to-bottom[data-tab-id="${tabId}"]`)
    if (jtb) jtb.remove()
    const markers = els.tabPanels.querySelector(`.scroll-markers[data-tab-id="${tabId}"]`)
    if (markers) markers.remove()

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

    const stream = createStreamHandlers(streamEls, session.messages, () => {
      stateManager.save()
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
    currentMode = mode
  }

  function closeModeDropdownLocal() {
    closeModeDropdown(els)
  }

  function updateModeSelectorStateLocal() {
    updateModeSelectorState(els, () => stateManager.getActiveSession())
  }

  function syncModeUI() {
    syncModeUIModule(els, () => stateManager.getActiveSession())
    currentMode = getCurrentMode()
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

  function setMode(mode: string): void {
    const active = stateManager.getActiveSession()
    if (active) {
      stateManager.setSessionMode(active.id, mode)
    }
  }

  const modeWarningDeps = {
    els: {
      modeWarningTitle: els.modeWarningTitle,
      modeWarningDescription: els.modeWarningDescription,
      modeWarningModal: els.modeWarningModal,
      modeWarningCancel: els.modeWarningCancel,
      modeWarningConfirm: els.modeWarningConfirm,
      modeWarningDontShow: els.modeWarningDontShow,
    } as ModeWarningEls,
    postMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
    setMode,
  }
  setupModeWarningModule(modeWarningDeps)

  function showAutoModeWarning() {
    showAutoModeWarningModule(modeWarningDeps)
  }

  function closeModeWarning() {
    closeModeWarningModule(modeWarningDeps.els)
  }

  /* ─── INPUT ─── */

  function setupInput() {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keyup", updateSendButton)
    els.promptInput.addEventListener("change", updateSendButton)
    els.promptInput.addEventListener("compositionend", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    els.promptInput.addEventListener("paste", onPaste)
    els.sendBtn.addEventListener("click", sendMessage)
    els.mentionBtn.addEventListener("click", () => {
      els.promptInput.value += "@"
      els.promptInput.focus()
      mention.handleTrigger()
    })
    els.commandsPaletteBtn.addEventListener("click", () => {
      commandsModal.open()
      vscode.postMessage({ type: "list_commands" })
    })

    // Steering mode selector handlers
    const steerModeSelector = document.getElementById("steer-mode-selector") as HTMLElement
    const interruptBtn = document.getElementById("steer-mode-interrupt") as HTMLButtonElement
    const appendBtn = document.getElementById("steer-mode-append") as HTMLButtonElement
    const queueBtn = document.getElementById("steer-mode-queue") as HTMLButtonElement

    if (interruptBtn) {
      interruptBtn.addEventListener("click", () => setSteerMode("interrupt"))
    }
    if (appendBtn) {
      appendBtn.addEventListener("click", () => setSteerMode("append"))
    }
    if (queueBtn) {
      queueBtn.addEventListener("click", () => setSteerMode("queue"))
    }

    // Add keyboard shortcut hint
    els.sendBtn?.setAttribute("title", "Send (Ctrl+Enter)")

    window.addEventListener("oc-input-changed", () => {
      autoResizeTextarea()
      updateSendButton()
    })

    els.inputArea.addEventListener("dragover", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.add("drag-over")
    })
    els.inputArea.addEventListener("dragleave", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.remove("drag-over")
    })
    els.inputArea.addEventListener("drop", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.remove("drag-over")
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        const fileMentions: string[] = []
        const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
        for (const f of Array.from(files)) {
          if (allowedMimes.includes(f.type as typeof allowedMimes[number])) {
            attachmentManager.attachImageBlob(f)
          } else {
            const relPath = (f as { webkitRelativePath?: string }).webkitRelativePath || f.name
            fileMentions.push(`@file:${relPath}`)
          }
        }
        if (fileMentions.length > 0) insertTextAtCursor(fileMentions.join(" "))
      }
    })
  }

	  function onInputChange() {
	    autoResizeTextarea()
	    mention.handleTrigger()
	    updatePromptContextChips()
	    updateSendButton()
	  }

  function onInputKeydown(e: KeyboardEvent) {
    // Keyboard shortcuts for tabs
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "Enter") {
        e.preventDefault()
        const active = stateManager.getActiveSession()
        // When streaming, Ctrl+Enter sends as steer prompt
        if (active?.isStreaming) {
          sendSteerPrompt()
        } else {
          sendMessage()
        }
        // Visual feedback for shortcut
        els.sendBtn?.classList.add("active-feedback")
         timers.setTimeout(() => els.sendBtn?.classList.remove("active-feedback"), 200)
        return
      }
      if (e.key === "t") {
        e.preventDefault()
        createNewTab()
        return
      }
      if (e.key === "w") {
        e.preventDefault()
        const active = stateManager.getActiveSession()
        if (active) closeTab(active.id)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        const sessions = stateManager.getAllSessions()
        const activeId = stateManager.getState().activeSessionId
        if (sessions.length > 1 && activeId) {
          const idx = sessions.findIndex((s) => s.id === activeId)
          const nextIdx = e.shiftKey
            ? (idx - 1 + sessions.length) % sessions.length
            : (idx + 1) % sessions.length
          const nextSession = sessions[nextIdx]
          if (nextSession) switchTab(nextSession.id)
        }
        return
      }
      // Steering mode shortcuts (only when streaming)
      if (e.key === "1") {
        e.preventDefault()
        setSteerMode("interrupt")
        return
      }
      if (e.key === "2") {
        e.preventDefault()
        setSteerMode("append")
        return
      }
      if (e.key === "3") {
        e.preventDefault()
        setSteerMode("queue")
        return
      }
    }

    if (!els.mentionDropdown.classList.contains("hidden")) {
      mention.handleKeydown(e)
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const active = stateManager.getActiveSession()
      // When streaming, Enter sends as steer prompt
      if (active?.isStreaming) {
        sendSteerPrompt()
      } else {
        sendMessage()
      }
    }
  }

  function onPaste(e: ClipboardEvent) {
    attachmentManager.onPaste(e)
  }

  function updatePromptContextChips() {
    attachmentManager.updatePromptContextChips()
  }

  function renderAttachmentChips() {
    attachmentManager.renderAttachmentChips()
  }

  function autoResizeTextarea() {
    if (!els.promptInput) return
    const el = els.promptInput
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  function getSessionDisplayName(session: { name?: string; id?: string }): string {
    return session.name?.trim() || "Untitled session"
  }

  function getStreamCapacityState() {
    const streamingSessions = stateManager.getAllSessions().filter((s) => s.isStreaming)
    const activeStreams = streamingSessions.length
    const maxStreams = MAX_CONCURRENT_STREAMS
    const isFull = activeStreams >= maxStreams
    const streamingNames = streamingSessions
      .map((s) => `"${getSessionDisplayName(s)}"`)
      .join(", ")
    return {
      activeStreams,
      maxStreams,
      isFull,
      streamingNames,
      reason: isFull ? STREAM_LIMIT_TOOLTIP : "",
    }
  }

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0
    const hasAttachments = attachmentManager.getAttachments().length > 0
    const active = stateManager.getActiveSession()
    const isStreaming = active?.isStreaming || false
    const streamCapacity = getStreamCapacityState()
    const blockedByStreamLimit = !isStreaming && streamCapacity.isFull
    const canSubmit = isStreaming || ((hasText || hasAttachments) && !blockedByStreamLimit)
    // Button remains enabled during streaming so it can be used as a stop button
    ;(els.sendBtn as HTMLButtonElement).disabled = !canSubmit
    els.sendBtn?.classList.toggle("stream-limit-blocked", blockedByStreamLimit)
    updateSendButtonIcon(isStreaming, streamCapacity)
    updateModeSelectorStateLocal()
  }

  function updateSendButtonIcon(isStreaming?: boolean, streamCapacity = getStreamCapacityState()) {
    const active = stateManager.getActiveSession()
    const streaming = isStreaming ?? active?.isStreaming ?? false
    if (streaming) {
      els.sendBtn?.classList.add("stopping")
      els.sendBtn?.classList.remove("stream-limit-blocked")
      els.sendBtn?.setAttribute("aria-label", "Stop generation")
      els.sendBtn?.setAttribute("title", "Stop generation")
    } else if (streamCapacity.isFull) {
      els.sendBtn?.classList.remove("stopping")
      els.sendBtn?.classList.add("stream-limit-blocked")
      const limitLabel = streamCapacity.streamingNames
        ? `3 streams active (${streamCapacity.streamingNames}) — stop one to continue`
        : STREAM_LIMIT_TOOLTIP
      els.sendBtn?.setAttribute("aria-label", limitLabel)
      els.sendBtn?.setAttribute("title", limitLabel)
    } else {
      els.sendBtn?.classList.remove("stopping")
      els.sendBtn?.classList.remove("stream-limit-blocked")
      els.sendBtn?.setAttribute("aria-label", "Send message")
      els.sendBtn?.setAttribute("title", "Send (Ctrl+Enter)")
    }
  }

  function generateTitle(text: string): string {
    if (!text.trim()) return ""
    const firstSentence = text.split(/[.!?\n]/)[0] || text
    const trimmed = firstSentence.trim()
    if (trimmed.length === 0) return ""
    if (trimmed.length > 40) return trimmed.slice(0, 37).trimEnd() + "..."
    return trimmed
  }

  function isAutoSessionName(name?: string): boolean {
    const raw = (name || "").trim()
    return (
      !raw ||
      raw === "Default" ||
      raw === "New Chat" ||
      raw === "New Session" ||
      raw === "Untitled session" ||
      /^Session [A-Za-z0-9]{1,8}$/.test(raw) ||
      /^Session \d+$/.test(raw) ||
      /^New session\b/i.test(raw) ||
      /^Tab session\b/i.test(raw)
    )
  }

  function persistQueues() {
    const state = vscode.getState()
    if (!state) return
    const snapshot: Record<string, QueueItem[]> = {}
    for (const [sid, q] of promptQueues.entries()) {
      const items = q.persist().filter(i => i.state === "queued" || i.state === "failed")
      if (items.length > 0) snapshot[sid] = items
    }
    vscode.setState({ ...state, queues: snapshot })
  }

  function restoreQueues() {
    const state = vscode.getState() as { queues?: Record<string, QueueItem[]> } | null | undefined
    const snapshot = state?.queues
    if (!snapshot) return
    for (const [sid, items] of Object.entries(snapshot)) {
      if (!Array.isArray(items) || items.length === 0) continue
      const q = createPromptQueue()
      q.restore(items)
      promptQueues.set(sid, q)
    }
  }

  function renderQueue(tabId: string) {
    const queue = promptQueues.get(tabId)
    const container = els.inputArea.querySelector(".prompt-queue") as HTMLElement | null
    if (!queue || queue.getItems().length === 0) {
      if (container) container.remove()
      updateQueueSendButton()
      return
    }
    let queueContainer = container
    if (!queueContainer) {
      queueContainer = document.createElement("div")
      queueContainer.className = "prompt-queue"
      queueContainer.setAttribute("role", "list")
      queueContainer.setAttribute("aria-label", "Queued prompts (drag to reorder, Alt+Up/Down with focus)")
      els.inputArea.insertBefore(queueContainer, els.inputWrapper)
    }
    queueContainer.replaceChildren()
    const items = queue.getItems()
    const queuedCount = items.filter((i) => i.state === "queued").length
    const totalTokens = queue.getTotalEstimatedTokens()

    // Queue header — count, total estimated tokens, and clear-all
    const headerRow = document.createElement("div")
    headerRow.className = "queue-header"
    const countLabel = document.createElement("span")
    countLabel.className = "queue-count"
    countLabel.textContent = `${items.length} queued`
    headerRow.appendChild(countLabel)
    if (totalTokens > 0) {
      const tokenLabel = document.createElement("span")
      tokenLabel.className = "queue-tokens"
      tokenLabel.textContent = `~${formatTokenCount(totalTokens)} tokens`
      tokenLabel.title = `Estimated total token cost for all queued prompts (~${totalTokens})`
      headerRow.appendChild(tokenLabel)
    }
    if (queuedCount > 1) {
      const clearAllBtn = document.createElement("button")
      clearAllBtn.className = "queue-clear-all"
      clearAllBtn.textContent = "Clear all"
      clearAllBtn.setAttribute("aria-label", `Clear ${queuedCount} queued prompts`)
      clearAllBtn.addEventListener("click", () => {
        for (const item of items) {
          if (item.state === "queued") queue.remove(item.id)
        }
        persistQueues()
        renderQueue(tabId)
      })
      headerRow.appendChild(clearAllBtn)
    }
    queueContainer.appendChild(headerRow)

    for (const item of items) {
      const chip = document.createElement("div")
      chip.className = `queue-chip queue-chip--${item.state}`
      chip.dataset.queueId = item.id
      chip.setAttribute("role", "listitem")

      const isMovable = item.state === "queued" || item.state === "failed"
      if (isMovable) {
        chip.draggable = true
        chip.tabIndex = 0
        chip.setAttribute("aria-grabbed", "false")
        chip.setAttribute("aria-label",
          `Queued prompt ${item.position + 1} of ${items.length}: ${item.text.slice(0, 60)}`)

        // Drag handle — purely visual; whole chip is the drag source
        const handle = document.createElement("span")
        handle.className = "queue-chip-handle"
        handle.setAttribute("aria-hidden", "true")
        handle.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
        chip.appendChild(handle)
      }

      const text = document.createElement("span")
      text.className = "queue-chip-text"
      text.textContent = item.text.length > 40 ? item.text.slice(0, 40) + "…" : item.text
      text.title = item.text
      chip.appendChild(text)

      if (item.attachments && item.attachments.length > 0) {
        const attBadge = document.createElement("span")
        attBadge.className = "queue-chip-att"
        attBadge.textContent = `+${item.attachments.length}`
        attBadge.title = `${item.attachments.length} image attachment(s)`
        chip.appendChild(attBadge)
      }

      if ((item.estimatedTokens ?? 0) > 0 && item.state === "queued") {
        const tokBadge = document.createElement("span")
        tokBadge.className = "queue-chip-tokens"
        tokBadge.textContent = `~${formatTokenCount(item.estimatedTokens!)}`
        tokBadge.title = `~${item.estimatedTokens} estimated tokens`
        chip.appendChild(tokBadge)
      }

      const badge = document.createElement("span")
      badge.className = "queue-chip-state"
      const stateLabels: Record<string, string> = { queued: "Q", sending: "Sending", streaming: "Active", completed: "Done", failed: "Error" }
      badge.textContent = stateLabels[item.state] || item.state
      chip.appendChild(badge)

      if (item.state === "queued") {
        // Edit on click — make the text editable inline
        text.addEventListener("click", () => {
          const input = document.createElement("input")
          input.className = "queue-chip-input"
          input.type = "text"
          input.value = item.text
          input.setAttribute("aria-label", "Edit queued prompt")
          chip.replaceChild(input, text)
          input.focus()
          input.select()
          const save = () => {
            const newText = input.value.trim()
            if (newText) {
              queue.edit(item.id, newText)
              persistQueues()
              renderQueue(tabId)
            }
          }
          input.addEventListener("blur", save)
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); input.blur() }
            if (e.key === "Escape") { e.preventDefault(); renderQueue(tabId) }
          })
        })

        const removeBtn = document.createElement("button")
        removeBtn.className = "queue-chip-remove icon-btn"
        removeBtn.setAttribute("aria-label", "Remove queued prompt")
        removeBtn.innerHTML = REMOVE_SVG
        removeBtn.addEventListener("click", () => {
          queue.remove(item.id)
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(removeBtn)
      }

      if (item.state === "failed") {
        const retryBtn = document.createElement("button")
        retryBtn.className = "queue-chip-retry icon-btn"
        retryBtn.setAttribute("aria-label", "Retry failed prompt")
        retryBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
        retryBtn.addEventListener("click", () => {
          item.state = "queued"
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(retryBtn)

        const removeBtn2 = document.createElement("button")
        removeBtn2.className = "queue-chip-remove icon-btn"
        removeBtn2.setAttribute("aria-label", "Remove failed prompt")
        removeBtn2.innerHTML = REMOVE_SVG
        removeBtn2.addEventListener("click", () => {
          queue.remove(item.id)
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(removeBtn2)
      }

      if (isMovable) {
        wireChipReorderHandlers(chip, item.id, tabId, queue)
      }
      queueContainer.appendChild(chip)
    }
    updateQueueSendButton()
  }

  function formatTokenCount(n: number): string {
    return formatTokenCountModule(n)
  }

  /**
   * Wire drag-and-drop and keyboard reorder for a single queue chip.
   * Drag source = the whole chip (any pointer down anywhere reorders).
   * Drop target = each chip; uses `dragover` to compute insertion side
   *               (before/after the hovered chip based on cursor Y).
   * Keyboard: Alt+ArrowUp / Alt+ArrowDown with the chip focused.
   *           Alt+Home → moveToFront. Alt+End → moveToBack.
   * Edge cases: refuses moves the queue rejects (sending/streaming items);
   *             cleans up its visual state on dragend even if drop fired.
   */
  function wireChipReorderHandlers(
    chip: HTMLElement,
    itemId: string,
    tabId: string,
    queue: PromptQueue,
  ) {
    function indexOf(id: string): number {
      return queue.getItems().findIndex(i => i.id === id)
    }

    function clearAllDropMarkers() {
      const container = chip.parentElement
      if (!container) return
      for (const el of Array.from(container.querySelectorAll(".queue-chip"))) {
        el.classList.remove("queue-chip--drop-before", "queue-chip--drop-after")
      }
    }

    chip.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      dt.effectAllowed = "move"
      dt.setData("application/x-queue-item", itemId)
      // Some browsers will refuse the drag without ANY text/plain payload
      dt.setData("text/plain", itemId)
      chip.classList.add("queue-chip--dragging")
      chip.setAttribute("aria-grabbed", "true")
    })

    chip.addEventListener("dragend", () => {
      chip.classList.remove("queue-chip--dragging")
      chip.setAttribute("aria-grabbed", "false")
      clearAllDropMarkers()
    })

    chip.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      // Only respond to our own payload — don't hijack file drags etc.
      if (!Array.from(dt.types).includes("application/x-queue-item")) return
      e.preventDefault()
      dt.dropEffect = "move"
      clearAllDropMarkers()
      const rect = chip.getBoundingClientRect()
      const before = e.clientY < rect.top + rect.height / 2
      chip.classList.add(before ? "queue-chip--drop-before" : "queue-chip--drop-after")
    })

    chip.addEventListener("dragleave", () => {
      chip.classList.remove("queue-chip--drop-before", "queue-chip--drop-after")
    })

    chip.addEventListener("drop", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      const sourceId = dt.getData("application/x-queue-item")
      if (!sourceId || sourceId === itemId) { clearAllDropMarkers(); return }
      e.preventDefault()
      const fromIdx = indexOf(sourceId)
      let toIdx = indexOf(itemId)
      if (fromIdx === -1 || toIdx === -1) { clearAllDropMarkers(); return }
      const rect = chip.getBoundingClientRect()
      const before = e.clientY < rect.top + rect.height / 2
      // When dropping below the target chip, insert AFTER it
      if (!before && fromIdx > toIdx) toIdx += 0 // moving up to (toIdx+1) wouldn't happen — clamp instead
      if (!before && fromIdx < toIdx) toIdx -= 0 // already covers "insert after"
      // Recompute: when moving downward and dropping after, the array shift
      // from removing the source means the target index is unchanged. When
      // moving downward and dropping before, target stays. When moving upward
      // and dropping after, we want toIdx + 1; when upward dropping before, toIdx.
      let finalTo = toIdx
      if (fromIdx < toIdx && before) finalTo = toIdx - 1
      if (fromIdx > toIdx && !before) finalTo = toIdx + 1
      const ok = queue.reorder(fromIdx, finalTo)
      clearAllDropMarkers()
      if (ok) {
        persistQueues()
        renderQueue(tabId)
        // After re-render the chip node is gone; restore focus to the moved item
        requestAnimationFrame(() => {
          const newChip = document.querySelector(`.queue-chip[data-queue-id="${sourceId}"]`) as HTMLElement | null
          newChip?.focus()
        })
      }
    })

    chip.addEventListener("keydown", (e) => {
      if (!e.altKey) return
      let moved = false
      if (e.key === "ArrowUp") {
        const idx = indexOf(itemId)
        moved = idx > 0 && queue.reorder(idx, idx - 1)
      } else if (e.key === "ArrowDown") {
        const idx = indexOf(itemId)
        moved = idx >= 0 && queue.reorder(idx, idx + 1)
      } else if (e.key === "Home") {
        moved = queue.moveToFront(itemId)
      } else if (e.key === "End") {
        moved = queue.moveToBack(itemId)
      } else {
        return
      }
      e.preventDefault()
      if (moved) {
        persistQueues()
        renderQueue(tabId)
        requestAnimationFrame(() => {
          const newChip = document.querySelector(`.queue-chip[data-queue-id="${itemId}"]`) as HTMLElement | null
          newChip?.focus()
        })
      }
    })
  }

  function updateQueueSendButton() {
    const active = stateManager.getActiveSession()
    if (!active) return
    const queue = promptQueues.get(active.id)
    const qCount = queue ? queue.getItems().filter((i) => i.state === "queued").length : 0
    const hint = els.inputArea.querySelector(".queue-hint") as HTMLElement | null
    if (qCount > 0) {
      if (!hint) {
        const div = document.createElement("div")
        div.className = "queue-hint"
        els.inputArea.insertBefore(div, els.inputWrapper)
      }
      const hintEl = els.inputArea.querySelector(".queue-hint")!
      hintEl.textContent = `${qCount} queued — auto-sends when current response completes`
    } else {
      if (hint) hint.remove()
    }
  }

  function sendSteerPrompt() {
    const active = stateManager.getActiveSession()

    if (!active) return

    const text = els.promptInput.value.trim()
    if (!text && attachmentManager.getAttachments().length === 0) return

    // Send steer prompt message with current mode
    vscode.postMessage({
      type: "send_steer_prompt",
      sessionId: active.id,
      text,
      mode: currentSteerMode,
      attachments: attachmentManager.getAttachments(),
    })

    // Clear input and attachments
    els.promptInput.value = ""
    attachmentManager.clearAttachments()
    renderAttachmentChips()
    autoResizeTextarea()
    updateSendButton()
  }

  function sendMessage() {
    const text = els.promptInput.value.trim()
    let active = stateManager.getActiveSession()

    if (active?.isStreaming) {
      // When streaming and there's text, send as steer prompt
      if (text || attachmentManager.getAttachments().length > 0) {
        sendSteerPrompt()
      } else {
        // Send button acts as stop button when streaming and no text
        abortStream()
      }
      return
    }

    if (!text && attachmentManager.getAttachments().length === 0) return

    if (!active) {
      // Create a new session lazily; the first user message promotes the title.
      const title = generateTitle(text)
      active = createNewTab(title)
    }

    // Always hide welcome on send — the user has chosen to start chatting.
    // Without this, an active session restored from persisted webview state
    // (but filtered out of init_state for having 0 messages) would leave the
    // welcome screen covering the chat panel.
    hideWelcomeView()

    // Check concurrent streaming limit BEFORE mutating state
    const streamCapacity = getStreamCapacityState()
    if (streamCapacity.isFull) {
      updateSendButton()
      handleRequestError(active?.id,
        streamCapacity.streamingNames
          ? `${STREAM_LIMIT_TOOLTIP}. Currently streaming: ${streamCapacity.streamingNames}. Stop one to continue.`
          : `${STREAM_LIMIT_TOOLTIP}. Stop a streaming tab to free a slot.`
      )
      return
    }

    // Ensure tab UI exists for this session, and switch to it
    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${active.id}"]`)) {
      createTabUI(active.id, active.name)
      switchToTab(els, active.id)
      updateTabBar()
    } else if (stateManager.getState().activeSessionId !== active.id) {
      switchTab(active.id)
    }

    // Handle slash commands
    if (text.startsWith("/")) {
      const parts = text.split(/\s+/)
      const cmd = (parts[0] || "").toLowerCase()
      const commandArgs = parts.slice(1).join(" ")
      switch (cmd) {
        case "/clear":
          // Delegate to extension host — preserves session in history, creates new server session
          vscode.postMessage({ type: "execute_command", command: "/clear", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/model":
          if (commandArgs) {
            stateManager.setSessionModel(active.id, commandArgs)
            stateManager.setGlobalModel(commandArgs)
            modelDropdown.setCurrentModel(commandArgs)
            syncModelViews()
            vscode.postMessage({ type: "set_model", model: commandArgs, sessionId: active.id })
            els.promptInput.value = ""
            autoResizeTextarea()
            updateSendButton()
            return
          }
          vscode.postMessage({ type: "get_models" })
          modelDropdown.open()
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/cost": {
          // Delegate to extension host for server cost figures
          vscode.postMessage({ type: "execute_command", command: "/cost", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        }
        case "/new":
          createNewTab()
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/help":
          // Delegate to extension host — shows markdown table with commands
          vscode.postMessage({ type: "execute_command", command: "/help", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/export":
          vscode.postMessage({ type: "export_chat" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/export-md":
          vscode.postMessage({ type: "export_chat" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/export-json":
          vscode.postMessage({ type: "export_chat_json" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/export-text":
          vscode.postMessage({ type: "export_chat_text" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/copy":
          vscode.postMessage({ type: "copy_chat" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/stash": {
          // Usage: /stash <name> <content...>   OR   /stash (uses textarea below cmd as content)
          const stashName = (parts[1] && parts[1].trim()) ? parts[1] : "Untitled"
          const inlineContent = parts.slice(2).join(" ").trim()
          const stashContent = inlineContent || text.replace(/^\/stash(?:\s+\S+)?\s*/i, "").trim()
          if (!stashContent) {
            showSystemMessage(active.id, "Usage: /stash <name> <content>")
          } else {
            vscode.postMessage({ type: "stash_prompt", name: stashName, content: stashContent, isGlobal: true })
          }
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        }
        case "/stashes":
          vscode.postMessage({ type: "list_stashes" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/compact":
          vscode.postMessage({ type: "compact_session", sessionId: active.id })
          showSystemMessage(active.id, "Compacting session...")
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/commands":
          // Open immediately so the user always sees built-in commands even if the server is offline.
          commandsModal.open()
          // Then request fresh server commands; the command_list handler will refresh the modal list.
          vscode.postMessage({ type: "list_commands" })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/queue":
          renderQueue(active.id)
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/continue":
          // Delegate to extension host — resumes most recently closed session
          vscode.postMessage({ type: "execute_command", command: "/continue", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        default: {
          // Custom prompts and OpenCode server commands are discovered at runtime,
          // so the host is the source of truth for non-local slash commands.
          vscode.postMessage({ type: "execute_command", command: cmd, arguments: commandArgs, sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        }
      }
    }

    const attachments = attachmentManager.getAttachments()
    const sendModel = active.model || modelDropdown.getCurrentModel() || stateManager.getState().globalModel
    if (!sendModel) {
      updateSendButton()
      handleRequestError(active.id, "No model selected. Please select a model to continue.")
      return
    }

    // Post slash-commands: not a slash command, proceed with normal send
    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()

    const msgObj: ChatMessage = {
      role: "user",
      id: createWebviewId("user"),
      blocks: [
        ...(text ? [{ type: "text", text }] : []),
        ...attachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
      ],
      timestamp: Date.now(),
      sessionId: active.id,
    }

    attachmentManager.clearAttachments()
    renderAttachmentChips()

    addMessage(active.id, msgObj)
    stateManager.setStreaming(active.id, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateSendButton()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId: active.id,
      messageId: msgObj.id,
      model: sendModel,
      mode: active.mode,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
  }

  function abortStream() {
    const active = stateManager.getActiveSession()
    if (!active) return

    stateManager.setStreaming(active.id, false)
    updateTabBar()
    updateModeSelectorStateLocal()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.hideTypingIndicator()

    updateSendButtonIcon(false)
    updateSendButton()

    vscode.postMessage({ type: "abort", sessionId: active.id })
  }


  const settingsMenuDeps: SettingsMenuDeps = {
    els: {
      settingsBtn: els.settingsBtn,
      settingsMenu: els.settingsMenu,
      modelManagerPanel: els.modelManagerPanel,
      themeCustomizerPanel: els.themeCustomizerPanel,
      modeWarningModal: els.modeWarningModal,
      mcpConfigPanel: els.mcpConfigPanel,
      sessionModal: els.sessionModal,
    },
    closeModelManager: () => modelManager.close(),
    closeThemeCustomizer,
    closeModeWarning: () => closeModeWarning(),
    closeMcpConfig: () => mcpConfig.close(),
    closeSessionModal: () => closeSessionModal(),
  }

  function closeSettingsMenu() {
    closeSettingsMenuModule(els)
  }

  function closeCurrentModal() {
    closeCurrentModalModule(settingsMenuDeps)
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
    trapFocus: (container: HTMLElement) => trapModalFocus(container),
  }
  setupThemeCustomizer(themeDeps)

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
    if (!text.trim()) return ""
    const firstSentence = text.split(/[.!?\n]/)[0] || text
    const trimmed = firstSentence.trim()
    if (trimmed.length === 0) return ""
    if (trimmed.length > 40) return trimmed.slice(0, 37).trimEnd() + "..."
    return trimmed
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
    const session = stateManager.getSession(sessionId)
    const msgList = getMessageList(sessionId)
    if (!session || !msgList || session.isStreaming || session.messages.length <= 140) return
    if (msgList.dataset.historyCondensed === "true") return

    const preserveLast = 80
    const groupSize = 20
    const candidates = session.messages.slice(0, Math.max(0, session.messages.length - preserveLast))
    for (let i = Math.floor(Math.max(0, candidates.length - 1) / groupSize) * groupSize; i >= 0; i -= groupSize) {
      const group = candidates.slice(i, Math.min(candidates.length, i + groupSize))
      const elements = group
        .map((m) => m.id ? msgList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(m.id)}"]`) : null)
        .filter((el): el is HTMLElement => Boolean(el && !el.matches(":focus-within") && !el.querySelector(".streaming-text")))
      if (elements.length < groupSize / 2) continue

      const summary = document.createElement("button")
      summary.type = "button"
      summary.className = "history-condensed-summary"
      const userCount = group.filter((m) => m.role === "user").length
      const assistantCount = group.filter((m) => m.role === "assistant").length
      const toolCount = group.reduce((count, m) => count + (m.blocks || []).filter((b) => b.type === "tool-call" || b.type === "tool_call" || b.type === "tool").length, 0)
      summary.textContent = `${group.length} earlier messages: ${userCount} user, ${assistantCount} assistant${toolCount ? `, ${toolCount} tools` : ""}`
      summary.setAttribute("aria-expanded", "false")

      const fragment = document.createDocumentFragment()
      for (const el of elements) fragment.appendChild(el)
      summary.addEventListener("click", () => {
        summary.setAttribute("aria-expanded", "true")
        summary.replaceWith(fragment)
        msgList.dataset.historyCondensed = "expanded"
        debouncedUpdateScrollMarkers(sessionId)
      }, { once: true })

      const firstRemaining = msgList.firstElementChild
      if (firstRemaining) msgList.insertBefore(summary, firstRemaining)
      else msgList.appendChild(summary)
    }
    msgList.dataset.historyCondensed = "true"
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

    session.messages.push(msg)

    // Auto-generate title from first user message
    if (msg.role === "user" && isAutoSessionName(session.name)) {
      const generated = generateTitleFromBlocks(msg.blocks)
      if (generated) {
        session.name = generated
        stateManager.renameSession(sessionId, generated)
        vscode.postMessage({ type: "rename_session", sessionId, name: generated })
        updateTabBar()
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
        if ((window as any).__opencodeDebug) {
          console.debug(`[perf] renderMessage took ${elapsed}ms for ${msg.role} msg ${msg.id?.slice(0, 16)}`)
        }
      }
      msgList.appendChild(el)
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
      ["stream_start", (_msg, sid) => {
        if (!sid) return
        handleStreamStart(sid, _msg.messageId as string)
        const resumed = _msg.resumed as { existingText?: string; messageId?: string } | undefined
        if (resumed?.existingText) {
          const stream = streamHandlers.get(sid)
          stream?.forceRerender(resumed.existingText)
        }
      }],
      ["stream_chunk", (_msg, sid) => { if (sid) handleStreamChunk(sid, _msg.text as string, _msg.messageId as string | undefined) }],
      ["stream_end", (_msg, sid) => { if (sid) handleStreamEnd(sid, _msg.messageId as string, _msg.blocks, _msg.reason as string | undefined, Boolean(_msg.partial)) }],
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
      ["session_list", (msg) => {
        const sessions = (msg.sessions || []) as SessionSummary[]
        const isWelcomeVisible = !els.welcomeView.classList.contains("hidden")
        if (isWelcomeVisible && !els.sessionModal.classList.contains("hidden")) {
          openSessionModal(sessions, typeof msg.query === "string" ? msg.query : "")
        } else if (isWelcomeVisible) {
          renderRecentSessionsList(typeof msg.query === "string" ? msg.query : "")
        } else {
          openSessionModal(sessions, typeof msg.query === "string" ? msg.query : "")
        }
      }],
      ["session_list_update", (msg) => {
        const sessions = (msg.sessions || []) as SessionSummary[]
        setUnifiedLocalSessions(sessions)
        if (!els.sessionModal.classList.contains("hidden")) {
          vscode.postMessage({ type: "list_server_sessions" })
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
            msgList.replaceChildren()

            const beforeIndex = typeof msg.initialBeforeIndex === "number" ? msg.initialBeforeIndex : 0
            sessionBeforeIndex.set(session.id, beforeIndex)

            if (beforeIndex > 0) {
              const banner = createLoadEarlierBanner(beforeIndex, () => {
                const idx = sessionBeforeIndex.get(session.id) ?? 0
                if (idx <= 0) return
                vscode.postMessage({ type: "request_more_messages", sessionId: session.id, beforeIndex: idx, limit: 50 })
              })
              banner.dataset.sessionId = session.id
              msgList.appendChild(banner)
            }

            const renderOpts = { mode: session.mode, sessionId: session.id, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }
            const loader = createChunkedLoader({
              container: msgList,
              messages: session.messages,
              renderFn: (m) => {
                const index = session.messages.indexOf(m)
                const isConsecutive = index > 0 && session.messages[index - 1]?.role === m.role
                return renderMessage(m, { ...renderOpts, turnIndex: index }, isConsecutive)
              },
              onChunkDone: (rendered, total) => {
                if (rendered === Math.min(total, 20)) {
                  const anchor = scrollAnchors.get(session.id)
                  if (anchor) anchor.anchor()
                  else scrollToBottom(msgList)
                }
              },
              onAllDone: () => {
                applyHistoryCondensation(session.id)
                setupJumpToBottom(session.id)
                debouncedUpdateScrollMarkers(session.id)
                refreshConversationTimeline(session.id)
              },
            })
            loader.start()

            if (!scrollAnchors.get(session.id)) {
              const typingInd = msgList.parentElement?.querySelector(".typing-indicator") as HTMLElement | undefined
              const anchor = createScrollAnchor(msgList, typingInd)
              scrollAnchors.set(session.id, anchor)
            }

            const vl = createVirtualList(
              session.id,
              msgList,
              (id: string) => session.messages.find((m: ChatMessage) => m.id === id),
              () => stateManager.getSession(session.id),
              (m: ChatMessage, opts: any) => renderMessage(m, opts),
            )
            vl.start()
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
        if (!sid || !moreMsgs || moreMsgs.length === 0) return

        const msgList = getMessageList(sid)
        if (!msgList) return

        const session = stateManager.getSession(sid)
        const renderOpts = { mode: session?.mode ?? "build", sessionId: sid, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }

        const elements = moreMsgs.map((m, index) => {
          const isConsecutive = index > 0 && moreMsgs[index - 1]?.role === m.role
          return renderMessage(m, { ...renderOpts, turnIndex: session?.messages.indexOf(m) }, isConsecutive)
        })

        const oldBanner = msgList.querySelector<HTMLElement>(".load-earlier-banner")
        if (oldBanner) oldBanner.remove()

        prependMessagesPreservingScroll(msgList, elements)

        const newBeforeIndex = typeof msg.newBeforeIndex === "number" ? msg.newBeforeIndex : 0
        sessionBeforeIndex.set(sid, newBeforeIndex)

        if (newBeforeIndex > 0) {
          const banner = createLoadEarlierBanner(newBeforeIndex, () => {
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
        const renderOpts = { mode: session?.mode ?? "build", sessionId: sid, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }
        for (const m of refreshedMsgs) {
          const el = renderMessage(m, { ...renderOpts, turnIndex: refreshedMsgs.indexOf(m) }, false)
          msgList.appendChild(el)
        }
        sessionBeforeIndex.set(sid, refreshedMsgs.length)
        debouncedUpdateScrollMarkers(sid)
      }],
      ["context_usage", (msg) => {
        const activeId = stateManager.getState().activeSessionId
        const tabPanel = activeId ? els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${CSS.escape(activeId)}"] .context-monitor`) : null
        if (tabPanel) updateContextUsage(tabPanel, { percent: msg.percent as number, tokens: msg.tokens as number, maxTokens: msg.maxTokens as number })
        handleContextUsageMessage(msg as unknown as Record<string, unknown>)
      }],
      ["usage_history", (msg) => { handleContextUsageMessage(msg as unknown as Record<string, unknown>) }],
      ["usage_statistics", (msg) => { handleContextUsageMessage(msg as unknown as Record<string, unknown>) }],
      ["server_status", (msg, sid) => { if (sid) handleServerStatus(sid, msg.status as string, msg.errorContext) }],
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
        if (sid) {
          stateManager.setStreaming(sid, Boolean(msg.isStreaming))
          
          // Show/hide steering mode selector based on streaming state
          const steerModeSelector = document.getElementById("steer-mode-selector") as HTMLElement
          if (steerModeSelector) {
            if (msg.isStreaming) {
              steerModeSelector.classList.remove("hidden")
            } else {
              steerModeSelector.classList.add("hidden")
            }
          }

          // Update placeholder text based on streaming state
          if (msg.isStreaming) {
            els.promptInput.placeholder = "Guide the AI: correct errors, change direction, or add context…"
          } else {
            els.promptInput.placeholder = "Ask OpenCode a question about your code…"
          }

          // Remove steering mode classes from input area when not streaming
          if (!msg.isStreaming) {
            els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
          }
          
          if (!msg.isStreaming) {
            const sess = stateManager.getSession(sid)
            if (sess) {
              sess.changedFiles = []
              stateManager.save()
            }
            if (sid === stateManager.getState().activeSessionId) {
              renderChangedFilesList([])
            }
          }
          updateTabBar()
          updateSendButton()
        }
      }],
      ["active_session_changed", (_msg, sid) => {
        if (!sid || !stateManager.getSession(sid)) return
        switchTab(sid, false)
      }],
      ["stream_tool_start", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }
            toolElapsedTracker.registerStart(toolCall.id)
            stream.handleToolStart(toolCall)
            markToolChainProgress(sid)
          }
        }
      }],
      ["stream_tool_update", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; state?: ToolCallState; args?: unknown }
            if (toolCall.id) {
              scheduleToolUpdate(sid, toolCall.id, {
                state: toolCall.state,
                args: toolCall.args,
              })
            }
          }
        }
      }],
      ["stream_tool_end", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const result = msg.result as { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }
            flushToolUpdate(sid, result.id)
            toolElapsedTracker.unregisterEnd(result.id, result.durationMs)
            stream.handleToolEnd(result.id, result)
            clearToolChainProgress(sid)
          }
        }
      }],
      ["add_to_queue", (msg, sid) => {
        if (!sid) return
        const text = msg.text as string || ""
        const attachments = msg.attachments as Array<{ data: string; mimeType: string }> || []
        const isSteerPrompt = msg.isSteerPrompt as boolean || false
        
        // Get the queue for this session
        const queue = promptQueues.get(sid)
        if (!queue) return
        
        // Add to queue
        const queueItem = queue.enqueue(text, attachments)
        if (queueItem && isSteerPrompt) {
          queue.markAsSteer(queueItem.id)
        }
        persistQueues()
        // Render queue UI
        renderQueue(sid)
      }],
      ["permission_request", (_msg, sid) => {
        if (sid) {
          addMessage(sid, {
            role: "system",
            id: createWebviewId("perm"),
            blocks: [{
              type: "permission",
              permissionId: String(_msg.permissionId || ""),
              text: typeof _msg.title === "string" ? _msg.title : "Allow OpenCode to perform this action?",
            }],
            timestamp: Date.now(),
            sessionId: sid,
          })
        }
      }],
      ["file_edited", (msg, sid) => {
        const filePath = typeof msg.file === "string" ? msg.file : undefined
        if (sid && filePath) {
          const session = stateManager.getSession(sid)
          if (session) {
            if (!session.changedFiles) session.changedFiles = []
            if (!session.changedFiles.includes(filePath)) {
              session.changedFiles.push(filePath)
              stateManager.save()
            }
            if (sid === stateManager.getState().activeSessionId) {
              renderChangedFilesList(session.changedFiles)
            }
          }
          fileEditBatcher.add(sid, filePath)
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
      ["rate_limit_state", (msg) => { handleRateLimitState(msg.state as RateLimitWebviewState | null | undefined) }],
      ["model_update", (msg) => {
        modelDropdown.setCurrentModel(msg.model as string)
        if (msg.model) {
          stateManager.setGlobalModel(msg.model as string)
          const active = stateManager.getActiveSession()
          if (active) stateManager.setSessionModel(active.id, msg.model as string)
          syncModelViews()
          const modelParts = (msg.model as string).split("/")
          els.statusModel.textContent = modelParts[modelParts.length - 1] ?? (msg.model as string)
          renderWelcomeContext()
        }
      }],
      ["variant_update", (msg) => {
        variantSelector.setVariant(msg.variant as string)
        if (msg.variant) {
          stateManager.setGlobalVariant(msg.variant as string)
          const active = stateManager.getActiveSession()
          if (active) stateManager.setSessionVariant(active.id, msg.variant as string)
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
        }
      }],
      ["init_state", (msg) => {
        if (window.__opencodeInitTimeout) {
          timers.clearTimeout(window.__opencodeInitTimeout)
          window.__opencodeInitTimeout = undefined
        }
        if (!stateManager.getState().initialized) {
          stateManager.setInitialized()
        }

        vscode.postMessage({ type: "get_models" })

        if (msg.workspaceName) {
          els.welcomeWorkspaceName.textContent = msg.workspaceName as string
        }

        const sessions = (msg.sessions || []) as import("./types").SessionState[]
        stateManager.loadSessions(sessions, msg.activeSessionId as string | null, msg.globalModel as string)

        if (msg.globalModel) {
          modelDropdown.setCurrentModel(msg.globalModel as string)
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
              msgList.replaceChildren()
              const renderOpts = {
                mode: s.mode,
                sessionId: s.id,
                postMessage: (m: Record<string, unknown>) => vscode.postMessage(m),
              }
              const loader = createChunkedLoader({
                container: msgList,
                messages: s.messages,
                renderFn: (m) => {
                  const index = s.messages.indexOf(m)
                  const isConsecutive = index > 0 && s.messages[index - 1]?.role === m.role
                  return renderMessage(m, { ...renderOpts, turnIndex: index }, isConsecutive)
                },
                onChunkDone: (rendered, total) => {
                  if (rendered === Math.min(total, 20)) {
                    const anchor = scrollAnchors.get(s.id)
                    if (anchor) anchor.anchor()
                    else scrollToBottom(msgList)
                  }
                },
                onAllDone: () => {
                  applyHistoryCondensation(s.id)
                  setupJumpToBottom(s.id)
                  debouncedUpdateScrollMarkers(s.id)
                  refreshConversationTimeline(s.id)
                },
              })
              loader.start()

              if (!scrollAnchors.get(s.id)) {
                const typingInd = msgList.parentElement?.querySelector(".typing-indicator") as HTMLElement | undefined
                const anchor = createScrollAnchor(msgList, typingInd)
                scrollAnchors.set(s.id, anchor)
              }

              if (!getVirtualList(s.id)) {
                const vl = createVirtualList(
                  s.id,
                  msgList,
                  (id: string) => s.messages.find((m: ChatMessage) => m.id === id),
                  () => stateManager.getSession(s.id),
                  (m: ChatMessage, opts: any) => renderMessage(m, opts),
                )
                vl.start()
              }
            }
          })
          syncModeUI()
          updateTabBar()
        }

        // Decide what to display:
        // 1. If init_state's active session is known → switch + hide welcome
        // 2. Else if our merged state has an active session → switch to it
        // 3. Else if we have ANY session → switch to the first one
        // 4. Otherwise → show welcome
        const stateActive = stateManager.getState().activeSessionId
        const targetActive =
          (msg.activeSessionId && stateManager.getSession(msg.activeSessionId as string)) ? msg.activeSessionId as string :
          (stateActive && stateManager.getSession(stateActive)) ? stateActive :
          (allSessions.length > 0 ? allSessions[0]!.id : null)

        if (targetActive) {
          switchTab(targetActive, false)
        } else {
          showWelcomeView()
        }

        vscode.postMessage({ type: "init_ack" })
      }],
      ["rate_limit_exhausted", (msg) => { handleRateLimitExhausted(els, msg.resetAt as string) }],
      ["prompt_rejected", (_msg, sid) => {
        if (sid) {
          stateManager.setStreaming(sid, false)
          updateTabBar()
          updateSendButton()
          const stream = streamHandlers.get(sid)
          if (stream) stream.hideTypingIndicator()
          if (sid === stateManager.getState().activeSessionId) {
            updateSendButtonIcon(false)
          }
        }
      }],
      ["webview_request_error", (msg, sid) => {
        handleRequestError(sid, typeof msg.error === "string" ? msg.error : undefined)
      }],
      ["request_error", (msg, sid) => { handleRequestError(sid, typeof msg.message === "string" ? msg.message : undefined) }],
      ["diff_result", (msg) => {
        handleDiffResult(msg.blockId as string, msg.ok as boolean, typeof msg.message === "string" ? msg.message : undefined, Boolean(msg.checkpointCreated))
      }],
      ["cost_update", (msg) => {
        const cost = msg.cost
        if (isValidSessionId(msg.sessionId as string) && typeof cost === "number" && Number.isFinite(cost)) {
          handleCostUpdate(msg.sessionId as string, cost)
          updateCostDisplay(msg.sessionId as string)
        }
      }],
      ["token_usage", (msg, sid) => {
        if (isValidSessionId(sid) && msg.usage) {
          const usage = msg.usage as UsageDelta
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
      ["checkpoint_list", (msg) => {
        if (msg.checkpoints) {
          renderCheckpointPanel(msg.checkpoints as Array<{ id: string; sessionId: string; messageId?: string; filesChanged?: string[] }>)
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

          disposeVirtualList(msg.sessionId)
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
        const commands = (msg.commands || []) as Array<{ name: string; description?: string; template: string }>
        mention.updateServerCommands(commands)
        commandsModal.updateServerCommands(commands)
        if (msg.showInChat !== true) return
        // /commands now opens a real modal instead of dumping into chat history.
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
      ["open_commands_palette", () => commandsModal.open()],
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
        if (todosPanelApi && todosPanelApi.renderTodos) {
          todosPanelApi.renderTodos(msg.todos || [])
        }
      }],
      ["changed_files_update", (msg) => {
        const files = Array.isArray(msg.files) ? msg.files : []
        const paths = files
          .map((file) => typeof file === "string" ? file : (file && typeof file === "object" && "path" in file ? String((file as { path?: unknown }).path || "") : ""))
          .filter((path) => path.length > 0)
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : stateManager.getState().activeSessionId
        const activeSid = stateManager.getState().activeSessionId
        if (sid) {
          handleChangedFiles(sid, paths)
        }
        if (sid && sid === activeSid && todosPanelApi && todosPanelApi.renderChangedFiles) {
          todosPanelApi.renderChangedFiles(files as any)
        }
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
        if (subagentPanelApi && subagentPanelApi.renderActivities) {
          subagentPanelApi.renderActivities(msg.activities || [])
        }
      }],
      ["push_all_state", () => {
        requestStateSyncDebounced()
      }],
      ["push_visible_state", () => {
        requestStateSyncDebounced()
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

    window.addEventListener("focus", () => {
      requestStateSyncDebounced()
    })
  }

  /* ─── TURN NAVIGATION ─── */
  // #turn-nav (prev/next/select) removed — the conversation timeline sidebar
  // is the single navigation aid. scrollToTurn is still used by the timeline.
  function scrollMessageToTop(msgList: HTMLElement, target: HTMLElement) {
    scrollMessageToTopModule(msgList, target)
  }

  function scrollToTurn(messageId: string) {
    scrollToTurnModule(scrollMarkerDeps, messageId)
  }

  /* ─── CONVERSATION TIMELINE ─── */

	  function setupTimelineToggle() {
	    els.timelineToggleBtn.setAttribute("aria-pressed", String(stateManager.isTimelineVisible()))
	    els.timelineToggleBtn.addEventListener("click", () => {
	      const visible = !stateManager.isTimelineVisible()
	      stateManager.setTimelineVisible(visible)
	      applyTimelineVisibility()
	    })
	    applyTimelineVisibility()
	  }

	  function setupThinkingToggle() {
	    const state = stateManager.getState()
	    const thinkingVisible = state.displayPrefs?.thinkingVisible ?? true
	    // Seed the renderer-facing cache so blocks rendered during boot honor
	    // the persisted pref before the user touches the toggle.
	    setThinkingVisible(thinkingVisible)
	    // Apply the pref to any already-rendered blocks AND set the body class
	    // so future renders are hidden via CSS. Without this boot call, a user
	    // who unchecked the toggle in a previous session reopens the panel
	    // and sees thinking blocks until they click the toggle twice.
	    toggleAllThinkingBlocks(thinkingVisible)
	    els.thinkingToggleMenuItem.setAttribute("aria-checked", String(thinkingVisible))
	    els.thinkingToggleMenuItem.classList.toggle("active", thinkingVisible)
	    if (els.thinkingCheckmark) {
	      els.thinkingCheckmark.style.visibility = thinkingVisible ? "visible" : "hidden"
	    }

	    els.thinkingToggleMenuItem.addEventListener("click", () => {
	      // Read from the displayPrefs cache rather than stateManager: the
	      // stateManager's in-memory state is not mutated by vscode.setState,
	      // so reading from there would return stale values after the first
	      // click and the toggle would appear stuck. The cache is updated on
	      // every click below, so it is the only authoritative source here.
	      const newVisible = !getThinkingVisible()
	      const currentState = stateManager.getState()
	      const updatedState: WebviewState = {
	        ...currentState,
	        displayPrefs: {
	          text: currentState.displayPrefs?.text ?? true,
	          tools: currentState.displayPrefs?.tools ?? true,
	          diffs: currentState.displayPrefs?.diffs ?? true,
	          errors: currentState.displayPrefs?.errors ?? true,
	          diffWrapEnabled: currentState.displayPrefs?.diffWrapEnabled ?? false,
	          thinkingVisible: newVisible,
	        },
	      }
	      // Mutate in-memory state so future reads (e.g. on session save) see
	      // the new pref, then persist via the webview state API.
	      currentState.displayPrefs = updatedState.displayPrefs
	      vscode.setState(updatedState)
	      setThinkingVisible(newVisible)
	      els.thinkingToggleMenuItem.setAttribute("aria-checked", String(newVisible))
	      els.thinkingToggleMenuItem.classList.toggle("active", newVisible)
	      if (els.thinkingCheckmark) {
	        els.thinkingCheckmark.style.visibility = newVisible ? "visible" : "hidden"
	      }
	      toggleAllThinkingBlocks(newVisible)
	    })

	    // Keyboard shortcut: Ctrl/Cmd+Shift+T (avoiding Ctrl+T which is VS Code New Terminal)
	    document.addEventListener("keydown", (e) => {
	      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
	        e.preventDefault()
	        els.thinkingToggleMenuItem.click()
	      }
	    })
	  }

	  function applyTimelineVisibility(sessionId?: string) {
	    const targetId = sessionId || stateManager.getState().activeSessionId || undefined
	    const welcomeVisible = !els.welcomeView.classList.contains("hidden")
	    const visible = stateManager.isTimelineVisible() && !welcomeVisible

	    els.timelineToggleBtn.classList.toggle("active", visible)
	    els.timelineToggleBtn.setAttribute("aria-pressed", String(visible))
	    els.timelineToggleBtn.classList.toggle("hidden", welcomeVisible)

	    document.querySelectorAll(".message-list.timeline-visible").forEach((el) => el.classList.remove("timeline-visible"))
	    document.querySelectorAll(".conversation-timeline.visible").forEach((el) => el.classList.remove("visible"))

	    if (!visible || !targetId) return
	    refreshConversationTimeline(targetId)
	  }

	  function refreshConversationTimeline(sessionId?: string) {
	    const targetId = sessionId || stateManager.getState().activeSessionId || undefined
	    if (!targetId || !stateManager.isTimelineVisible()) return

	    const session = stateManager.getSession(targetId)
	    const msgList = getMessageList(targetId)
	    const timeline = ensureTimeline(targetId)
	    if (!session || !msgList || !timeline) return

	    const turns = groupMessagesIntoTurns(session.messages)
	    timeline.replaceChildren()
	    msgList.classList.toggle("timeline-visible", turns.length > 0)
	    timeline.classList.toggle("visible", turns.length > 0)
	    if (turns.length === 0) return

	    const progress = document.createElement("div")
	    progress.className = "timeline-progress"
	    timeline.appendChild(progress)

	    const header = document.createElement("div")
	    header.className = "timeline-header"
	    header.textContent = "Conversation Timeline"
	    timeline.appendChild(header)

	    turns.forEach((turn, index) => {
	      const item = document.createElement("button")
	      item.type = "button"
	      item.className = "timeline-item"
	      item.dataset.messageId = turn.userMessageId
	      item.setAttribute("aria-label", `Jump to turn ${index + 1}: ${turn.snippet}`)

	      const role = document.createElement("span")
	      role.className = "timeline-item-role"
	      const dot = document.createElement("span")
	      dot.className = "role-dot user"
	      role.appendChild(dot)
	      const label = document.createElement("span")
	      label.textContent = `Turn ${index + 1}`
	      role.appendChild(label)
	      item.appendChild(role)

	      const preview = document.createElement("span")
	      preview.className = "timeline-item-preview" + (turn.toolCount > 0 ? " has-tool" : "")
	      preview.textContent = turn.toolCount > 0 ? `${turn.snippet} (${turn.toolCount} tools)` : turn.snippet
	      item.appendChild(preview)

	      item.addEventListener("click", () => {
	        scrollToTurn(turn.userMessageId)
	        updateTimelineProgress(targetId)
	      })
	      timeline.appendChild(item)
	    })

	    if (!timeline.dataset.keyListener) {
	      timeline.dataset.keyListener = "true"
	      timeline.addEventListener("keydown", (e) => {
	        const items = Array.from(timeline!.querySelectorAll<HTMLElement>(".timeline-item"))
	        if (items.length === 0) return
	        const focused = timeline!.querySelector<HTMLElement>(".timeline-item:focus")
	        const idx = focused ? items.indexOf(focused) : -1
	        if (e.key === "ArrowDown") {
	          e.preventDefault()
	          items[Math.min(idx + 1, items.length - 1)]?.focus()
	        } else if (e.key === "ArrowUp") {
	          e.preventDefault()
	          items[Math.max(idx - 1, 0)]?.focus()
	        } else if (e.key === "Home") {
	          e.preventDefault()
	          items[0]?.focus()
	        } else if (e.key === "End") {
	          e.preventDefault()
	          items[items.length - 1]?.focus()
	        }
	      })
	    }

	    if (!msgList.dataset.timelineListener) {
	      msgList.dataset.timelineListener = "true"
	      msgList.addEventListener("scroll", () => updateTimelineProgress(targetId), { passive: true })
	    }
	    updateTimelineProgress(targetId)
	  }

	  function ensureTimeline(sessionId: string): HTMLElement | null {
	    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)
	    if (!view) return null
	    let timeline = view.querySelector<HTMLElement>(".conversation-timeline")
	    if (!timeline) {
	      timeline = document.createElement("aside")
	      timeline.className = "conversation-timeline"
	      timeline.setAttribute("role", "navigation")
	      timeline.setAttribute("aria-label", "Conversation turns")
	      view.appendChild(timeline)
	    }
	    return timeline
	  }

	  function updateTimelineProgress(sessionId: string) {
	    const msgList = getMessageList(sessionId)
	    const timeline = ensureTimeline(sessionId)
	    if (!msgList || !timeline) return
	    const progress = timeline.querySelector<HTMLElement>(".timeline-progress")
	    const total = Math.max(1, msgList.scrollHeight - msgList.clientHeight)
	    const ratio = Math.min(1, Math.max(0, msgList.scrollTop / total))
	    if (progress) progress.style.height = `${Math.round(ratio * 100)}%`

	    const items = Array.from(timeline.querySelectorAll<HTMLElement>(".timeline-item"))
	    let active: HTMLElement | null = null
	    for (const item of items) {
	      const id = item.dataset.messageId
	      if (!id) continue
	      const target = msgList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
	      if (target && target.offsetTop <= msgList.scrollTop + 48) active = item
	    }
	    items.forEach((item) => item.classList.toggle("active", item === active))
	  }

	  /* ─── DISPLAY TOGGLES (Phase 4.2) ─── */

  setupDisplayToggles({ els, getState: () => stateManager.getState(), save: () => stateManager.save() })

  function showSecondaryNav() {
    els.displayToggles.style.display = "flex"
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
    const indicator = els.inputArea.querySelector(".skill-indicators")
    if (!indicator) {
      const container = document.createElement("div")
      container.className = "skill-indicators"
      els.inputArea.insertBefore(container, els.inputWrapper)
      const pill = document.createElement("span")
      pill.className = "skill-pill"
      pill.textContent = skillName
      container.appendChild(pill)
      timers.setTimeout(() => pill.remove(), 3000)
    } else {
      const pill = document.createElement("span")
      pill.className = "skill-pill"
      pill.textContent = skillName
      indicator.appendChild(pill)
      timers.setTimeout(() => pill.remove(), 3000)
    }
  }

  function insertTextAtCursor(text: string) {
    const input = els.promptInput
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? input.value.length
    const needsSpaceBefore = start > 0 && !/\s$/.test(input.value.slice(0, start))
    const insert = `${needsSpaceBefore ? " " : ""}${text}`
    input.value = input.value.slice(0, start) + insert + input.value.slice(end)
    const cursor = start + insert.length
    input.setSelectionRange(cursor, cursor)
    input.focus()
	    autoResizeTextarea()
	    updatePromptContextChips()
	    updateSendButton()
    stateManager.save()
  }

  function handleCostUpdate(sessionId: string, cost: number) {
    if (!Number.isFinite(cost)) return
    const session = stateManager.getSession(sessionId)
    if (session) {
      session.cost = cost
      stateManager.save()
      renderRecentSessionsList()
    }
  }

  function handleHostMessage(msg: ChatMessage) {
    if (!msg.sessionId) return
    const stream = streamHandlers.get(msg.sessionId)
    const isFinalAssistantMessage = msg.role === "assistant"
    if (stream && isFinalAssistantMessage) {
      stream.hideTypingIndicator()
    }
    addMessage(msg.sessionId, msg)
    if (isFinalAssistantMessage) {
      stateManager.setStreaming(msg.sessionId, false)
      updateTabBar()
      updateModeSelectorStateLocal()
      updateSendButton()
      updateAgentStatus("idle")
    }
    syncModeUI()
  }

  function updateAgentStatus(status: "idle" | "thinking" | "executing") {
    els.agentStatusLed.className = `status-led ${status}`
    els.agentStatusText.textContent = status === "idle" ? "SYSTEM READY" : status.toUpperCase()
  }

  function handleStreamStart(sessionId: string, messageId?: string) {
    // Ensure the session exists in webview state. The extension can start a
    // stream for a session the webview doesn't yet know about — e.g. when the
    // session was filtered out of init_state because it had no persisted
    // messages, or when the user submitted a prompt before init_state arrived.
    let session = stateManager.getSession(sessionId)
    if (!session) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: Session ${sessionId} not in state, ensuring it` })
      session = stateManager.ensureSession({
        id: sessionId,
        name: "New Session",
        model: stateManager.getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
    }

    // Ensure tab UI exists in the DOM before processing stream
    let msgList = getMessageList(sessionId)
    if (!msgList) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: No message list for ${sessionId}, creating tab UI` })
      createTabUI(sessionId, session.name || "New Session")
      msgList = getMessageList(sessionId)
    }

    const stream = streamHandlers.get(sessionId)
    if (!stream) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: No stream found for session ${sessionId}, creating...` })
      const newStream = createStreamHandlersForTab(sessionId)
      streamHandlers.set(sessionId, newStream)
    }

    const finalStream = streamHandlers.get(sessionId)
    if (!finalStream) {
      vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamStart: Failed to get/create stream for ${sessionId}` })
      return
    }

    // Ensure the tab is visible (active) and welcome screen is hidden
    if (stateManager.getState().activeSessionId !== sessionId) {
      vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Switching to tab ${sessionId}` })
      switchTab(sessionId)
    }
    hideWelcomeView()
    updateTabBar()

    vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Starting stream for ${sessionId} (msgId=${messageId})` })
    finalStream.handleStreamStart(messageId)
    stateManager.setStreaming(sessionId, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateAgentStatus("thinking")
    // Flush pending file edits and clear stale banners when new streaming starts
    fileEditBatcher.cancelAll()
    const activeMsgList = getMessageList(sessionId)
    if (activeMsgList) {
      const staleBanners = activeMsgList.querySelectorAll(".task-banner")
      staleBanners.forEach(b => {
        if (b.textContent?.includes("Edited")) b.remove()
      })
      if (!activeMsgList.querySelector(".jump-to-bottom")) {
        setupJumpToBottom(sessionId)
      }
      debouncedUpdateScrollMarkers(sessionId)
    }
  }

  let chunkLogCounter = 0
  function handleStreamChunk(sessionId: string, text?: string, messageId?: string) {
    // Defensive: if a chunk arrives for a session we haven't bootstrapped yet
    // (race with init_state, or session filtered from init_state), bootstrap
    // everything now so the chunk renders into a visible bubble.
    if (!stateManager.getSession(sessionId)) {
      stateManager.ensureSession({
        id: sessionId,
        name: "New Session",
        model: stateManager.getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
    }
    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)) {
      const sess = stateManager.getSession(sessionId)
      if (sess) {
        createTabUI(sessionId, sess.name)
        updateTabBar()
        hideWelcomeView()
      }
    }
    let stream = streamHandlers.get(sessionId)
    if (!stream) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamChunk: No stream found for session ${sessionId}, creating...` })
      stream = createStreamHandlersForTab(sessionId)
      streamHandlers.set(sessionId, stream)
    }
    const s = stream!
    chunkLogCounter++
    // Reduce chunk logging frequency to avoid spamming output
    if (chunkLogCounter <= 3 || chunkLogCounter % 100 === 0 || (text && text.length > 1000)) {
      vscode.postMessage({
        type: "webview_log",
        level: "info",
        message: `handleStreamChunk: chunk #${chunkLogCounter} for ${sessionId} len=${text?.length || 0} streamingMessageId=${s.streamingMessageId ?? "<null>"}`,
      })
    }
    s.handleStreamChunk(text, messageId)
  }

  function showStreamEndReasonMessage(sessionId: string, reason?: string, partial?: boolean) {
    if (reason === "ttfb_timeout") {
      showSystemMessage(sessionId, "The model took too long to start responding. Please try again or select a different model.", true)
    } else if (reason === "timeout") {
      showSystemMessage(sessionId, partial
        ? "Response was cut off (timeout). Partial output has been preserved."
        : "Response timed out. Please try again or select a different model.", true)
    } else if (reason === "hard_timeout") {
      showSystemMessage(sessionId, "Stream interrupted after extended run. Partial output preserved.", true)
    } else if (reason === "error") {
      showSystemMessage(sessionId, "An error occurred while generating the response. Please try again.", true)
    }
  }

  function processQueueIfReady(sessionId: string, reason?: string) {
    if (reason === "aborted") return
    const queue = promptQueues.get(sessionId)
    if (queue && queue.isNextReady()) {
      const next = queue.processNext()
      if (next) {
        persistQueues()
        sendQueuedPrompt(sessionId, next.text, next.attachments)
      }
    }
  }

  function processStreamEndBlocks(sessionId: string, messageId?: string, blocks?: unknown) {
    const blockList = Array.isArray(blocks) ? blocks as ChatMessage["blocks"] : []
    if (blockList.length === 0) return

    const msgList = getMessageList(sessionId)
    if (messageId && msgList) {
      const placeholder = msgList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
      if (placeholder) {
        const textEl = placeholder.querySelector(".streaming-text, .msg-text") as HTMLElement | null
        const hasContent = textEl && textEl.textContent && textEl.textContent.trim().length > 2
        if (!hasContent) placeholder.remove()
      }
    }
    addMessage(sessionId, {
      role: "assistant",
      id: messageId || `resp-${Date.now()}`,
      blocks: blockList,
      timestamp: Date.now(),
    })
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) {
    try {
      const stream = streamHandlers.get(sessionId)
      if (!stream) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamEnd: No stream found for session ${sessionId}` })
      } else {
        try {
          stream.handleStreamEnd(messageId, blocks)
        } catch (err) {
          log.error("stream.handleStreamEnd threw:", err)
          vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd: stream handler threw: ${err instanceof Error ? err.message : err}` })
        }
      }

      processStreamEndBlocks(sessionId, messageId, blocks)

      stateManager.setStreaming(sessionId, false)
      toolElapsedTracker.clearAll()
      clearToolChainProgress(sessionId)
      for (const [key, pending] of Array.from(pendingToolUpdates)) {
        if (pending.sessionId === sessionId) {
          timers.clearTimeout(pending.timer)
          pendingToolUpdates.delete(key)
        }
      }
      updateTabBar()
      updateModeSelectorStateLocal()
      updateAgentStatus("idle")

      showStreamEndReasonMessage(sessionId, reason, partial)

      if (sessionId === stateManager.getState().activeSessionId) {
        updateSendButtonIcon(false)
        updateSendButton()
      }

      processQueueIfReady(sessionId, reason)
    } catch (err) {
      log.error("handleStreamEnd top-level error:", err)
      vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd error: ${err instanceof Error ? err.message : String(err)}` })
      try { stateManager.setStreaming(sessionId, false) } catch {}
      try { updateTabBar() } catch {}
      try { updateModeSelectorStateLocal() } catch {}
      try { updateAgentStatus("idle") } catch {}
      const msg = reason === "ttfb_timeout" ? "Model took too long. Try a different model."
        : reason === "timeout" ? "Response timed out."
        : reason === "error" ? "An error occurred."
        : "Unexpected error."
      try { showSystemMessage(sessionId, msg) } catch {}
    }
  }

  function sendQueuedPrompt(sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) {
    const active = stateManager.getSession(sessionId)
    if (!active) return

    const msgObj: ChatMessage = {
      role: "user",
      id: createWebviewId("user"),
      blocks: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...(attachments || []).map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
      ],
      timestamp: Date.now(),
      sessionId,
    }

    addMessage(sessionId, msgObj)
    stateManager.setStreaming(sessionId, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateSendButton()
    renderQueue(sessionId)

    const stream = streamHandlers.get(sessionId)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId,
      messageId: msgObj.id,
      model: active.model,
      mode: active.mode,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    })
  }

  function handleServerStatus(sessionId: string, status?: string, errorContext?: unknown) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return
    stream.handleServerStatus(status, errorContext)
    if (status === "executing" || status === "running") {
      updateAgentStatus("executing")
    } else if (status === "idle") {
      updateAgentStatus("idle")
    }
  }

  function handleRequestError(sessionId: string | undefined, message?: string) {
    if (!sessionId) {
      // Global error - find any streaming session
      const sessions = stateManager.getAllSessions()
      const streaming = sessions.find(s => s.isStreaming)
      if (streaming) sessionId = streaming.id
      else return
    }

    stateManager.setStreaming(sessionId, false)
    updateTabBar()
    updateModeSelectorStateLocal()

    const stream = streamHandlers.get(sessionId)
    if (stream) {
      stream.handleRequestError(message)
    }

    if (sessionId === stateManager.getState().activeSessionId) {
      updateSendButtonIcon(false)
      updateSendButton()
    }
  }

  function handleDiffResult(blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) {
    for (const [sid, stream] of streamHandlers) {
      stream.handleDiffResult(blockId, ok, message)
    }
    // Show checkpoint indicator when a snapshot was created during diff accept
    if (ok && checkpointCreated) {
      const active = stateManager.getActiveSession()
      if (active) {
        showSystemMessage(active.id, "Checkpoint saved — you can revert via OpenCode: Rollback Changes")
      }
    }
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

  function recordUsageSnapshot(sessionId: string) {
    recordUsageSnapshotModule({ ...tokenCostDeps, getState: () => stateManager.getState() }, sessionId)
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

  function checkOverflowWarnings(sessionId: string) {
    checkOverflowWarningsModule(tokenCostDeps, sessionId)
  }

  function showStatusStrip() {
    els.statusStrip.removeAttribute("hidden")
  }

  function hideStatusStrip() {
    els.statusStrip.setAttribute("hidden", "")
    els.statusCost.classList.add("hidden")
    els.statusTokens.classList.add("hidden")
    els.quotaBar.classList.add("hidden")
  }

  const fileEditBatcher = new FileEditBatcher((sessionId, text) => {
    addMessage(sessionId, {
      role: "system",
      id: createWebviewId("file"),
      blocks: [{ type: "task_banner", status: "success", text }],
      timestamp: Date.now(),
      sessionId,
    })
  })

  const fileTrackingDeps: FileTrackingDeps = {
    getSession: (id) => stateManager.getSession(id),
    save: () => stateManager.save(),
    postMessage: (msg) => vscode.postMessage(msg),
    getActiveSessionId: () => stateManager.getState().activeSessionId ?? undefined,
    changedFilesList: els.changedFilesList,
    checkpointPanel: els.checkpointPanel,
    checkpointToggleBtn: els.checkpointToggleBtn,
    clearMessages: (sessionId) => streamHandlers.get(sessionId)?.clearMessages(),
    getMessageList: (id) => getMessageList(id),
    getAllSessions: () => stateManager.getAllSessions(),
  }

  function trackFileChange(sessionId: string, filePath: string) {
    trackFileChangeModule(fileTrackingDeps, sessionId, filePath)
  }

function undoMessage(messageId: string) {
    undoMessageModule(fileTrackingDeps, messageId)
  }

  // Stubs for workspace-based session browsing (used by extension host)
  function getSessionsByWorkspace(workspacePath: string) {
    return stateManager.getAllSessions().filter(s => (s as any).workspacePath === workspacePath)
  }

  function filterByWorkspace(sessions: any[], workspace: string) {
    return sessions.filter(s => s.workspacePath === workspace || s.workspace === workspace)
  }

  function handleChangedFiles(sessionId: string, files: string[]) {
    handleChangedFilesModule(fileTrackingDeps, sessionId, files)
  }

  function renderChangedFilesList(files: string[]) {
    renderChangedFilesListModule(fileTrackingDeps, files)
  }

  function renderCheckpointPanel(checkpoints: Array<{ id: string; sessionId: string; messageId?: string; filesChanged?: string[] }>) {
    renderCheckpointPanelModule(fileTrackingDeps, checkpoints)
  }

  function handleClearMessages(sessionId?: string) {
    handleClearMessagesModule(fileTrackingDeps, sessionId)
  }

  /* ─── START ─── */

function boot() {
    try {
      init()
      vscode.postMessage({ type: "webview_ready" })
      vscode.postMessage({ type: "list_commands" })
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
