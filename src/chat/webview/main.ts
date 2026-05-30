import type { ChatMessage, HostMessage, LegacyHostMessage, MentionItem, SessionSummary, ModelInfo, WebviewState, ContextChip, ToolCallState, TokenUsageSnapshot, UsageDelta, Block, Todo } from "./types"
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
import { upsertMessageById } from "./messageUpsert"
import { createTabBar, createTabContent, switchToTab, removeTabContent } from "./tabs"
import { setupModelDropdown } from "./model-dropdown"
import { setVsCodeApi, setupToolKeyboardNav, webviewLog } from "./streamHandlers"
import { setupModelManager } from "./model-manager"
import { setupVariantSelector } from "./variant-selector"
import { setupMcpConfig } from "./mcp-config"
import type { McpServerInfo } from "../../mcp/McpServerManager"
import { REMOVE_SVG } from "./icons"
import { createPromptQueue, type PromptQueue, type QueueItem } from "./queue"
import { updateContextChips, applyThemeVars, handleRateLimitExhausted } from "./theme"
// context-usage-panel.ts removed — canonical UI is now context-usage-dropdown.ts
import { setupChangedFilesDropdown, updateChangedFiles, handleDiffResponse as handleCfDiffResponse, resetChangedFilesDropdown, setCurrentSession as setCfCurrentSession } from "./changed-files-dropdown"
import type { DiffLine } from "./types"
import { mergeEditBannerFiles } from "./file-chip-list"
import { setupContextUsageDropdown as setupCtxDropdown, updateUsage as updateCtxDropdown, resetContextUsageDropdown, openContextUsageDropdown } from "./context-usage-dropdown"
import { showCompactBanner, hideCompactBanner } from "./compact-banner"
import { setupPromptStash } from "./prompt-stash"
import { prepareHostRecentSessions, prepareLocalRecentSessions, renderRecentSessions } from "./recent-sessions"
import { renderUnifiedSessionList, setSessionListPostMessage, setUnifiedServerSessions, setUnifiedLocalSessions, setUnifiedSessionQuery, getUnifiedSessionQuery } from "./sessionListRenderer"
import { createScrollAnchor, type ScrollAnchor } from "./scrollAnchor"
import { createChunkedLoader, prependMessagesPreservingScroll, createLoadEarlierBanner, throttleScrollMarkers } from "./messageLoader"
import { createVirtualList, getVirtualList, disposeVirtualList } from "./virtualList"
import { setupTodosPanel } from "./todos-panel"
import { mergeTodos, generateTodoId } from "./todos-logic"
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
import { trackFileChange as trackFileChangeModule, undoMessage as undoMessageModule, handleChangedFiles as handleChangedFilesModule, renderCheckpointPanel as renderCheckpointPanelModule, handleClearMessages as handleClearMessagesModule, type FileTrackingDeps } from "./ui/fileTracking"
import { setupButtons as setupButtonsModule, type ButtonSetupDeps } from "./ui/buttonSetup"
import { updateScrollMarkers as updateScrollMarkersModule, setupJumpToBottom as setupJumpToBottomModule, scrollMessageToTop as scrollMessageToTopModule, scrollToTurn as scrollToTurnModule, type ScrollMarkerDeps } from "./ui/scrollMarkers"
import { createStreamOrchestrator, type StreamOrchestratorAPI } from "./streamOrchestrator"
import { createTimeline, type TimelineAPI } from "./timeline"
import { createComposer, type ComposerAPI } from "./composer"

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
  let currentTodosList: Todo[] = []

  function getMergedTodos(sessionId: string, serverTodos: Todo[]): Todo[] {
    const session = stateManager.getSession(sessionId)
    return mergeTodos(session, serverTodos)
  }

  function triggerTodosRender(sessionId: string) {
    if (todosPanelApi && todosPanelApi.renderTodos) {
      const merged = getMergedTodos(sessionId, currentTodosList)
      todosPanelApi.renderTodos(merged)
    }
  }
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

  let cfDropdownApi: { updateChangedFiles: typeof updateChangedFiles; handleDiffResponse: typeof handleCfDiffResponse; setCurrentSession: typeof setCfCurrentSession } | null = null
  let ctxDropdownApi: { updateUsage: typeof updateCtxDropdown } | null = null

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
    onToggleContextMonitor: () => {
      if (els.contextUsageBtn && !els.contextUsageBtn.classList.contains("hidden")) {
        els.contextUsageBtn.click()
      }
    },
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
  })

  function setSteerMode(mode: 'interrupt' | 'append' | 'queue') {
    composer.setSteerMode(mode)
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

  /* ─── STREAM ORCHESTRATOR ─── */

  let streamOrchestrator!: StreamOrchestratorAPI

  function wireStreamOrchestrator() {
    streamOrchestrator = createStreamOrchestrator({
      vscode,
      els,
      streamHandlers,
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
      updateSendButton: () => composer.updateSendButton(),
      getMessageList,
      createStreamHandlersForTab,
      setupJumpToBottom,
      debouncedUpdateScrollMarkers,
      debouncedTimelineRefresh,
      refreshConversationTimeline,
      toolElapsedTracker,
      fileEditBatcher: fileEditBatcherRef,
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
      getSession: (id) => stateManager.getSession(id) as any,
      isTimelineVisible: () => stateManager.isTimelineVisible(),
      setTimelineVisible: (v) => stateManager.setTimelineVisible(v),
      getMessageList,
      scrollToTurn: (messageId) => scrollToTurnModule(scrollMarkerDeps, messageId),
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
      els: els as any,
      vscode: vscode as any,
      stateManager: stateManager as any,
      attachmentManager: attachmentManager as any,
      mention: mention as any,
      modelDropdown: modelDropdown as any,
      modelManager: modelManager as any,
      commandsModal: commandsModal as any,
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
    })
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

  let fileEditBatcherRef!: FileEditBatcher

  function init() {
    try {
      setupCoreInteractionControls()
      setupSessionUtilities()
      setupTodoSkillAndSubagentPanels()
      setupChangedFilesFeature()
      setupContextUsageFeature()
      finishWebviewInitialization()
    } catch (err) {
      showInitializationFailure(err)
    }
  }

  function setupCoreInteractionControls(): void {
    setupModeToggle({
      els,
      getActiveSession: () => stateManager.getActiveSession(),
      setSessionMode: (id, mode) => stateManager.setSessionMode(id, mode),
      postMessage: (msg) => vscode.postMessage(msg),
      showAutoModeWarning,
    })
    wireComposer()
    composer.setupInput()
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
        changedFilesList: null,
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
  }

  function setupSessionUtilities(): void {
    setupSessionModal()
    setupPromptStash(els, (msg) => vscode.postMessage(msg as Record<string, unknown>))
  }

  function setupTodoSkillAndSubagentPanels(): void {
    todosPanelApi = setupTodosPanel(els, {
      onToggleTodo: toggleTodo,
      onDeleteTodo: deleteTodo,
      onAddTodo: addUserTodo,
      onOpenFile: (filePath: string) => vscode.postMessage({ type: "open_file", path: filePath }),
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
    skillsModalApi = setupSkillsModal(els, {
      onToggleSkill: (skillId: string, enabled: boolean) => vscode.postMessage({ type: "toggle_skill", skillId, enabled }),
      onSearchSkills: (query: string) => vscode.postMessage({ type: "search_skills", query }),
    })
    subagentPanelApi = setupSubagentPanel(els, {
      onCancelSubagent: (subagentId: string) => vscode.postMessage({ type: "cancel_subagent", subagentId }),
    })
  }

  function toggleTodo(todoOrId: string | Todo): void {
    const todoId = typeof todoOrId === "string" ? todoOrId : todoOrId.id
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return

    if (todoId.startsWith("todo-")) {
      const todo = session.userTodos?.find(t => t.id === todoId)
      if (todo) {
        todo.status = todo.status === "completed" ? "pending" : "completed"
        stateManager.save()
        triggerTodosRender(activeSid)
      }
      return
    }

    session.todoOverrides ??= {}
    const currentStatus = session.todoOverrides[todoId] ||
      (typeof todoOrId === "object" ? todoOrId.status : "pending")
    session.todoOverrides[todoId] = currentStatus === "completed" ? "pending" : "completed"
    stateManager.save()
    triggerTodosRender(activeSid)
    vscode.postMessage({ type: "toggle_todo", todoId })
  }

  function deleteTodo(todoId: string): void {
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return

    if (todoId.startsWith("todo-")) {
      session.userTodos = session.userTodos?.filter(t => t.id !== todoId) || []
      stateManager.save()
      triggerTodosRender(activeSid)
      return
    }

    session.deletedTodoIds ??= []
    if (!session.deletedTodoIds.includes(todoId)) {
      session.deletedTodoIds.push(todoId)
    }
    stateManager.save()
    triggerTodosRender(activeSid)
    vscode.postMessage({ type: "delete_todo", todoId })
  }

  function addUserTodo(content: string): void {
    const activeSid = stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = stateManager.getSession(activeSid)
    if (!session) return

    const normalized = content.trim()
    if (!normalized) return
    if (normalized.length > 500) {
      console.warn("Todo content exceeds 500 character limit")
      return
    }

    session.userTodos ??= []
    const exists = session.userTodos.some(
      t => t.content.trim().toLowerCase() === normalized.toLowerCase()
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

  function setupChangedFilesFeature(): void {
    if (!els.changedFilesDropdown || !els.cfDropdownTree || !els.cfCountBadge) return

    setupChangedFilesDropdown({
      btn: els.changedFilesBtn ?? null,
      panel: els.changedFilesDropdown,
      treeContainer: els.cfDropdownTree,
      badge: els.cfCountBadge,
      postMessage: (msg) => vscode.postMessage(msg),
      onOpenFile: (path) => vscode.postMessage({ type: "open_file", path }),
    })
    cfDropdownApi = { updateChangedFiles, handleDiffResponse: handleCfDiffResponse, setCurrentSession: setCfCurrentSession }

    const strip = document.getElementById("changed-files-strip")
    strip?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); strip.click() }
    })
  }

  function setupContextUsageFeature(): void {
    if (!els.contextUsageDropdown || !els.ctxDropdownContent || !els.ctxPctBadge) return

    setupCtxDropdown({
      btn: null,
      panel: els.contextUsageDropdown,
      content: els.ctxDropdownContent,
      badge: els.ctxPctBadge,
      postMessage: (msg) => vscode.postMessage(msg),
    })
    ctxDropdownApi = { updateUsage: updateCtxDropdown }
    els.contextUsage.setAttribute("tabindex", "0")
    els.contextUsage.setAttribute("role", "button")
    els.contextUsage.setAttribute("aria-haspopup", "true")
    els.contextUsage.setAttribute("aria-controls", "context-usage-dropdown")
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
    openContextUsageDropdown()
  }

  function finishWebviewInitialization(): void {
    setupWelcomeSuggestions()
    setupWelcomeActions()
    wireStreamOrchestrator()
    wireTimeline()
    setupMessageListener()
    setupPermissionListener()
    setupDiffActionListener()
    composer.restoreQueues()
    timeline.setupTimelineToggle()
    timeline.setupThinkingToggle()
    setupToolKeyboardNav()
    setupSettingsMenuKeyboardNav()
    composer.updateSendButton()
    setVsCodeApi(vscode)
    setSessionListPostMessage((msg) => vscode.postMessage(msg as Record<string, unknown>))
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
    },
    postMessage: (msg) => vscode.postMessage(msg),
    getAllSessions: () => stateManager.getAllSessions(),
    getState: () => {
      const s = stateManager.getState()
      return { ...s, activeSessionId: s.activeSessionId ?? undefined }
    },
    openModelManager: () => modelManager.open(),
    renderRecentSessionsList,
    onDeleteRecentSession: (sessionId) => {
      vscode.postMessage({ type: "delete_session", targetSessionId: sessionId })
    },
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
        (sessionId) => {
          vscode.postMessage({ type: "resume_session", sessionId })
        },
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
      (sessionId) => {
        vscode.postMessage({ type: "resume_session", sessionId })
      },
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
    // New tab is never streaming — sync chat bar so it doesn't inherit the
    // streaming state visually from a previously-active streaming session.
    updateSendButton()
    els.promptInput.placeholder = "Ask OpenCode a question about your code…"
    els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
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
      onToggleContextMonitor: () => {
      if (els.contextUsageBtn && !els.contextUsageBtn.classList.contains("hidden")) {
        els.contextUsageBtn.click()
      }
    },
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
        session.changedFiles.map((p) => ({ path: p, added: 0, removed: 0 })) as any
      )
    }

    // Sync todos panel for the switched tab
    vscode.postMessage({ type: "get_todos", sessionId: tabId })
    vscode.postMessage({ type: "get_changed_files", sessionId: tabId })
    triggerTodosRender(tabId)
    
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

    const isActiveStreaming = activeSession?.isStreaming || false
    updateSendButtonIcon(isActiveStreaming)
    if (isActiveStreaming) {
      els.promptInput.placeholder = "Guide the AI: correct errors, change direction, or add context…"
    } else {
      els.promptInput.placeholder = "Ask OpenCode a question about your code…"
    }
    if (!isActiveStreaming) {
      els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
    }
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
  }

  function closeModeDropdownLocal() {
    closeModeDropdown(els)
  }

  function updateModeSelectorStateLocal() {
    updateModeSelectorState(els, () => stateManager.getActiveSession())
  }

  function syncModeUI() {
    syncModeUIModule(els, () => stateManager.getActiveSession())
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
      updateModeDropdownLocal(mode)
      stateManager.setSessionMode(active.id, mode)
      vscode.postMessage({ type: "change_mode", mode, sessionId: active.id })
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
    composer.setupInput()
  }

  function onInputChange() {
    composer.onInputChange()
  }

  function onInputKeydown(e: KeyboardEvent) {
    composer.onInputKeydown(e)
  }

  function onPaste(e: ClipboardEvent) {
    composer.onPaste(e)
  }

  function updatePromptContextChips() {
    composer.updatePromptContextChips()
  }

  function renderAttachmentChips() {
    composer.renderAttachmentChips()
  }

  function autoResizeTextarea() {
    composer.autoResizeTextarea()
  }

  function getStreamCapacityState(): any {
    return composer.getStreamCapacityState()
  }

  function updateSendButton() {
    composer.updateSendButton()
  }

  function updateSendButtonIcon(isStreaming?: boolean, streamCapacity?: any) {
    composer.updateSendButtonIcon(isStreaming, streamCapacity)
  }

  function generateTitle(text: string): string {
    return composer.generateTitle(text)
  }

  function isAutoSessionName(name?: string): boolean {
    return composer.isAutoSessionName(name)
  }

  function persistQueues() {
    composer.persistQueues()
  }

  function restoreQueues() {
    composer.restoreQueues()
  }

  function renderQueue(tabId: string) {
    composer.renderQueue(tabId)
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
    composer.wireChipReorderHandlers(chip, itemId, tabId, queue)
  }

  function updateQueueSendButton() {
    composer.updateQueueSendButton()
  }

  function sendSteerPrompt() {
    composer.sendSteerPrompt()
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
    upsertMessageById(session.messages, msg)

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
        const pct = msg.percent as number
        const tokens = msg.tokens as number
        const maxTokens = msg.maxTokens as number
        const activeId = stateManager.getState().activeSessionId
        const targetId = isValidSessionId(msg.sessionId as string) ? msg.sessionId as string : activeId
        if (!targetId) return
        // Persist per-session so it survives tab switches
        const sess = stateManager.getSession(targetId)
        if (sess) {
          sess.contextUsage = { percent: pct, tokens, maxTokens, breakdown: msg.breakdown as any }
          stateManager.save()
        }
        if (targetId !== activeId) {
          return
        }
        // Update both the floating dropdown detail view and the always-visible status strip bar
        ctxDropdownApi?.updateUsage({ ...msg, sessionId: targetId } as Record<string, unknown>)
        updateContextUsageBar(pct, tokens, maxTokens)
      }],
      ["context_window_unknown", (msg) => {
        const activeId = stateManager.getState().activeSessionId
        const targetId = isValidSessionId(msg.sessionId as string) ? msg.sessionId as string : activeId
        if (!targetId || targetId !== activeId) return
        // Hide the context bar and show the "Set override" chip so the user
        // knows the model's context window is unavailable rather than seeing
        // a misleading fabricated denominator.
        els.contextUsage.classList.add("hidden")
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
        ctxDropdownApi?.updateUsage({ ...msg, sessionId: targetId } as Record<string, unknown>)
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
            const pct = Math.min(100, Math.round((fill.tokens / (msg.maxTokens as number)) * 100))
            const updatedUsage = { type: "context_usage", sessionId: targetId, percent: pct, tokens: fill.tokens, maxTokens: msg.maxTokens as number, breakdown: fill.breakdown }
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

          const isActiveSession = sid === stateManager.getState().activeSessionId

          if (isActiveSession) {
            const steerModeSelector = document.getElementById("steer-mode-selector") as HTMLElement
            if (steerModeSelector) {
              if (msg.isStreaming) {
                steerModeSelector.classList.remove("hidden")
              } else {
                steerModeSelector.classList.add("hidden")
              }
            }

            if (msg.isStreaming) {
              els.promptInput.placeholder = "Guide the AI: correct errors, change direction, or add context…"
            } else {
              els.promptInput.placeholder = "Ask OpenCode a question about your code…"
            }

            if (!msg.isStreaming) {
              els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
            }
          }
          
          if (!msg.isStreaming) {
            const sess = stateManager.getSession(sid)
            if (sess) {
              sess.changedFiles = []
              stateManager.save()
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
      ["stream_tool_end", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const result = msg.result as { id: string; ok: boolean; result?: string; durationMs?: number; stale?: boolean }
            streamOrchestrator.flushToolUpdate(sid, result.id)
            toolElapsedTracker.unregisterEnd(result.id, result.durationMs)
            stream.handleToolEnd(result.id, result)
            streamOrchestrator.clearToolChainProgress(sid)
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
              sessionId: sid,
              permissionId: String(_msg.permissionId || ""),
              permissionType: typeof _msg.permissionType === "string" ? _msg.permissionType : undefined,
              pattern: typeof _msg.pattern === "string" || Array.isArray(_msg.pattern) ? _msg.pattern as string | string[] : undefined,
              metadata: _msg.metadata && typeof _msg.metadata === "object" ? _msg.metadata as Record<string, unknown> : undefined,
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
          }
          fileEditBatcherRef.add(sid, filePath)
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
      ["revert_failed", (msg: any, sid) => {
        if (sid) showSystemMessage(sid, `Revert failed: ${msg.error || "Unknown error"}`)
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
        const commands = (msg.commands || []) as Array<{ name: string; description?: string; template?: string; isCustom?: boolean; source?: string }>
        const promptCommands = commands.filter((c) => c.isCustom)
        const remoteCommands = commands.filter((c) => !c.isCustom)
        const commandSuggestions = [...remoteCommands, ...promptCommands]
        mention.updateServerCommands(commandSuggestions)
        commandsModal.updateServerCommands(remoteCommands)
        commandsModal.updatePromptCommands(promptCommands)
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
        const sid = typeof msg.sessionId === "string" ? msg.sessionId : stateManager.getState().activeSessionId
        const activeSid = stateManager.getState().activeSessionId
        if (sid) {
          currentTodosList = (msg.todos as Todo[]) || []
          const merged = getMergedTodos(sid, currentTodosList)
          if (sid === activeSid && todosPanelApi && todosPanelApi.renderTodos) {
            todosPanelApi.renderTodos(merged)
          }
        }
      }],
      ["todo_operation_denied", (msg) => {
        const reason = typeof msg.reason === "string" ? msg.reason : "Operation not allowed"
        if (todosPanelApi && todosPanelApi.showToast) {
          todosPanelApi.showToast(reason, "warning")
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
        cfDropdownApi?.updateChangedFiles(sid, files as any)
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

    window.addEventListener("beforeunload", () => {
      stateManager.flush()
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

  /* ─── CONVERSATION TIMELINE ─── (delegated to timeline.ts) */

  function setupTimelineToggle() { timeline.setupTimelineToggle() }
  function setupThinkingToggle() { timeline.setupThinkingToggle() }
  function applyTimelineVisibility(sessionId?: string) { timeline.applyTimelineVisibility(sessionId) }
  function refreshConversationTimeline(sessionId?: string) { timeline.refreshConversationTimeline(sessionId) }

	  /* ─── DISPLAY TOGGLES (Phase 4.2) ─── */

  setupDisplayToggles({ els, getState: () => stateManager.getState(), save: () => stateManager.save() })

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

  function handleStreamStart(sessionId: string, messageId?: string) {
    streamOrchestrator.handleStreamStart(sessionId, messageId)
  }

  let chunkLogCounter = 0
  function handleStreamChunk(sessionId: string, text?: string, messageId?: string) {
    streamOrchestrator.handleStreamChunk(sessionId, text, messageId)
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) {
    streamOrchestrator.handleStreamEnd(sessionId, messageId, blocks, reason, partial)
  }

  function sendQueuedPrompt(sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) {
    streamOrchestrator.sendQueuedPrompt(sessionId, text, attachments)
  }

  function handleServerStatus(sessionId: string, status?: string, errorContext?: unknown) {
    streamOrchestrator.handleServerStatus(sessionId, status, errorContext)
  }

  function handleRequestError(sessionId: string | undefined, message?: string) {
    streamOrchestrator.handleRequestError(sessionId, message)
  }

  function handleDiffResult(blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) {
    streamOrchestrator.handleDiffResult(blockId, ok, message, checkpointCreated)
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

  function resetContextUsagePanel() {
    resetContextUsageDropdown()
    els.contextUsage.classList.add("hidden")
  }

  // Update the always-visible status-strip context bar (progress + label text).
  // Separate from ctxDropdownApi which drives the floating detail panel.
  function updateContextUsageBar(pct: number, tokens: number, maxTokens: number): void {
    try {
      const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
      const safeTokens = Number.isFinite(tokens) ? Math.max(0, tokens) : 0
      const bar = els.contextUsage
      const prog = els.contextProgressBar as HTMLProgressElement | null
      const label = els.contextLabel

      if (prog && "value" in prog) {
        (prog as HTMLProgressElement).value = safePct
      }
      if (label) {
        const tokStr = formatTokenCount(safeTokens)
        const maxStr = maxTokens > 0 ? ` · ${formatTokenCount(maxTokens)}` : ""
        label.textContent = `${safePct}%${maxStr !== "" ? ` · ${tokStr}` : ` · ${tokStr} tok`}`
      }
      const shouldHide = safePct === 0 && safeTokens === 0
      bar.classList.toggle("hidden", shouldHide)
      if (!shouldHide) {
        // Parent status-strip has the HTML hidden attribute by default — reveal it.
        els.statusStrip.removeAttribute("hidden")
      }
      // Apply colour class based on utilisation
      bar.classList.toggle("context-usage-bar--warning", safePct >= 70 && safePct < 90)
      bar.classList.toggle("context-usage-bar--critical", safePct >= 90)
    } catch {
      // Non-fatal — bar stays in its previous state
    }
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

  const TASK_BANNER_COALESCE_MS = 5000

  /**
   * Coalesce successive "Edited N files" task banners that arrive within a
   * short window of each other. Without this, every 500ms FileEditBatcher
   * flush spawns a fresh banner row — three rapid edits = three stacked
   * cards. With it, we merge the new files into the latest existing banner
   * and re-render that one node in place. Falls back to a fresh banner if
   * the previous message is something else or older than the window.
   */
  function appendOrCoalesceEditBanner(sessionId: string, text: string) {
    const session = stateManager.getSession(sessionId)
    const last = session?.messages?.[session.messages.length - 1]
    const lastBlock = last?.blocks?.[0]
    const isRecentEditBanner =
      last &&
      last.role === "system" &&
      lastBlock?.type === "task_banner" &&
      lastBlock?.status === "success" &&
      typeof lastBlock?.text === "string" &&
      /^Edited /.test(lastBlock.text) &&
      typeof last.timestamp === "number" &&
      Date.now() - last.timestamp < TASK_BANNER_COALESCE_MS

    if (isRecentEditBanner && last && lastBlock) {
      const mergedFiles = mergeEditBannerFiles(lastBlock.text as string, text)
      lastBlock.text = mergedFiles
      last.timestamp = Date.now()
      stateManager.save()
      // Re-render the affected message in place
      const msgList = getMessageList(sessionId)
      const node = last.id ? msgList?.querySelector(`[data-message-id="${CSS.escape(last.id)}"]`) : null
      if (node && msgList) {
        const session2 = stateManager.getSession(sessionId)
        const fresh = renderMessage(last, {
          mode: session2?.mode || "build",
          postMessage: (m) => vscode.postMessage(m),
        } as Parameters<typeof renderMessage>[1])
        if (fresh) node.replaceWith(fresh)
      }
      return
    }

    addMessage(sessionId, {
      role: "system",
      id: createWebviewId("file"),
      blocks: [{ type: "task_banner", status: "success", text }],
      timestamp: Date.now(),
      sessionId,
    })
  }

  fileEditBatcherRef = new FileEditBatcher((sessionId, text) => {
    appendOrCoalesceEditBanner(sessionId, text)
  })

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
