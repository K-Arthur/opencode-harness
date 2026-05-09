import type { ChatMessage, HostMessage, MentionItem, SessionSummary, ModelInfo, WebviewState, ContextChip, ToolCallState } from "./types"
import { createState } from "./state"
import { getElementRefs, scrollToBottom, getActiveMessageList } from "./dom"
import { renderMessage, groupMessagesIntoTurns } from "./renderer"
import { setupMentions } from "./mentions"
import { createStreamHandlers, type StreamHandlers } from "./stream"
import { createTabBar, createTabContent, switchToTab, removeTabContent } from "./tabs"
import { setupModelDropdown } from "./model-dropdown"
import { setVsCodeApi, stripContextFromText, setupToolKeyboardNav } from "./streamHandlers"
import { setupModelManager } from "./model-manager"
import { setupVariantSelector } from "./variant-selector"
import { setupMcpConfig } from "./mcp-config"
import type { McpServerInfo } from "../../mcp/McpServerManager"
import { REMOVE_SVG } from "./icons"
import { createPromptQueue, type PromptQueue, type QueueItem } from "./queue"
import { updateContextChips, updateContextUsage, applyThemeVars, handleRateLimitExhausted } from "./theme"
import { renderRecentSessions } from "./recent-sessions"
import { createScrollAnchor, type ScrollAnchor } from "./scrollAnchor"
import { createChunkedLoader, prependMessagesPreservingScroll, createLoadEarlierBanner, throttleScrollMarkers } from "./messageLoader"
import { createVirtualList, getVirtualList, disposeVirtualList } from "./virtualList"

declare const acquireVsCodeApi: (() => {
  postMessage(message: Record<string, unknown>): void
  getState(): import("./types").WebviewState | undefined
  setState(state: import("./types").WebviewState): void
}) | undefined

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
    console.error("[OpenCode] Unhandled error:", event.error || event.message)
    const errorDiv = document.getElementById("error-boundary")
    if (errorDiv) {
      errorDiv.style.display = "block"
      errorDiv.textContent = "An error occurred. Please reload the panel."
    }
  })

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[OpenCode] Unhandled promise rejection:", event.reason)
  })

  // Flush state when page becomes hidden (tab switch, minimize, etc.)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stateManager.flush()
    }
  })

  const vscode = getVsCodeApi()
  const stateManager = createState(vscode)
  const els = getElementRefs()

  // Core UI modules
  let modelManager: ReturnType<typeof setupModelManager>

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

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
  })

  // Streaming state per session
  const streamHandlers = new Map<string, ReturnType<typeof createStreamHandlers>>()
  let streamChunkLogCount = 0

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

  // Mode state: "plan" or "build"
  let currentMode = "build"

  // Pending image attachments queued for next send
  interface PendingAttachment {
    data: string
    mimeType: string
  }
  let pendingAttachments: PendingAttachment[] = []

  /* ─── INIT ─── */

  let toolElapsedTimer: ReturnType<typeof setInterval> | null = null
  function startToolElapsedTimer(): void {
    if (toolElapsedTimer) return
    toolElapsedTimer = setInterval(() => {
      const els = Array.from(document.querySelectorAll<HTMLSpanElement>(".tool-elapsed[data-start-time]"))
      for (const el of els) {
        const start = Number(el.dataset.startTime || 0)
        if (!start) continue
        const elapsed = Math.round((Date.now() - start) / 1000)
        el.textContent = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`
      }
    }, 1000)
  }

  function stopToolElapsedTimer(): void {
    if (toolElapsedTimer) {
      clearInterval(toolElapsedTimer)
      toolElapsedTimer = null
    }
  }

  function init() {
    try {
      setupModeToggle()
      setupModeWarning()
      setupInput()
      setupButtons()
      setupThemeCustomizer()
      setupSessionModal()
      setupWelcomeSuggestions()
      setupWelcomeActions()
      setupMessageListener()
      setupPermissionListener()
      setupDiffActionListener()
	      setupSearch()
	      setupTimelineToggle()
      setupDisplayToggles()
      setupToolKeyboardNav()
      updateSendButton()
      setVsCodeApi(vscode)

      // Show welcome view by default — no session created until user sends a message
      showWelcomeView()

      // Let the extension be the source of truth - wait for init_state
      const initTimeout = setTimeout(() => {
        // If we haven't received init_state after 3 seconds, just show welcome
        if (!stateManager.getState().activeSessionId) {
          console.warn("[OpenCode] No init_state received, showing welcome view")
          showWelcomeView()
        }
      }, 3000)

      // Store timeout so we can clear it when init_state is received
      window.__opencodeInitTimeout = initTimeout
    } catch (err) {
      console.error("[OpenCode] Initialization error:", err)
      const errorDiv = document.createElement("div")
      errorDiv.className = "error-boundary"
      errorDiv.textContent = "Failed to initialize. Please reload."
      document.body.appendChild(errorDiv)
    }
  }

  function showWelcomeView() {
    els.welcomeView.classList.remove("hidden")
    hideStatusStrip()
    renderRecentSessionsList()
    renderWelcomeContext()
    applyTimelineVisibility() // Force hide timeline
  }

  function hideWelcomeView() {
    els.welcomeView.classList.add("hidden")
  }

  function setupWelcomeActions() {
    els.welcomeNewBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "new_session" })
    })
    els.welcomeModelCtx?.addEventListener("click", () => {
      modelManager.open()
      vscode.postMessage({ type: "get_models" })
    })
    els.welcomeContinueBtn?.addEventListener("click", () => {
      const mostRecent = stateManager.getAllSessions()
        .filter((s) => s.messages.length > 0)
        .sort((a, b) => {
          const tA = a.messages[a.messages.length - 1]?.timestamp ?? 0
          const tB = b.messages[b.messages.length - 1]?.timestamp ?? 0
          return tB - tA
        })[0]
      if (mostRecent) {
        vscode.postMessage({ type: "resume_session", sessionId: mostRecent.id })
      }
    })
  }

  function renderWelcomeContext() {
    const globalModel = stateManager.getState().globalModel
    if (globalModel && els.welcomeModelName) {
      const parts = globalModel.split("/")
      els.welcomeModelName.textContent = parts[parts.length - 1] ?? globalModel
    }
    const hasSessions = stateManager.getAllSessions().some((s) => s.messages.length > 0)
    if (els.welcomeContinueBtn) {
      els.welcomeContinueBtn.classList.toggle("hidden", !hasSessions)
    }
  }

  /* ─── RECENT SESSIONS ─── */

  function renderRecentSessionsList() {
    const activeId = stateManager.getState().activeSessionId
    const sessions = stateManager.getAllSessions()
      .filter((s) => s.id !== activeId && s.messages.length > 0)
      .sort((a, b) => {
        const tA = a.messages[a.messages.length - 1]?.timestamp ?? 0
        const tB = b.messages[b.messages.length - 1]?.timestamp ?? 0
        return tB - tA
      })
      .slice(0, 3)
      .map((s) => ({
        id: s.id,
        title: s.name,
        time: s.messages[s.messages.length - 1]?.timestamp,
        messageCount: s.messages.length,
        cost: s.cost || 0,
      }))

    const recentContainer = document.getElementById("welcome-recent-sessions") as HTMLDivElement | null
    if (!recentContainer) return
    renderRecentSessions(
      sessions,
      recentContainer,
      () => vscode.postMessage({ type: "list_sessions" }),
      (sessionId) => {
        vscode.postMessage({ type: "resume_session", sessionId })
      }
    )
  }

  /* ─── SESSION HISTORY MODAL ─── */

  function setupSessionModal() {
    els.sessionModalClose.addEventListener("click", closeSessionModal)
    els.sessionModal.addEventListener("click", (e) => {
      if (e.target === els.sessionModal) closeSessionModal()
    })
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.sessionModal.classList.contains("hidden")) {
        closeSessionModal()
      }
    })
  }

  // State for the unified session modal — holds server sessions once they arrive
  // so renderUnifiedSessionList can merge local + server in one pass.
  type ServerSessionEntry = {
    id: string; title?: string; directory?: string; parentId?: string;
    created?: number; updated?: number; files?: number; additions?: number;
    deletions?: number; isCurrentWorkspace?: boolean
  }
  let _unifiedServerSessions: ServerSessionEntry[] | null = null
  let _unifiedLocalSessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }> = []

  function openSessionModal(sessions: Array<{ id: string; cliSessionId?: string; title?: string; messageCount?: number; cost?: number; time?: number }>) {
    _unifiedLocalSessions = sessions
    _unifiedServerSessions = null

    const body = els.sessionModalBody
    body.replaceChildren()

    // Single unified list — no LOCAL/SERVER tab switching
    const list = document.createElement("div")
    list.className = "modal-session-list"
    list.setAttribute("role", "listbox")
    list.setAttribute("aria-label", "Sessions")
    body.appendChild(list)

    // Show a loading placeholder while server sessions are fetched
    const loading = document.createElement("div")
    loading.className = "modal-empty"
    loading.textContent = "Loading sessions…"
    list.appendChild(loading)

    // Kick off the server session fetch; renderUnifiedSessionList will be called
    // again when the server_session_list message arrives.
    vscode.postMessage({ type: "list_server_sessions" })

    // Immediately render local-only sessions so the modal is not empty
    renderUnifiedSessionList()

    els.sessionModal.classList.remove("hidden")

    // Focus trap
    sessionModalLastFocus = document.activeElement as HTMLElement | null
    sessionModalFocusTrap = trapModalFocus(els.sessionModal)
    document.addEventListener("keydown", sessionModalFocusTrap)
    const firstBtn = els.sessionModal.querySelector<HTMLElement>("button, [href], input:not([type='hidden'])")
    if (firstBtn) firstBtn.focus()
  }

  /**
   * Render the unified session list inside the open modal.
   * Merges _unifiedLocalSessions and _unifiedServerSessions:
   * - Server session with matching local cliSessionId → "synced" (shown once)
   * - Server-only (no local counterpart) → "remote" badge
   * - Local-only (no cliSessionId or server not loaded) → shown with local data
   */
  function renderUnifiedSessionList() {
    const listContainer = els.sessionModalBody.querySelector<HTMLElement>(".modal-session-list")
    if (!listContainer) return
    listContainer.replaceChildren()

    // Build a map of server sessions keyed by their ID for O(1) lookup
    const serverById = new Map<string, ServerSessionEntry>()
    if (_unifiedServerSessions) {
      for (const s of _unifiedServerSessions) serverById.set(s.id, s)
    }

    // Track which server sessions have been claimed by a local entry
    const claimedServerIds = new Set<string>()

    // Build unified items list
    const items: Array<{
      type: "synced" | "local" | "remote"
      localId?: string
      serverId?: string
      title: string
      directory?: string
      isCurrentWorkspace?: boolean
      messageCount?: number
      time?: number
      cost?: number
      files?: number
    }> = []

    // Walk local sessions — match against server sessions by cliSessionId
    for (const local of _unifiedLocalSessions) {
      const server = local.cliSessionId ? serverById.get(local.cliSessionId) : undefined
      if (server) {
        claimedServerIds.add(server.id)
        items.push({
          type: "synced",
          localId: local.id,
          serverId: server.id,
          title: local.title || server.title || "Untitled",
          directory: server.directory,
          isCurrentWorkspace: server.isCurrentWorkspace,
          messageCount: local.messageCount,
          time: local.time ?? server.updated,
          cost: local.cost,
          files: server.files,
        })
      } else {
        items.push({
          type: "local",
          localId: local.id,
          title: local.title || "Untitled",
          messageCount: local.messageCount,
          time: local.time,
          cost: local.cost,
        })
      }
    }

    // Add server-only sessions (not claimed by any local entry)
    if (_unifiedServerSessions) {
      for (const server of _unifiedServerSessions) {
        if (!claimedServerIds.has(server.id)) {
          items.push({
            type: "remote",
            serverId: server.id,
            title: server.title || "Untitled",
            directory: server.directory,
            isCurrentWorkspace: server.isCurrentWorkspace,
            time: server.updated,
            files: server.files,
          })
        }
      }
    }

    if (items.length === 0) {
      const empty = document.createElement("div")
      empty.className = "modal-empty"
      empty.textContent = _unifiedServerSessions === null ? "Loading sessions…" : "No sessions."
      listContainer.appendChild(empty)
      return
    }

    // Sort by recency
    items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))

    for (const item of items) {
      const row = document.createElement("button")
      row.className = "modal-session-item"
      row.setAttribute("role", "option")
      row.setAttribute("aria-label", `Open session: ${item.title}`)
      if (item.serverId) row.dataset.serverId = item.serverId

      // Workspace badge
      const badge = document.createElement("span")
      badge.className = `session-workspace-badge ${item.type === "local" ? "local" : item.isCurrentWorkspace !== false ? "current" : "other"}`
      badge.setAttribute("aria-hidden", "true")
      row.appendChild(badge)

      const info = document.createElement("div")
      info.className = "modal-session-info"

      const nameEl = document.createElement("div")
      nameEl.className = "modal-session-name"
      nameEl.textContent = item.title
      info.appendChild(nameEl)

      const meta = document.createElement("div")
      meta.className = "modal-session-meta"
      const parts: string[] = []
      if (item.directory) parts.push(item.directory.split("/").pop() || item.directory)
      if (item.messageCount != null && item.messageCount > 0) parts.push(`${item.messageCount} msgs`)
      if (item.files != null && item.files > 0) parts.push(`${item.files} files`)
      if (item.time) parts.push(new Date(item.time).toLocaleDateString())
      meta.textContent = parts.join(" · ")
      info.appendChild(meta)

      row.appendChild(info)

      if (item.cost && item.cost > 0) {
        const costEl = document.createElement("span")
        costEl.className = "modal-session-cost"
        costEl.textContent = `$${item.cost.toFixed(2)}`
        row.appendChild(costEl)
      }

      const actions = document.createElement("div")
      actions.className = "modal-session-actions"

      // Click the row to open the session
      row.addEventListener("click", (e) => {
        // Don't open if clicking an action button
        if ((e.target as HTMLElement).closest(".modal-session-actions")) return
        closeSessionModal()
        if (item.type === "remote" && item.serverId) {
          vscode.postMessage({
            type: "resume_server_session",
            serverSessionId: item.serverId,
            title: item.title,
            directory: item.directory,
          })
        } else if (item.localId) {
          vscode.postMessage({ type: "resume_session", sessionId: item.localId })
        }
      })

      // Archive button (local sessions only)
      if (item.localId) {
        const archiveBtn = document.createElement("button")
        archiveBtn.className = "modal-session-archive icon-btn"
        archiveBtn.title = "Archive"
        archiveBtn.setAttribute("aria-label", "Archive session")
        archiveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>'
        archiveBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          vscode.postMessage({ type: "archive_session", targetSessionId: item.localId })
          row.remove()
        })
        actions.appendChild(archiveBtn)
      }

      // Delete button
      const deleteBtn = document.createElement("button")
      deleteBtn.className = "modal-session-delete icon-btn"
      deleteBtn.setAttribute("aria-label", item.type === "local" ? "Delete session" : "Delete server session")
      deleteBtn.title = item.type === "local" ? "Delete" : "Delete from server"
      deleteBtn.innerHTML = REMOVE_SVG
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        if (item.serverId) {
          vscode.postMessage({ type: "delete_server_session", serverSessionId: item.serverId })
        } else if (item.localId) {
          vscode.postMessage({ type: "delete_session", targetSessionId: item.localId })
        }
        row.remove()
      })
      actions.appendChild(deleteBtn)

      row.appendChild(actions)
      listContainer.appendChild(row)
    }
  }

  // Focus trap state for session modal
  let sessionModalFocusTrap: ((e: KeyboardEvent) => void) | null = null
  let sessionModalLastFocus: HTMLElement | null = null

  function trapModalFocus(container: HTMLElement): (e: KeyboardEvent) => void {
    return (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function closeSessionModal() {
    els.sessionModal.classList.add("hidden")
    if (sessionModalFocusTrap) {
      document.removeEventListener("keydown", sessionModalFocusTrap)
      sessionModalFocusTrap = null
    }
    if (sessionModalLastFocus) {
      sessionModalLastFocus.focus({ preventScroll: true })
      sessionModalLastFocus = null
    }
  }

  /* ─── TAB MANAGEMENT ─── */

  function createNewTab(name?: string) {
    const session = stateManager.createSession(name)
    createTabUI(session.id, session.name)
    
    // If no active session, switch to the first one
    if (!stateManager.getState().activeSessionId) {
      switchToTab(els, session.id)
    }

    updateTabBar()
    renderRecentSessionsList()
    return session
  }

  function createTabUI(tabId: string, tabName: string) {
    // Check if content already exists
    if (els.tabPanels.querySelector(`.tab-panel[data-tab-id="${tabId}"]`)) return

    const [view] = createTabContent(tabId, tabName)
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

    // Create stream handler for this tab
    const session = stateManager.getSession(tabId)
    if (session) {
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
  }

  function switchTab(tabId: string) {
    if (!stateManager.setActiveSession(tabId)) return
    switchToTab(els, tabId)
    vscode.postMessage({ type: "switch_tab", sessionId: tabId })
    syncModeUI()
    updateTabBar()
    // Sync model dropdown to active session's model
    const activeSession = stateManager.getActiveSession()
    if (activeSession?.model) {
      modelDropdown.setCurrentModel(activeSession.model)
    }
    
    // Refresh cost/token displays for the new tab
    updateCostDisplay(tabId)
    const session = stateManager.getSession(tabId)
    if (session?.tokenUsage) {
      updateTokenDisplay(session.tokenUsage)
    }
    // Refresh changed files list for the new tab
    if (session?.changedFiles) {
      renderChangedFilesList(session.changedFiles)
    }
    
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

    // Abort any streaming
    const stream = streamHandlers.get(tabId)
    if (stream) {
      stream.hideTypingIndicator()
    }

    // Soft close - keep in state but remove from UI
    stateManager.deleteSession(tabId)
    stateManager.flush()  // Ensure state is persisted
    removeTabContent(els, tabId)
    streamHandlers.delete(tabId)

    // Clear prompt queue for this tab
    const queue = promptQueues.get(tabId)
    if (queue) {
      queue.clear()
      promptQueues.delete(tabId)
    }
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
    tabBar.renderTabs(tabs, activeId)
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

  function updateModeDropdown(mode: string) {
    const labels: Record<string, string> = { plan: "Plan", auto: "Auto", build: "Build" }
    els.modeCurrentText.textContent = labels[mode] || mode
    els.modeDropdownBtn.dataset.mode = mode

    const iconSvg: string =
      mode === "plan"
        ? '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3v18"/><path d="M7 3v18"/><path d="M3 7.5h18"/><path d="M3 16.5h18"/><path d="M17 3a2 2 0 0 1 2 2"/><path d="M17 21a2 2 0 0 0 2-2"/><path d="M7 3a2 2 0 0 0-2 2"/><path d="M7 21a2 2 0 0 1-2-2"/></svg>'
        : mode === "auto"
          ? '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
          : '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
    const iconEl = els.modeDropdownLabel.querySelector(".mode-icon") as HTMLElement | null
    if (iconEl) {
      iconEl.outerHTML = iconSvg
    }

    for (const key of ["plan", "auto", "build"]) {
      const opt = els[`modeOpt${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof els] as HTMLButtonElement
      const isSelected = key === mode
      opt.setAttribute("aria-selected", String(isSelected))
      opt.classList.toggle("selected", isSelected)
    }
  }

  function closeModeDropdown() {
    els.modeDropdownBtn.setAttribute("aria-expanded", "false")
    els.modeDropdownMenu.classList.add("hidden")
  }

  function updateModeSelectorState() {
    const active = stateManager.getActiveSession()
    const isStreaming = Boolean(active?.isStreaming)
    els.modeDropdown.classList.toggle('disabled', isStreaming)
    els.modeDropdownBtn.disabled = isStreaming
    els.modeDropdownBtn.setAttribute("aria-disabled", String(isStreaming))

    const buttons = [els.modeOptPlan, els.modeOptAuto, els.modeOptBuild]
    for (const btn of buttons) {
      btn.disabled = isStreaming
      btn.setAttribute("aria-disabled", String(isStreaming))
    }

    if (isStreaming) closeModeDropdown()
  }

  function toggleModeDropdown() {
    const active = stateManager.getActiveSession()
    if (active?.isStreaming) return

    const isOpen = els.modeDropdownMenu.classList.contains("hidden")
    if (isOpen) {
      els.modeDropdownMenu.classList.remove("hidden")
      els.modeDropdownBtn.setAttribute("aria-expanded", "true")
      // Focus the active option
      const activeOpt = els.modeDropdownMenu.querySelector('[aria-selected="true"]') as HTMLElement | null
      if (activeOpt) activeOpt.focus()
    } else {
      closeModeDropdown()
    }
  }

  function setMode(mode: string) {
    if (currentMode === mode) {
      closeModeDropdown()
      return
    }
    currentMode = mode
    updateModeDropdown(mode)
    closeModeDropdown()

    const active = stateManager.getActiveSession()
    if (active) {
      stateManager.setSessionMode(active.id, mode)
      vscode.postMessage({ type: "change_mode", mode, sessionId: active.id })
    }
  }

  function setupModeToggle() {
    els.modeDropdownBtn.addEventListener("click", toggleModeDropdown)

    // Keyboard navigation within the dropdown
    els.modeDropdownBtn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        if (els.modeDropdownMenu.classList.contains("hidden")) {
          toggleModeDropdown()
        }
      }
    })

    // Option click handlers
    const options = [els.modeOptPlan, els.modeOptAuto, els.modeOptBuild]
    for (const opt of options) {
      opt.addEventListener("click", () => {
        const mode = opt.dataset.mode
        if (!mode) return

        const active = stateManager.getActiveSession()
        if (active?.isStreaming) return

        // Only show warning when switching from Plan mode
        if (currentMode === "plan" && mode === "auto") {
          showAutoModeWarning()
          return
        }

        setMode(mode)
      })

      // Keyboard support for option selection
      opt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          opt.click()
        }
        if (e.key === "Escape") {
          closeModeDropdown()
          els.modeDropdownBtn.focus()
        }
        if (e.key === "ArrowDown") {
          e.preventDefault()
          const next = opt.nextElementSibling as HTMLElement | null
          if (next) next.focus()
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          const prev = opt.previousElementSibling as HTMLElement | null
          if (prev) prev.focus()
        }
      })
    }

    // Close on outside click
    document.addEventListener("click", (e) => {
      const target = e.target as Node
      if (!els.modeDropdown.contains(target)) {
        closeModeDropdown()
      }
    })
  }

  function syncModeUI() {
    const active = stateManager.getActiveSession()
    const rawMode = active?.mode || "plan"
    currentMode = rawMode === "normal" ? "build" : rawMode
    updateModeDropdown(currentMode)
    updateModeSelectorState()
  }

  /* ─── AUTO MODE WARNING ─── */

  let pendingAutoMode: string | null = null

  function showAutoModeWarning() {
    pendingAutoMode = "auto"
    els.modeWarningTitle.textContent = "Switch to Auto mode?"
    els.modeWarningDescription.textContent =
      "Auto mode will allow the agent to apply changes without asking. The agent will have full autonomy to read, write, and execute commands. Use with caution."
    els.modeWarningModal.classList.remove("hidden")
    const firstBtn = els.modeWarningModal.querySelector<HTMLElement>("button")
    if (firstBtn) firstBtn.focus()
  }

  function closeModeWarning() {
    els.modeWarningModal.classList.add("hidden")
    pendingAutoMode = null
  }

  function setupModeWarning() {
    els.modeWarningCancel.addEventListener("click", closeModeWarning)
    els.modeWarningConfirm.addEventListener("click", () => {
      if (pendingAutoMode) {
        const dontShow = els.modeWarningDontShow.checked
        if (dontShow) {
          vscode.postMessage({ type: "update_setting", key: "skipModeWarning", value: true })
        }
        setMode(pendingAutoMode)
        pendingAutoMode = null
      }
      els.modeWarningModal.classList.add("hidden")
    })
    els.modeWarningModal.addEventListener("click", (e) => {
      if (e.target === els.modeWarningModal) closeModeWarning()
    })
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.modeWarningModal.classList.contains("hidden")) {
        closeModeWarning()
      }
    })
  }

  /* ─── INPUT ─── */

  function setupInput() {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    els.promptInput.addEventListener("paste", onPaste)
    els.sendBtn.addEventListener("click", sendMessage)
    els.mentionBtn.addEventListener("click", () => {
      els.promptInput.value += "@"
      els.promptInput.focus()
      mention.handleTrigger()
    })

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
        const mentions = Array.from(files)
          .map((f) => {
            const relPath = (f as any).webkitRelativePath || f.name
            return `@file:${relPath}`
          })
          .join(" ")
        insertTextAtCursor(mentions)
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
        sendMessage()
        // Visual feedback for shortcut
        els.sendBtn?.classList.add("active-feedback")
        setTimeout(() => els.sendBtn?.classList.remove("active-feedback"), 200)
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
    }

    if (!els.mentionDropdown.classList.contains("hidden")) {
      mention.handleKeydown(e)
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    const active = stateManager.getActiveSession()
    if (!active) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.type.startsWith("image/")) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          if (!result) return
          const base64Match = result.match(/^data:(image\/\w+);base64,(.+)$/)
          if (base64Match && base64Match[1] && base64Match[2]) {
            pendingAttachments.push({
              data: base64Match[2],
              mimeType: base64Match[1],
            })
	            renderAttachmentChips()
	            updatePromptContextChips()
	            updateSendButton()
          }
        }
        reader.onerror = () => {
          console.error("[OpenCode] Failed to read pasted image")
        }
        reader.readAsDataURL(blob)
        break
      }
    }
  }

  function renderAttachmentChips() {
    const existing = els.inputArea.querySelector(".attachment-chips")
    if (existing) existing.remove()

	    if (pendingAttachments.length === 0) {
	      updatePromptContextChips()
	      return
	    }

    const container = document.createElement("div")
    container.className = "attachment-chips"

    pendingAttachments.forEach((att, idx) => {
      const chip = document.createElement("div")
      chip.className = "attachment-chip"
      const thumbnail = document.createElement("img")
      thumbnail.src = `data:${att.mimeType};base64,${att.data}`
      thumbnail.alt = "Attached image"
      chip.appendChild(thumbnail)
      const remove = document.createElement("button")
      remove.className = "attachment-chip-remove"
      remove.title = "Remove attachment"
      remove.setAttribute("aria-label", "Remove attachment")
      remove.innerHTML = REMOVE_SVG
      remove.addEventListener("click", () => {
	        pendingAttachments.splice(idx, 1)
	        renderAttachmentChips()
	        updatePromptContextChips()
	        updateSendButton()
	      })
      chip.appendChild(remove)
      container.appendChild(chip)
    })

	    els.inputArea.insertBefore(container, els.inputWrapper)
	    updatePromptContextChips()
	  }

	  function updatePromptContextChips() {
	    const mentions = parsePromptMentions(els.promptInput.value)
	    const chips: ContextChip[] = mentions.map((mention) => ({
	      label: mention.label,
	      kind: mention.kind,
	      removable: true,
	      onRemove: () => {
	        els.promptInput.value = removePromptToken(els.promptInput.value, mention.token)
	        autoResizeTextarea()
	        updatePromptContextChips()
	        updateSendButton()
	        els.promptInput.focus()
	      },
	    }))

	    if (pendingAttachments.length > 0) {
	      chips.push({
	        label: pendingAttachments.length === 1 ? "1 image attached" : `${pendingAttachments.length} images attached`,
	        kind: "file",
	        removable: false,
	      })
	    }

	    updateContextChips(els, chips)
	  }

	  function parsePromptMentions(text: string): Array<{ token: string; label: string; kind: string }> {
	    const pattern = /@(file|folder|url|problems|terminal):(?:"[^"]+"|'[^']+'|\S+)/g
	    const seen = new Set<string>()
	    const matches: Array<{ token: string; label: string; kind: string }> = []
	    for (const match of text.matchAll(pattern)) {
	      const token = match[0]
	      if (!token || seen.has(token)) continue
	      seen.add(token)
	      matches.push({ token, label: token, kind: match[1] || "file" })
	    }
	    return matches
	  }

	  function removePromptToken(text: string, token: string): string {
	    return text.replace(token, "").replace(/[ \t]{2,}/g, " ").trimStart()
	  }

  function autoResizeTextarea() {
    if (!els.promptInput) return
    const el = els.promptInput
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0
    const hasAttachments = pendingAttachments.length > 0
    const active = stateManager.getActiveSession()
    const isStreaming = active?.isStreaming || false
    // Button remains enabled during streaming so it can be used as a stop button
    ;(els.sendBtn as HTMLButtonElement).disabled = !hasText && !hasAttachments && !isStreaming
    updateSendButtonIcon(isStreaming)
    updateModeSelectorState()
  }

  function updateSendButtonIcon(isStreaming?: boolean) {
    const active = stateManager.getActiveSession()
    const streaming = isStreaming ?? active?.isStreaming ?? false
    if (streaming) {
      els.sendBtn?.classList.add("stopping")
      els.sendBtn?.setAttribute("aria-label", "Stop generation")
      els.sendBtn?.setAttribute("title", "Stop generation")
    } else {
      els.sendBtn?.classList.remove("stopping")
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

  function enqueuePrompt(text: string) {
    const active = stateManager.getActiveSession()
    if (!active) return
    let queue = promptQueues.get(active.id)
    if (!queue) {
      queue = createPromptQueue()
      promptQueues.set(active.id, queue)
    }
    const atts = pendingAttachments.splice(0)
    renderAttachmentChips()
    queue.enqueue(text, atts)
    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()
    renderQueue(active.id)
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
      els.inputArea.insertBefore(queueContainer, els.inputWrapper)
    }
    queueContainer.replaceChildren()
    const items = queue.getItems()
    const queuedCount = items.filter((i) => i.state === "queued").length

    // Queue header with count and clear-all
    const headerRow = document.createElement("div")
    headerRow.className = "queue-header"
    const countLabel = document.createElement("span")
    countLabel.className = "queue-count"
    countLabel.textContent = `${items.length} queued`
    headerRow.appendChild(countLabel)
    if (queuedCount > 1) {
      const clearAllBtn = document.createElement("button")
      clearAllBtn.className = "queue-clear-all"
      clearAllBtn.textContent = "Clear all"
      clearAllBtn.setAttribute("aria-label", `Clear ${queuedCount} queued prompts`)
      clearAllBtn.addEventListener("click", () => {
        for (const item of items) {
          if (item.state === "queued") queue.remove(item.id)
        }
        renderQueue(tabId)
      })
      headerRow.appendChild(clearAllBtn)
    }
    queueContainer.appendChild(headerRow)

    for (const item of items) {
      const chip = document.createElement("div")
      chip.className = `queue-chip queue-chip--${item.state}`
      chip.dataset.queueId = item.id

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
          renderQueue(tabId)
        })
        chip.appendChild(retryBtn)

        const removeBtn2 = document.createElement("button")
        removeBtn2.className = "queue-chip-remove icon-btn"
        removeBtn2.setAttribute("aria-label", "Remove failed prompt")
        removeBtn2.innerHTML = REMOVE_SVG
        removeBtn2.addEventListener("click", () => {
          queue.remove(item.id)
          renderQueue(tabId)
        })
        chip.appendChild(removeBtn2)
      }

      queueContainer.appendChild(chip)
    }
    updateQueueSendButton()
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

  function sendMessage() {
    const text = els.promptInput.value.trim()
    let active = stateManager.getActiveSession()

    if (active?.isStreaming) {
      // Send button acts as stop button when streaming
      abortStream()
      return
    }

    if (!text && pendingAttachments.length === 0) return

    if (!active) {
      // Create a new session lazily, named from the first message
      const title = generateTitle(text) || "New Chat"
      active = createNewTab(title)
      hideWelcomeView()
    }

    // Ensure tab UI exists for this session
    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${active.id}"]`)) {
      createTabUI(active.id, active.name)
      switchToTab(els, active.id)
      updateTabBar()
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
        case "/compact":
          vscode.postMessage({ type: "compact_session", sessionId: active.id })
          showSystemMessage(active.id, "Compacting session...")
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/commands":
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

    // Check concurrent streaming limit
    const streamingCount = stateManager.getAllSessions().filter((s) => s.isStreaming).length
    if (streamingCount >= 3) {
      const streamingNames = stateManager.getAllSessions()
        .filter((s) => s.isStreaming)
        .map((s) => `"${s.name}"`)
        .join(", ")
      handleRequestError(active.id, `Maximum 3 concurrent streams reached. Currently streaming: ${streamingNames}`)
      return
    }

    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()

    const msgObj: ChatMessage = {
      role: "user",
      id: "user-" + crypto.randomUUID(),
      blocks: [
        ...(text ? [{ type: "text", text }] : []),
        ...pendingAttachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
      ],
      timestamp: Date.now(),
      sessionId: active.id,
    }

    const attachments = pendingAttachments
    pendingAttachments = []
    renderAttachmentChips()

    addMessage(active.id, msgObj)
    stateManager.setStreaming(active.id, true)
    updateTabBar()
    updateModeSelectorState()
    updateSendButton()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    const sendModel = active.model || modelDropdown.getCurrentModel()
    if (!sendModel) {
      handleRequestError(active.id, "No model selected. Please select a model to continue.")
      return
    }

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
    updateModeSelectorState()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.hideTypingIndicator()

    updateSendButtonIcon(false)
    updateSendButton()

    vscode.postMessage({ type: "abort", sessionId: active.id })
  }

  /* ─── BUTTONS ─── */

  function setupButtons() {
    // NOTE: newTabBtn click is handled by createTabBar in tabs.ts
    // to avoid duplicate listeners. Do NOT add another listener here.
    
    els.historyBtn.addEventListener("click", () => {
      els.sessionModal.classList.remove("hidden")
      els.sessionModalBody.innerHTML = '<div class="modal-empty">Loading sessions...</div>'
      vscode.postMessage({ type: "list_sessions" })
    })
    
    els.mcpBtn.addEventListener("click", () => {
      closeSettingsMenu()
      mcpConfig.open()
      vscode.postMessage({ type: "open_mcp_config" })
    })

    els.themeCustomizerBtn.addEventListener("click", () => {
      closeSettingsMenu()
      openThemeCustomizer()
    })

    els.settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const isExpanded = els.settingsBtn.getAttribute("aria-expanded") === "true"
      els.settingsBtn.setAttribute("aria-expanded", String(!isExpanded))
      els.settingsMenu.classList.toggle("hidden", isExpanded)
    })

    document.addEventListener("click", (e) => {
      if (
        !els.settingsMenu.classList.contains("hidden") &&
        !els.settingsMenu.contains(e.target as Node) &&
        e.target !== els.settingsBtn
      ) {
        closeSettingsMenu()
      }
    })

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.settingsMenu.classList.contains("hidden")) {
        closeSettingsMenu()
        els.settingsBtn.focus()
      }
    })

    // Toggle checkpoint panel
    const checkpointToggle = document.getElementById("checkpoint-toggle-btn")
    checkpointToggle?.addEventListener("click", () => {
      const panel = els.checkpointPanel
      if (!panel) return
      const showing = !panel.classList.contains("hidden")
      panel.classList.toggle("hidden", showing)
      checkpointToggle.setAttribute("aria-pressed", String(!showing))
    })

    // Toggle changed files list
    const filesToggle = document.getElementById("files-toggle-btn")
    filesToggle?.addEventListener("click", () => {
      els.changedFilesList?.classList.toggle("hidden")
      // Request checkpoint list when showing panel
      if (!els.changedFilesList?.classList.contains("hidden")) {
        const sessionId = stateManager.getState().activeSessionId
        if (sessionId) {
          vscode.postMessage({ type: "list_checkpoints", sessionId })
        }
      }
    })

    els.attachBtn?.addEventListener("click", () => {
       vscode.postMessage({ type: "attach_files" })
     })
   }

  function closeSettingsMenu() {
    els.settingsMenu.classList.add("hidden")
    els.settingsBtn.setAttribute("aria-expanded", "false")
  }

  type ThemeCustomizerConfig = {
    preset?: string
    overrides?: Record<string, string>
  }

  type RateLimitWebviewState = {
    provider?: string
    remainingTokens?: number
    limitTokens?: number
    remainingRequests?: number
    limitRequests?: number
    usedTokens?: number
    usedCost?: number
    resetAt?: string
    lastUpdated?: string
  }

  let activePreset = "cli-default"

  function getThemeFields(): Array<{ input: HTMLInputElement; key: string }> {
    return Array.from(
      els.themeCustomizerPanel.querySelectorAll<HTMLInputElement>("input[data-theme-field]")
    ).map((input) => ({ input, key: input.dataset.themeField! }))
  }

  function setupThemeCustomizer() {
    els.themeCustomizerClose.addEventListener("click", closeThemeCustomizer)
    els.themeCustomizerPanel.addEventListener("click", (event) => {
      if (event.target === els.themeCustomizerPanel) closeThemeCustomizer()
    })
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.themeCustomizerPanel.classList.contains("hidden")) {
        closeThemeCustomizer()
      }
    })

    // Preset card selection
    els.themePresetCards.addEventListener("click", (event) => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]")
      if (!card) return
      const preset = card.dataset.preset!
      activePreset = preset
      els.themePresetCards.querySelectorAll("[data-preset]").forEach((c) => {
        c.setAttribute("aria-pressed", c === card ? "true" : "false")
      })
      // Clear overrides and apply new preset immediately
      getThemeFields().forEach((f) => { f.input.value = "" })
      syncAllColorPickers()
      updatePreviewSwatch()
      vscode.postMessage({ type: "update_theme_config", theme: { preset, overrides: {} } })
    })

    // CLI theme search — request list on first focus
    let cliListLoaded = false
    els.themeCliSearch.addEventListener("focus", () => {
      if (!cliListLoaded) {
        cliListLoaded = true
        vscode.postMessage({ type: "list_cli_themes" })
      }
      els.themeCliList.classList.remove("hidden")
    })
    els.themeCliSearch.addEventListener("input", () => {
      filterCliList(els.themeCliSearch.value.trim().toLowerCase())
    })
    document.addEventListener("click", (event) => {
      if (!els.themeCliSearch.contains(event.target as Node) && !els.themeCliList.contains(event.target as Node)) {
        els.themeCliList.classList.add("hidden")
      }
    })

    // Sync color picker → text input
    els.themeCustomizerPanel.addEventListener("input", (event) => {
      const picker = event.target as HTMLInputElement
      if (picker.type !== "color" || !picker.dataset.target) return
      const textInput = document.getElementById(picker.dataset.target) as HTMLInputElement | null
      if (textInput) {
        textInput.value = picker.value
        updatePreviewSwatch()
      }
    })

    // Sync text input → color picker (hex only)
    els.themeCustomizerPanel.addEventListener("change", (event) => {
      const textInput = event.target as HTMLInputElement
      if (textInput.type !== "text" || !textInput.id) return
      const picker = els.themeCustomizerPanel.querySelector<HTMLInputElement>(
        `input[type="color"][data-target="${textInput.id}"]`
      )
      if (picker && /^#[0-9a-fA-F]{6}$/.test(textInput.value.trim())) {
        picker.value = textInput.value.trim()
      }
      updatePreviewSwatch()
    })

    els.themeCustomizerSave.addEventListener("click", () => {
      vscode.postMessage({ type: "update_theme_config", theme: collectThemeCustomizerConfig() })
      closeThemeCustomizer()
    })

    els.themeCustomizerReset.addEventListener("click", () => {
      getThemeFields().forEach((f) => { f.input.value = "" })
      syncAllColorPickers()
      updatePreviewSwatch()
      vscode.postMessage({ type: "update_theme_config", theme: { preset: activePreset, overrides: {} } })
    })
  }

  function filterCliList(query: string) {
    const rows = els.themeCliList.querySelectorAll<HTMLButtonElement>("[data-cli-theme]")
    rows.forEach((row) => {
      const name = (row.dataset.cliTheme ?? "").toLowerCase()
      row.style.display = !query || name.includes(query) ? "" : "none"
    })
  }

  function populateCliList(themes: Array<{ name: string; source: string }>) {
    els.themeCliList.innerHTML = ""
    if (themes.length === 0) {
      const empty = document.createElement("div")
      empty.className = "theme-cli-empty"
      empty.textContent = "No CLI themes found. Add .json files to ~/.config/opencode/themes/"
      els.themeCliList.appendChild(empty)
      return
    }
    for (const theme of themes) {
      const btn = document.createElement("button")
      btn.className = "theme-cli-row"
      btn.dataset.cliTheme = theme.name
      btn.setAttribute("role", "option")
      btn.innerHTML = `<span class="theme-cli-name">${theme.name}</span><span class="theme-cli-source">${theme.source}</span>`
      btn.addEventListener("click", () => {
        els.themeCliSearch.value = theme.name
        els.themeCliList.classList.add("hidden")
        // Apply the CLI theme via cli-default preset (ThemeManager picks it up from tui.json)
        activePreset = "cli-default"
        els.themePresetCards.querySelectorAll("[data-preset]").forEach((c) => {
          c.setAttribute("aria-pressed", (c as HTMLElement).dataset.preset === "cli-default" ? "true" : "false")
        })
        vscode.postMessage({ type: "update_theme_config", theme: { preset: "cli-default", overrides: {} } })
      })
      els.themeCliList.appendChild(btn)
    }
  }

  function syncAllColorPickers() {
    getThemeFields().forEach(({ input }) => {
      const picker = els.themeCustomizerPanel.querySelector<HTMLInputElement>(
        `input[type="color"][data-target="${input.id}"]`
      )
      if (picker && /^#[0-9a-fA-F]{6}$/.test(input.value.trim())) {
        picker.value = input.value.trim()
      }
    })
  }

  function updatePreviewSwatch() {
    const fields = getThemeFields()
    const overrides: Record<string, string> = {}
    fields.forEach(({ input, key }) => {
      if (input.value.trim()) overrides[key] = input.value.trim()
    })
    const swatch = els.themePreviewSwatch
    const set = (v: string | undefined, prop: string) => {
      if (v) swatch.style.setProperty(prop, v)
      else swatch.style.removeProperty(prop)
    }
    set(overrides.userMessageBg, "--oc-user-msg-bg")
    set(overrides.userMessageFg, "--oc-user-msg-fg")
    set(overrides.assistantMessageBg, "--oc-assistant-msg-bg")
    set(overrides.assistantMessageFg, "--oc-assistant-msg-fg")
    set(overrides.panelBg, "--oc-bg")
    set(overrides.panelFg, "--oc-fg")
    set(overrides.accentColor, "--oc-accent")
    set(overrides.syntaxKeyword, "--oc-syn-keyword")
    set(overrides.syntaxString, "--oc-syn-string")
  }

  function openThemeCustomizer() {
    els.themeCustomizerPanel.classList.remove("hidden")
    vscode.postMessage({ type: "get_theme_config" })
    els.themePresetCards.querySelector<HTMLButtonElement>("[data-preset]")?.focus()
  }

  function closeThemeCustomizer() {
    els.themeCustomizerPanel.classList.add("hidden")
    els.themeCustomizerBtn.focus()
  }

  function collectThemeCustomizerConfig(): ThemeCustomizerConfig {
    const overrides: Record<string, string> = {}
    getThemeFields().forEach(({ input, key }) => {
      const value = input.value.trim()
      if (value) overrides[key] = value
    })
    return { preset: activePreset, overrides }
  }

  function applyThemeCustomizerConfig(theme: ThemeCustomizerConfig | undefined) {
    activePreset = theme?.preset || "cli-default"
    const overrides = theme?.overrides || {}
    els.themePresetCards.querySelectorAll("[data-preset]").forEach((card) => {
      card.setAttribute("aria-pressed", (card as HTMLElement).dataset.preset === activePreset ? "true" : "false")
    })
    getThemeFields().forEach(({ input, key }) => {
      input.value = typeof overrides[key] === "string" ? (overrides[key] as string) : ""
    })
    syncAllColorPickers()
    updatePreviewSwatch()
  }

  /* ─── WELCOME ─── */

  function setupWelcomeSuggestions() {
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement
      const card = target.closest(".suggestion-card") as HTMLButtonElement
      if (card && card.dataset.prompt) {
        els.promptInput.value = card.dataset.prompt
        autoResizeTextarea()
        updateSendButton()
        els.promptInput.focus()
      }
    })
  }

  /* ─── SEARCH ─── */

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchCurrentIndex = -1
  let searchTotalMatches = 0

  function setupSearch() {
    const searchBar = document.getElementById("chat-search-bar") as HTMLDivElement
    const searchInput = document.getElementById("chat-search-input") as HTMLInputElement
    const searchPrev = document.getElementById("chat-search-prev")
    const searchNext = document.getElementById("chat-search-next")
    const searchClose = document.getElementById("chat-search-close")
    const searchCount = document.getElementById("chat-search-count") as HTMLSpanElement

    if (!searchBar || !searchInput || !searchPrev || !searchNext || !searchClose || !searchCount) return

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault()
        searchBar.classList.remove("hidden")
        searchInput.focus()
        searchInput.select()
        return
      }

      if (searchBar.classList.contains("hidden")) return

      if (e.key === "Escape") {
        closeSearch(searchBar)
        return
      }

      if (e.key === "Enter" && document.activeElement === searchInput) {
        e.preventDefault()
        navigateSearch(e.shiftKey ? -1 : 1, searchCount)
        return
      }
    })

    searchInput.addEventListener("input", () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      searchDebounceTimer = setTimeout(() => performSearch(searchInput.value, searchCount), 200)
    })

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        closeSearch(searchBar)
      }
    })

    searchPrev.addEventListener("click", () => navigateSearch(-1, searchCount))
    searchNext.addEventListener("click", () => navigateSearch(1, searchCount))
    searchClose.addEventListener("click", () => closeSearch(searchBar))
  }

  function closeSearch(searchBar: HTMLDivElement) {
    searchBar.classList.add("hidden")
    clearSearchHighlights()
    searchCurrentIndex = -1
    searchTotalMatches = 0
  }

  function updateSearchCount(current: number, total: number, el?: HTMLSpanElement) {
    const span = el || document.getElementById("chat-search-count") as HTMLSpanElement
    if (span) {
      span.textContent = total > 0 ? `${current + 1} of ${total}` : ""
    }
  }

  function clearSearchHighlights() {
    document.querySelectorAll(".chat-search-highlight").forEach((mark) => {
      const parent = mark.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark)
        parent.normalize()
      }
    })
  }

  function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function highlightTextNodes(root: Element, regex: RegExp): number {
    let count = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const el = node.parentElement
        if (el && (el.tagName === "MARK" || el.tagName === "SCRIPT" || el.tagName === "STYLE")) {
          return NodeFilter.FILTER_REJECT
        }
        return regex.test(node.textContent || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })

    const replacements: Array<{ node: Text; frag: DocumentFragment }> = []
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      let text = textNode.textContent || ""
      regex.lastIndex = 0
      const frag = document.createDocumentFragment()
      let lastIdx = 0
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)))
        }
        const mark = document.createElement("mark")
        mark.className = "chat-search-highlight"
        mark.textContent = match[0]
        frag.appendChild(mark)
        count++
        lastIdx = regex.lastIndex
        if (match[0].length === 0) break
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)))
      }
      if (frag.childNodes.length > 0) {
        replacements.push({ node: textNode, frag })
      }
    }

    replacements.forEach(({ node, frag }) => {
      node.parentNode?.replaceChild(frag, node)
    })
    return count
  }

  function performSearch(query: string, countEl?: HTMLSpanElement) {
    clearSearchHighlights()
    searchCurrentIndex = -1
    searchTotalMatches = 0

    if (!query.trim()) {
      updateSearchCount(0, 0, countEl)
      return
    }

    const activePanel = els.tabPanels.querySelector(".tab-panel.active")
    if (!activePanel) {
      updateSearchCount(0, 0, countEl)
      return
    }

    const elements = activePanel.querySelectorAll(".message-bubble, .code-block-content, .msg-text")
    const regex = new RegExp(escapeRegExp(query), "gi")
    let total = 0
    elements.forEach((el) => {
      total += highlightTextNodes(el, regex)
    })

    searchTotalMatches = total
    if (total > 0) {
      navigateToMatch(0, countEl)
    } else {
      updateSearchCount(0, 0, countEl)
    }
  }

  function navigateSearch(direction: number, countEl?: HTMLSpanElement) {
    if (searchTotalMatches === 0) return
    const marks = document.querySelectorAll(".chat-search-highlight")
    if (marks.length === 0) return

    marks.forEach((m) => m.classList.remove("current"))

    if (searchCurrentIndex < 0) {
      searchCurrentIndex = direction > 0 ? 0 : marks.length - 1
    } else {
      searchCurrentIndex = (searchCurrentIndex + direction + marks.length) % marks.length
    }

    const currentMark = marks[searchCurrentIndex] as HTMLElement
    if (currentMark) {
      currentMark.classList.add("current")
      currentMark.scrollIntoView({ behavior: "smooth", block: "center" })
    }
    updateSearchCount(searchCurrentIndex, searchTotalMatches, countEl)
  }

  function navigateToMatch(index: number, countEl?: HTMLSpanElement) {
    const marks = document.querySelectorAll(".chat-search-highlight")
    if (marks.length === 0 || index >= marks.length) return

    marks.forEach((m) => m.classList.remove("current"))
    searchCurrentIndex = index
    const mark = marks[index] as HTMLElement
    if (mark) {
      mark.classList.add("current")
      mark.scrollIntoView({ behavior: "smooth", block: "center" })
    }
    updateSearchCount(index, searchTotalMatches, countEl)
  }

  /* ─── MESSAGES ─── */

  function showSystemMessage(sessionId: string, text: string, retryable?: boolean) {
    const msg: ChatMessage = {
      role: "system",
      id: "sys-" + crypto.randomUUID(),
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

  const updateScrollMarkers = (sessionId: string) => {
    const msgList = getMessageList(sessionId)
    if (!msgList) return
    const session = stateManager.getSession(sessionId)
    if (!session) return

    let markersEl = msgList.querySelector(".scroll-markers") as HTMLElement | null
    if (!markersEl) {
      markersEl = document.createElement("div")
      markersEl.className = "scroll-markers"
      markersEl.dataset.tabId = sessionId
      msgList.appendChild(markersEl)
    }

    markersEl.replaceChildren()
    const totalHeight = msgList.scrollHeight || 1
    // Only show markers if there's meaningful scroll content
    if (session.messages.length < 3) return

    session.messages.forEach((m) => {
      if (m.role !== "user" || !m.id) return
      const msgEl = msgList.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`) as HTMLElement | null
      if (!msgEl) return
      const offsetTop = msgEl.offsetTop
      const ratio = Math.min(1, Math.max(0, offsetTop / totalHeight))
      const dot = document.createElement("div")
      dot.className = "scroll-marker-dot"
      dot.style.top = `calc(${ratio * 100}% - 2px)`
      const firstText = m.blocks?.find((b) => b.type === "text")
      dot.title = (firstText?.text as string)?.slice(0, 60) || "User message"
      dot.addEventListener("click", () => {
        msgEl.scrollIntoView({ behavior: "smooth", block: "center" })
        msgEl.classList.add("message-flash")
        setTimeout(() => msgEl.classList.remove("message-flash"), 1500)
      })
      markersEl.appendChild(dot)
    })
  }

  const setupJumpToBottom = (sessionId: string) => {
    const msgList = getMessageList(sessionId)
    if (!msgList) return
    const existing = msgList.parentElement?.querySelector(".jump-to-bottom")
    if (existing) existing.remove()
    const btn = document.createElement("button")
    btn.className = "jump-to-bottom"
    btn.dataset.tabId = sessionId
    btn.textContent = "↓ Latest"
    btn.setAttribute("aria-label", "Jump to latest message")
    const onScroll = () => {
      const threshold = 300
      const isNearBottom = msgList.scrollHeight - (msgList.scrollTop + msgList.clientHeight) < threshold
      btn.classList.toggle("visible", !isNearBottom)
    }
    btn.addEventListener("click", () => {
      msgList.scrollTo({ top: msgList.scrollHeight, behavior: "smooth" })
      btn.classList.remove("visible")
    })
    msgList.parentElement?.appendChild(btn)
    msgList.addEventListener("scroll", onScroll, { passive: true })
    // Evaluate initial scroll position so the button isn't shown when already at bottom
    onScroll()
  }

  function addMessage(sessionId: string, msg: ChatMessage) {
    const session = stateManager.getSession(sessionId)
    if (!session) return

    session.messages.push(msg)

    // Auto-generate title from first user message
    if (msg.role === "user" && (session.name === "Default" || session.name.startsWith("Session "))) {
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
        const el = renderMessage(msg, { mode: session.mode, postMessage: (m) => vscode.postMessage(m) })
        existing.replaceWith(el)
        return
      }

      const welcome = msgList.querySelector(".welcome-container")
      if (welcome) welcome.remove()

      const start = Date.now()
      const el = renderMessage(msg, { mode: session.mode, postMessage: (m) => vscode.postMessage(m) })
      const elapsed = Date.now() - start
      if (elapsed > 50) {
        if ((window as any).__opencodeDebug) {
          console.debug(`[perf] renderMessage took ${elapsed}ms for ${msg.role} msg ${msg.id?.slice(0, 16)}`)
        }
      }
      msgList.appendChild(el)
      const vl = getVirtualList(sessionId)
      if (vl) vl.onMessageAdded(el)
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
    type MsgHandler = (msg: HostMessage, sessionId: string | undefined) => void

    const messageHandlers = new Map<string, MsgHandler>([
      ["message", (msg) => { if (msg.message) handleHostMessage(msg.message) }],
      ["stream_start", (_msg, sid) => { if (sid) handleStreamStart(sid, _msg.messageId as string) }],
      ["stream_chunk", (_msg, sid) => { if (sid) handleStreamChunk(sid, _msg.text as string) }],
      ["stream_end", (_msg, sid) => { if (sid) handleStreamEnd(sid, _msg.messageId as string, _msg.blocks, _msg.reason as string | undefined, Boolean(_msg.partial)) }],
      ["stream_ping", (_msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          const seq = Number(_msg.seq || 0)
          const lastChunkSeq = stream ? (stream as any).state?.chunkSeq ?? 0 : 0
          vscode.postMessage({ type: "stream_ack", sessionId: sid, seq, lastRenderedChunkSeq: lastChunkSeq })
        }
      }],
      ["force_rerender", (_msg, sid) => {
        if (sid && typeof _msg.text === "string") {
          const stream = streamHandlers.get(sid)
          if (stream && (stream as any).state) {
            const state = (stream as any).state
            state.currentBlockBuffer = _msg.text
            const textEl = state.currentBlockEl || state.lastStreamTextEl
            if (textEl) textEl.textContent = stripContextFromText(_msg.text)
          }
        }
      }],
      ["mention_results", (msg) => { mention.renderResults(msg.items) }],
      ["session_list", (msg) => {
        const sessions = (msg.sessions || []) as SessionSummary[]
        openSessionModal(sessions)
      }],
      ["server_session_list", (msg) => {
        const serverSessions = msg.sessions as Array<{
          id: string; title?: string; directory?: string; parentId?: string;
          created?: number; updated?: number; files?: number; additions?: number; deletions?: number;
          isCurrentWorkspace?: boolean
        }> | undefined
        _unifiedServerSessions = serverSessions ?? []
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

            const renderOpts = { mode: session.mode, postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }
            const loader = createChunkedLoader({
              container: msgList,
              messages: session.messages,
              renderFn: (m) => renderMessage(m, renderOpts),
              onChunkDone: (rendered, total) => {
                if (rendered === Math.min(total, 20)) {
                  const anchor = scrollAnchors.get(session.id)
                  if (anchor) anchor.anchor()
                  else scrollToBottom(msgList)
                }
              },
              onAllDone: () => {
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
        const renderOpts = { mode: session?.mode ?? "build", postMessage: (m2: Record<string, unknown>) => vscode.postMessage(m2) }

        const elements = moreMsgs.map((m) => renderMessage(m, renderOpts))

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
      ["context_usage", (msg) => {
        updateContextUsage(els, { tokens: msg.tokens as number, total: msg.maxTokens as number, percentage: msg.percent as number })
      }],
      ["server_status", (msg, sid) => { if (sid) handleServerStatus(sid, msg.status as string) }],
      ["streaming_state", (msg, sid) => {
        if (sid) {
          stateManager.setStreaming(sid, Boolean(msg.isStreaming))
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
      ["stream_tool_start", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }
            stream.handleToolStart(toolCall)
          }
        }
      }],
      ["stream_tool_update", (msg, sid) => {
        if (sid) {
          const stream = streamHandlers.get(sid)
          if (stream) {
            const toolCall = msg.toolCall as { id: string; state?: ToolCallState; args?: unknown }
            if (toolCall.id) {
              stream.handleToolUpdate(toolCall.id, {
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
            stream.handleToolEnd(result.id, result)
          }
        }
      }],
      ["stream_ping", (msg, sid) => {
        vscode.postMessage({ type: "stream_ack", sessionId: sid, seq: msg.seq })
      }],
      ["force_rerender", (_msg, sid) => {
        if (!sid) return
        const stream = streamHandlers.get(sid)
        stream?.handleStreamChunk("")
      }],
      ["permission_request", (_msg, sid) => {
        if (sid) {
          addMessage(sid, {
            role: "system",
            id: "perm-" + crypto.randomUUID(),
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
      ["theme_vars", (msg) => { applyThemeVars(msg.vars) }],
      ["theme_config", (msg) => { applyThemeCustomizerConfig(msg.theme as ThemeCustomizerConfig | undefined) }],
      ["cli_themes_list", (msg) => { populateCliList(msg.themes as Array<{ name: string; source: string }>) }],
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
          const currentModel = msg.model as string || stateManager.getState().globalModel
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
          clearTimeout(window.__opencodeInitTimeout)
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

        if (sessions.length > 0) {
          sessions.forEach((s) => {
            const escapedId = CSS.escape(s.id)
            if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${escapedId}"]`)) {
              createTabUI(s.id, s.name)
            }
          })

          syncModeUI()
          updateTabBar()
        }

        if (msg.activeSessionId && sessions.some((s) => s.id === msg.activeSessionId)) {
          switchTab(msg.activeSessionId as string)
        } else {
          showWelcomeView()
        }
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
      ["request_error", (msg, sid) => { handleRequestError(sid, typeof msg.message === "string" ? msg.message : undefined) }],
      ["diff_result", (msg) => {
        handleDiffResult(msg.blockId as string, msg.ok as boolean, typeof msg.message === "string" ? msg.message : undefined, Boolean(msg.checkpointCreated))
      }],
      ["cost_update", (msg) => {
        handleCostUpdate(msg.sessionId as string, msg.cost as number)
        updateCostDisplay(msg.sessionId as string)
      }],
      ["token_usage", (msg, sid) => {
        if (sid && msg.usage) {
          handleTokenUsage(sid, msg.usage as { prompt: number; completion: number; total: number })
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
          disposeVirtualList(msg.sessionId)
          const escapedId = CSS.escape(msg.sessionId)
          stateManager.deleteSession(msg.sessionId)
          const deletedPanel = els.tabPanels.querySelector(`.tab-panel[data-tab-id="${escapedId}"]`)
          if (deletedPanel) deletedPanel.remove()
          const tabEl = els.tabBar.querySelector(`.tab[data-tab-id="${escapedId}"]`)
          if (tabEl) tabEl.remove()
          if (stateManager.getState().activeSessionId === msg.sessionId) {
            const remaining = stateManager.getAllSessions()
            const nextId = remaining.length > 0 ? remaining[0]?.id : null
            if (nextId) switchTab(nextId)
          }
          updateTabBar()
          if (stateManager.getAllSessions().length === 0) showWelcomeView()
        }
      }],
      ["compaction_started", (_msg, sid) => {
        if (sid) {
          showSystemMessage(sid, "Compacting session...")
        }
      }],
      ["session_compacted", (_msg, sid) => {
        if (sid) {
          showSystemMessage(sid, "Session compacted successfully.")
        }
      }],
      ["command_list", (msg) => {
        const commands = (msg.commands || []) as Array<{ name: string; description?: string; template: string }>
        mention.updateServerCommands(commands)
        const active = stateManager.getActiveSession()
        if (active && commands.length > 0) {
          const lines = commands.map(c => `/${c.name} \u2014 ${c.description || c.template}`).join("\n")
          showSystemMessage(active.id, `Available commands:\n${lines}`)
        }
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
    ])

    window.addEventListener("message", (event) => {
      const msg: HostMessage = event.data
      if (!msg || !msg.type) return

      const sessionId = (msg.message?.sessionId || msg.sessionId) as string | undefined
      const handler = messageHandlers.get(msg.type)
      if (handler) handler(msg, sessionId)
    })
  }

  /* ─── TURN NAVIGATION ─── */
  // #turn-nav (prev/next/select) removed — the conversation timeline sidebar
  // is the single navigation aid. scrollToTurn is still used by the timeline.

  function scrollToTurn(messageId: string) {
    const msgList = getActiveMessageList(els)
    if (!msgList) return
    const target = msgList.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      target.setAttribute("tabindex", "-1")
      target.focus()
    }
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

  function loadDisplayPrefs(): { text: boolean; tools: boolean; diffs: boolean; errors: boolean } {
    try {
      const state = vscode.getState() as WebviewState | undefined
      const prefs = state?.displayPrefs
      return {
        text: prefs?.text !== false,
        tools: prefs?.tools !== false,
        diffs: prefs?.diffs !== false,
        errors: prefs?.errors !== false,
      }
    } catch {
      return { text: true, tools: true, diffs: true, errors: true }
    }
  }

  function saveDisplayPrefs(prefs: { text: boolean; tools: boolean; diffs: boolean; errors: boolean }) {
    try {
      const state = (vscode.getState() as WebviewState) || {}
      vscode.setState({ ...state, displayPrefs: prefs })
    } catch {
      /* webview state may be unavailable; fail silently */
    }
  }

  function applyDisplayPrefs() {
    const root = document.body
    root.classList.toggle("hide-text", !els.toggleText.checked)
    root.classList.toggle("hide-tools", !els.toggleTools.checked)
    root.classList.toggle("hide-diffs", !els.toggleDiffs.checked)
    root.classList.toggle("hide-errors", !els.toggleErrors.checked)
  }

  function setupDisplayToggles() {
    const prefs = loadDisplayPrefs()
    els.toggleText.checked = prefs.text
    els.toggleTools.checked = prefs.tools
    els.toggleDiffs.checked = prefs.diffs
    els.toggleErrors.checked = prefs.errors
    applyDisplayPrefs()

    const persist = () => {
      saveDisplayPrefs({
        text: els.toggleText.checked,
        tools: els.toggleTools.checked,
        diffs: els.toggleDiffs.checked,
        errors: els.toggleErrors.checked,
      })
      applyDisplayPrefs()
    }
    els.toggleText.addEventListener("change", persist)
    els.toggleTools.addEventListener("change", persist)
    els.toggleDiffs.addEventListener("change", persist)
    els.toggleErrors.addEventListener("change", persist)
  }

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
      setTimeout(() => pill.remove(), 3000)
    } else {
      const pill = document.createElement("span")
      pill.className = "skill-pill"
      pill.textContent = skillName
      indicator.appendChild(pill)
      setTimeout(() => pill.remove(), 3000)
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
      updateModeSelectorState()
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
    // Ensure tab UI exists in the DOM before processing stream
    let msgList = getMessageList(sessionId)
    if (!msgList) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: No message list for ${sessionId}, creating tab UI` })
      const session = stateManager.getSession(sessionId)
      if (session) {
        createTabUI(sessionId, session.name || "New Session")
        msgList = getMessageList(sessionId)
      }
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

    // Ensure the tab is visible (active)
    if (stateManager.getState().activeSessionId !== sessionId) {
      vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Switching to tab ${sessionId}` })
      switchTab(sessionId)
    }

    vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Starting stream for ${sessionId} (msgId=${messageId})` })
    finalStream.handleStreamStart(messageId)
    stateManager.setStreaming(sessionId, true)
    startToolElapsedTimer()
    updateTabBar()
    updateModeSelectorState()
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
  function handleStreamChunk(sessionId: string, text?: string) {
    let stream = streamHandlers.get(sessionId)
    if (!stream) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamChunk: No stream found for session ${sessionId}, creating...` })
      stream = createStreamHandlersForTab(sessionId)
      streamHandlers.set(sessionId, stream)
    }
    const s = stream!
    chunkLogCounter++
    if (chunkLogCounter <= 3 || chunkLogCounter % 50 === 0 || (text && text.length > 1000)) {
      vscode.postMessage({
        type: "webview_log",
        level: "info",
        message: `handleStreamChunk: chunk #${chunkLogCounter} for ${sessionId} len=${text?.length || 0} streamingMessageId=${s.streamingMessageId ?? "<null>"}`,
      })
    }
    s.handleStreamChunk(text)
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) {
    try {
      const stream = streamHandlers.get(sessionId)
      if (!stream) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamEnd: No stream found for session ${sessionId}` })
      } else {
        vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamEnd: Ending stream for ${sessionId}` })
        try {
          stream.handleStreamEnd(messageId, blocks)
        } catch (err) {
          console.error("[OpenCode] stream.handleStreamEnd threw:", err)
          vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd: stream handler threw: ${err instanceof Error ? err.message : err}` })
        }
      }

      const blockList = Array.isArray(blocks) ? blocks as ChatMessage["blocks"] : []

      // Always render blocks if present, even if stream handler failed.
      // addMessage's dedup check prevents double-render if already rendered.
      if (blockList.length > 0) {
        const msgList = getMessageList(sessionId)
        if (messageId && msgList) {
          const placeholder = msgList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
          if (placeholder) {
            const textEl = placeholder.querySelector(".streaming-text, .msg-text") as HTMLElement | null
            const hasContent = textEl && textEl.textContent && textEl.textContent.trim().length > 2
            if (!hasContent) {
              placeholder.remove()
              vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamEnd: removed empty placeholder for ${sessionId}` })
            }
          }
        }
        addMessage(sessionId, {
          role: "assistant",
          id: messageId || `resp-${Date.now()}`,
          blocks: blockList,
          timestamp: Date.now(),
        })
      }

      stateManager.setStreaming(sessionId, false)
      stopToolElapsedTimer()
      updateTabBar()
      updateModeSelectorState()
      updateAgentStatus("idle")

    // Show user-actionable message for timeout/ttfb/error scenarios
    if (reason === "ttfb_timeout") {
      showSystemMessage(sessionId, "The model took too long to start responding. Please try again or select a different model.", true)
    } else if (reason === "timeout") {
      if (partial) {
        showSystemMessage(sessionId, "Response was cut off (timeout). Partial output has been preserved.", true)
      } else {
        showSystemMessage(sessionId, "Response timed out. Please try again or select a different model.", true)
      }
    } else if (reason === "hard_timeout") {
      showSystemMessage(sessionId, "Stream interrupted after extended run. Partial output preserved.", true)
    } else if (reason === "error") {
      showSystemMessage(sessionId, "An error occurred while generating the response. Please try again.", true)
    } else if (reason === "aborted") {
      // Aborted is user-initiated — no error message needed
    }

    if (sessionId === stateManager.getState().activeSessionId) {
      updateSendButtonIcon(false)
      updateSendButton()
    }

    // Auto-advance queue: if stream ended (not aborted), send next queued prompt
    if (reason !== "aborted") {
      const queue = promptQueues.get(sessionId)
      if (queue && queue.isNextReady()) {
        const next = queue.processNext()
        if (next) {
          sendQueuedPrompt(sessionId, next.text, next.attachments)
        }
      }
    }
    } catch (err) {
      console.error("[OpenCode] handleStreamEnd top-level error:", err)
      vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd error: ${err instanceof Error ? err.message : String(err)}` })
      // Even if everything else fails, try to show the system message
      try { showSystemMessage(sessionId, reason === "ttfb_timeout" ? "Model took too long. Try a different model." : reason === "timeout" ? "Response timed out." : reason === "error" ? "An error occurred." : "Unexpected error.") } catch {}
      try { stateManager.setStreaming(sessionId, false) } catch {}
      try { updateTabBar() } catch {}
      try { updateModeSelectorState() } catch {}
      try { updateAgentStatus("idle") } catch {}
    }
  }

  function sendQueuedPrompt(sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) {
    const active = stateManager.getSession(sessionId)
    if (!active) return

    const msgObj: ChatMessage = {
      role: "user",
      id: "user-" + crypto.randomUUID(),
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
    updateModeSelectorState()
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

  function handleServerStatus(sessionId: string, status?: string) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return
    stream.handleServerStatus(status)
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
    updateModeSelectorState()

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

  /* ─── TOKEN/COST DISPLAY (RED phase stubs) ─── */

  function handleTokenUsage(sessionId: string, usage: { prompt: number; completion: number; total: number }) {
    const session = stateManager.getSession(sessionId)
    if (session) {
      session.tokenUsage = usage
      stateManager.save()
    }
    updateTokenDisplay(usage)
  }

  function handleRateLimitState(state?: RateLimitWebviewState | null) {
    updateQuotaBar(state || undefined)
  }

  function updateQuotaBar(state?: RateLimitWebviewState) {
    if (!state) {
      els.quotaBar.classList.add("hidden")
      return
    }

    const tokenPct = state.remainingTokens !== undefined && state.limitTokens && state.limitTokens > 0
      ? Math.round((state.remainingTokens / state.limitTokens) * 100)
      : undefined
    const requestPct = state.remainingRequests !== undefined && state.limitRequests && state.limitRequests > 0
      ? Math.round((state.remainingRequests / state.limitRequests) * 100)
      : undefined
    const bindingPct = [tokenPct, requestPct].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0]
    const provider = state.provider ? state.provider.replace(/-/g, " ") : "provider"

    els.quotaBar.classList.remove("hidden", "quota-bar--ok", "quota-bar--warning", "quota-bar--critical", "quota-bar--observed")
    if (bindingPct !== undefined) {
      const pct = Math.max(0, Math.min(100, bindingPct))
      const kind = requestPct !== undefined && requestPct === pct && (tokenPct === undefined || requestPct <= tokenPct) ? "requests" : "tokens"
      els.quotaProgressBar.style.width = `${pct}%`
      els.quotaLabel.textContent = `${provider} ${pct}%`
      els.quotaDetail.textContent = kind === "requests"
        ? `${formatNumber(state.remainingRequests)} / ${formatNumber(state.limitRequests)} req`
        : `${formatNumber(state.remainingTokens)} / ${formatNumber(state.limitTokens)} tok`
      els.quotaBar.classList.add(pct > 50 ? "quota-bar--ok" : pct > 10 ? "quota-bar--warning" : "quota-bar--critical")
    } else {
      els.quotaProgressBar.style.width = "100%"
      els.quotaLabel.textContent = `${provider} usage`
      const observed = state.usedTokens !== undefined ? `${formatNumber(state.usedTokens)} tok` : "observed"
      const cost = state.usedCost !== undefined ? ` · $${state.usedCost.toFixed(4)}` : ""
      els.quotaDetail.textContent = `${observed}${cost}`
      els.quotaBar.classList.add("quota-bar--observed")
    }
    const reset = state.resetAt ? ` · resets ${formatTime(state.resetAt)}` : ""
    els.quotaBar.title = `${els.quotaLabel.textContent}: ${els.quotaDetail.textContent}${reset}`
    showStatusStrip()
  }

  function formatNumber(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) return "-"
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
  }

  function formatTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
  }

  function updateTokenDisplay(usage?: { prompt: number; completion: number; total: number }) {
    // token-display is kept hidden outside the header (dom.ts optionalElement) for compatibility
    const tokenDisplay = els.tokenDisplay
    if (tokenDisplay && usage) {
      tokenDisplay.textContent = `${usage.total} tokens`
      tokenDisplay.title = `Prompt: ${usage.prompt} · Completion: ${usage.completion}`
    }
    if (usage) {
      els.statusTokens.textContent = `${usage.total.toLocaleString()} tok`
      els.statusTokens.classList.remove("hidden")
      showStatusStrip()
    }
  }

  function updateCostDisplay(sessionId: string) {
    const session = stateManager.getSession(sessionId)
    const costEl = els.costDisplay
    if (costEl && session?.cost !== undefined) {
      costEl.textContent = `$${session.cost.toFixed(4)}`
      costEl.title = `Session cost: $${session.cost.toFixed(4)}`
      costEl.classList.remove("hidden")
    } else if (costEl) {
      costEl.classList.add("hidden")
    }
    if (session?.cost !== undefined && session.cost > 0) {
      els.statusCost.textContent = `$${session.cost.toFixed(4)}`
      els.statusCost.classList.remove("hidden")
      showStatusStrip()
    }
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

  const fileEditBatcher = new (class FileEditBatcher {
    private pending = new Map<string, { files: Set<string>; timer: ReturnType<typeof setTimeout> }>()
    private readonly FLUSH_MS = 500

    add(sessionId: string, filePath: string) {
      let entry = this.pending.get(sessionId)
      if (!entry) {
        entry = { files: new Set<string>(), timer: setTimeout(() => {}, 0) as ReturnType<typeof setTimeout> }
        clearTimeout(entry.timer)
        this.pending.set(sessionId, entry)
      }
      entry.files.add(filePath)
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => this.flush(sessionId), this.FLUSH_MS)
    }

    private flush(sessionId: string) {
      const entry = this.pending.get(sessionId)
      if (!entry) return
      this.pending.delete(sessionId)
      const files = Array.from(entry.files)
      if (files.length === 0) return
      const text = files.length === 1
        ? `Edited ${files[0]}`
        : `Edited ${files.length} files: ${files.map(f => f.split("/").pop()).join(", ")}`
      addMessage(sessionId, {
        role: "system",
        id: "file-" + crypto.randomUUID(),
        blocks: [{ type: "task_banner", status: "success", text }],
        timestamp: Date.now(),
        sessionId,
      })
    }

    cancelAll() {
      for (const entry of this.pending.values()) clearTimeout(entry.timer)
      this.pending.clear()
    }
  })()

  function trackFileChange(sessionId: string, filePath: string) {
    const session = stateManager.getSession(sessionId)
    if (session) {
      if (!session.changedFiles) session.changedFiles = []
      if (!session.changedFiles.includes(filePath)) {
        session.changedFiles.push(filePath)
        stateManager.save()
      }
    }
  }

  function undoMessage(messageId: string) {
    const sessionId = stateManager.getState().activeSessionId
    if (sessionId) {
      vscode.postMessage({ type: "revert_message", messageId, sessionId })
    }
  }

  function getSessionsByWorkspace(workspacePath: string) {
    return stateManager.getAllSessions().filter(s => (s as any).workspacePath === workspacePath)
  }

  function filterByWorkspace(sessions: any[], workspace: string) {
    return sessions.filter(s => s.workspacePath === workspace || s.workspace === workspace)
  }

  function handleChangedFiles(sessionId: string, files: string[]) {
    const session = stateManager.getSession(sessionId)
    if (session) {
      session.changedFiles = files
      stateManager.save()
    }
    renderChangedFilesList(files)
  }

  function renderChangedFilesList(files: string[]) {
    const list = els.changedFilesList
    if (!list) return
    list.innerHTML = ""
    if (files.length === 0) {
      list.classList.add("hidden")
      return
    }
    list.classList.remove("hidden")
    for (const f of files) {
      const chip = document.createElement("span")
      chip.className = "changed-file-chip"
      chip.textContent = f.split("/").pop() || f
      chip.title = f
      list.appendChild(chip)
    }
  }

  function renderCheckpointPanel(checkpoints: Array<{ id: string; sessionId: string; messageId?: string; filesChanged?: string[] }>) {
    const panel = els.checkpointPanel
    if (!panel) return
    panel.innerHTML = ""
    if (checkpoints.length === 0) {
      panel.classList.add("hidden")
      return
    }
    panel.classList.remove("hidden")
    for (const cp of checkpoints) {
      const item = document.createElement("div")
      item.className = "checkpoint-item"
      item.setAttribute("role", "listitem")
      
      const label = document.createElement("span")
      label.textContent = `Checkpoint ${cp.id.slice(0, 8)}... (${cp.filesChanged?.length || 0} files)`
      label.title = `Message: ${cp.messageId || "unknown"}`
      label.className = "checkpoint-label"
      
      const restoreBtn = document.createElement("button")
      restoreBtn.className = "checkpoint-restore-btn"
      restoreBtn.textContent = "Restore"
      restoreBtn.setAttribute("aria-label", `Restore to checkpoint ${cp.id.slice(0, 8)}`)
      restoreBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "restore_checkpoint", checkpointId: cp.id, sessionId: cp.sessionId })
      })
      
      item.appendChild(label)
      item.appendChild(restoreBtn)
      panel.appendChild(item)
    }
  }

  function handleClearMessages(sessionId?: string) {
    if (sessionId) {
      const stream = streamHandlers.get(sessionId)
      if (stream) stream.clearMessages()
      const msgList = getMessageList(sessionId)
      if (msgList) msgList.innerHTML = ""
    } else {
      // Clear all
      streamHandlers.forEach((s) => s.clearMessages())
      stateManager.getAllSessions().forEach((s) => {
        const msgList = getMessageList(s.id)
        if (msgList) msgList.innerHTML = ""
      })
    }
  }

  /* ─── START ─── */

  try {
    init()
    vscode.postMessage({ type: "webview_ready" })
  } catch (err) {
    console.error("[OpenCode] Fatal init error:", err)
    vscode.postMessage({ type: "webview_error", message: "Initialization failed" })
  }
})()
