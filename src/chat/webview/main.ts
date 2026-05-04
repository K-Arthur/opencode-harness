import hljs from "highlight.js"
import "./toolkit"
import type { ChatMessage, HostMessage, MentionItem, SessionSummary, ModelInfo } from "./types"
import { createState } from "./state"
import { getElementRefs, scrollToBottom, getActiveMessageList } from "./dom"
import { renderMessage } from "./renderer"
import { setupMentions } from "./mentions"
import { showSessionPicker } from "./sessions"
import { createStreamHandlers } from "./stream"
import { createTabBar, createTabContent, switchToTab, removeTabContent } from "./tabs"
import { setupModelDropdown } from "./model-dropdown"
import { updateContextChips, updateContextUsage, applyThemeVars, handleRateLimitExhausted } from "./theme"
import { renderRecentSessions } from "./recent-sessions"

declare const acquireVsCodeApi: (() => {
  postMessage(message: Record<string, unknown>): void
  getState(): import("./types").WebviewState | undefined
  setState(state: import("./types").WebviewState): void
}) | undefined

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
  const modelDropdown = setupModelDropdown(els, {
    onOpen: () => {
      vscode.postMessage({ type: "get_models" })
    },
    onSelect: (modelId) => {
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionModel(active.id, modelId)
        stateManager.setGlobalModel(modelId)
        modelDropdown.setCurrentModel(modelId)
        vscode.postMessage({ type: "set_model", model: modelId, sessionId: active.id })
      }
    },
  })

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
  })

  // Streaming state per session
  const streamHandlers = new Map<string, ReturnType<typeof createStreamHandlers>>()

  const mention = setupMentions(
    els,
    { query: "", selectedIndex: -1 },
    (msg) => vscode.postMessage(msg)
  )

  // Mode state: "plan" or "build"
  let currentMode = "plan"

  /* ─── INIT ─── */

  function init() {
    try {
      setupModeToggle()
      setupInput()
      setupButtons()
      setupWelcomeSuggestions()
      setupMessageListener()
      setupPermissionListener()
      setupDiffActionListener()
      setupKeyboardShortcuts()
      updateSendButton()

      if (stateManager.restore()) {
        // Restore all tabs
        const sessions = stateManager.getAllSessions()
        const activeId = stateManager.getState().activeSessionId

        if (sessions.length === 0) {
          createInitialTab("Default")
          return
        }

        sessions.forEach((session) => {
          createTabUI(session.id, session.name)
          const msgList = getMessageList(session.id)
          if (msgList) {
            msgList.innerHTML = ""
            session.messages.forEach((msg) => {
              try {
                msgList.appendChild(renderMessage(msg))
              } catch (err) {
                console.error("Failed to render message:", err)
              }
            })
          }
        })

        if (activeId) {
          switchToTab(els, activeId)
          vscode.postMessage({ type: "switch_tab", sessionId: activeId })
        }

        syncModeUI()
        // updateTabBar() // This might need review
        renderRecentSessionsList()
      } else {
        createInitialTab("Default")
      }
    } catch (err) {
      console.error("[OpenCode] Initialization error:", err)
      // Show error in UI
      const errorDiv = document.createElement("div")
      errorDiv.className = "error-boundary"
      errorDiv.textContent = "Failed to initialize. Please reload."
      document.body.appendChild(errorDiv)
    }
  }

  /* ─── RECENT SESSIONS ─── */

  function renderRecentSessionsList() {
    const sessions = stateManager.getAllSessions()
      .filter((s) => s.messages.length > 0)
      .sort((a, b) => (b.messages.length || 0) - (a.messages.length || 0))
      .slice(0, 5)
      .map((s) => ({
        id: s.id,
        title: s.name,
        time: s.messages.length > 0 ? s.messages[s.messages.length - 1].timestamp : undefined,
        messageCount: s.messages.length,
        cost: s.cost || 0,
      }))

    renderRecentSessions(
      sessions,
      els.recentList.parentElement || els.recentSessions,
      () => vscode.postMessage({ type: "list_sessions" }),
      (sessionId) => {
        vscode.postMessage({ type: "resume_session", sessionId })
      }
    )
  }

  function toggleRecentSessions(): void {
    if (!els.recentSessions) return
    const isVisible = els.recentSessions.style.display !== "none"
    if (isVisible) {
      els.recentSessions.style.opacity = "0"
      setTimeout(() => { els.recentSessions!.style.display = "none" }, 150)
    } else {
      els.recentSessions.style.display = "block"
      requestAnimationFrame(() => { els.recentSessions!.style.opacity = "1" })
    }
  }

  /* ─── TAB MANAGEMENT ─── */

  function createNewTab(name?: string) {
    const session = stateManager.createSession(name)
    createTabUI(session.id, session.name)
    switchToTab(els, session.id)
    vscode.postMessage({ type: "switch_tab", sessionId: session.id })
    updateTabBar()
    renderRecentSessionsList()
    return session
  }

  function createInitialTab(name?: string) {
    const existingView = els.tabPanels.querySelector<HTMLElement>('vscode-panel-view[data-tab-id="default"]')

    if (!existingView) {
      return createNewTab(name)
    }

    const session = stateManager.createSession(name)
    existingView.dataset.tabId = session.id
    existingView.id = "view-" + session.id
    
    const existingTab = els.tabPanels.querySelector<HTMLElement>('vscode-panel-tab[data-tab-id="default"]')
    if (existingTab) {
      existingTab.dataset.tabId = session.id
      existingTab.id = "tab-" + session.id
      const label = existingTab.querySelector(".tab-label")
      if (label) label.textContent = session.name
    }

    const stream = createStreamHandlersForTab(session.id)
    streamHandlers.set(session.id, stream)
    vscode.postMessage({
      type: "create_tab",
      sessionId: session.id,
      name: session.name,
      model: session.model,
      mode: session.mode,
    })

    switchToTab(els, session.id)
    vscode.postMessage({ type: "switch_tab", sessionId: session.id })
    updateTabBar()
    renderRecentSessionsList()
    return session
  }

  function createTabUI(tabId: string, tabName: string) {
    // Check if content already exists
    if (els.tabPanels.querySelector(`vscode-panel-view[data-tab-id="${tabId}"]`)) return

    const [tab, view] = createTabContent(tabId, tabName)
    els.tabPanels.appendChild(tab)
    els.tabPanels.appendChild(view)

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

    // Scroll to bottom of active tab
    const msgList = getActiveMessageList(els)
    if (msgList) scrollToBottom(msgList)
  }

  function closeTab(tabId: string) {
    const sessions = stateManager.getAllSessions()
    if (sessions.length <= 1) {
      // Don't close the last tab - create a new default one first
      createNewTab("Default")
    }

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
    const view = els.tabPanels.querySelector<HTMLElement>(`#view-${tabId}`)
    return view?.querySelector<HTMLDivElement>(".message-list") || null
  }

  function getTypingIndicator(tabId: string): HTMLDivElement | null {
    const view = els.tabPanels.querySelector<HTMLElement>(`#view-${tabId}`)
    return view?.querySelector<HTMLDivElement>(".typing-indicator") || null
  }

  /* ─── STREAMING ─── */

  function createStreamHandlersForTab(tabId: string) {
    const session = stateManager.getSession(tabId)
    if (!session) throw new Error(`No session for tab ${tabId}`)

    const streamState = {
      isStreaming: false,
      streamingMessageId: null as string | null,
      streamingBuffer: "",
    }

    const msgList = getMessageList(tabId)
    const typingInd = getTypingIndicator(tabId)

    // Create StreamElements for this tab
    const streamEls = {
      messageList: msgList || document.createElement("div"),
      typingIndicator: typingInd || document.createElement("div"),
      typingLabel: (typingInd?.querySelector(".typing-text") || document.createElement("span")) as HTMLSpanElement,
    }

    const stream = createStreamHandlers(streamEls, streamState, session.messages, () => {
      stateManager.save()
    })

    return {
      ...stream,
      showTypingIndicator: (label?: string) => {
        if (typingInd) {
          typingInd.classList.remove("hidden")
          const labelEl = typingInd.querySelector(".typing-text")
          if (labelEl) labelEl.textContent = label || "Thinking..."
        }
        if (msgList) scrollToBottom(msgList)
      },
      hideTypingIndicator: () => {
        if (typingInd) typingInd.classList.add("hidden")
      },
    }
  }

  /* ─── MODE TOGGLE ─── */

  function setupModeToggle() {
    els.modeToggle.addEventListener("click", () => {
      currentMode = currentMode === "plan" ? "build" : "plan"
      els.modeLabel.textContent = currentMode === "plan" ? "Plan" : "Build"
      els.modeToggle.classList.toggle("active", currentMode === "build")
      
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionMode(active.id, currentMode)
        vscode.postMessage({ type: "change_mode", mode: currentMode, sessionId: active.id })
      }
    })
  }

  function syncModeUI() {
    const active = stateManager.getActiveSession()
    currentMode = active?.mode || "plan"
    els.modeLabel.textContent = currentMode === "plan" ? "Plan" : "Build"
    els.modeToggle.classList.toggle("active", currentMode === "build")
  }

  /* ─── INPUT ─── */

  function setupInput() {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    els.sendBtn.addEventListener("click", sendMessage)
    els.abortBtn.addEventListener("click", abortStream)
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
  }

  function onInputChange() {
    autoResizeTextarea()
    mention.handleTrigger()
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
          switchTab(sessions[nextIdx].id)
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

  function setupKeyboardShortcuts() {
    // Additional shortcuts handled in onInputKeydown
  }

  function autoResizeTextarea() {
    if (!els.promptInput) return
    const el = els.promptInput
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0
    const active = stateManager.getActiveSession()
    const isStreaming = active?.isStreaming || false
    ;(els.sendBtn as HTMLButtonElement).disabled = !hasText || isStreaming
    updateSendButtonIcon(isStreaming)
  }

  function updateSendButtonIcon(isStreaming?: boolean) {
    const active = stateManager.getActiveSession()
    const streaming = isStreaming ?? active?.isStreaming ?? false
    const icon = els.sendBtn?.querySelector("svg")
    if (!icon) return
    if (streaming) {
      icon.innerHTML = '<path d="M6 6h8v8H6z"/>'
    } else {
      icon.innerHTML = '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>'
    }
  }

  function sendMessage() {
    const text = els.promptInput.value.trim()
    const active = stateManager.getActiveSession()

    // If streaming, abort instead of sending
    if (active?.isStreaming) {
      abortStream()
      return
    }

    if (!text || !active) return

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
      id: "user-" + Date.now(),
      blocks: [{ type: "text", text }],
      timestamp: Date.now(),
      sessionId: active.id,
    }

    addMessage(active.id, msgObj)
    stateManager.setStreaming(active.id, true)
    updateTabBar()
    updateSendButton()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId: active.id,
      model: active.model,
      mode: active.mode,
    })
  }

  function abortStream() {
    const active = stateManager.getActiveSession()
    if (!active) return

    stateManager.setStreaming(active.id, false)
    updateTabBar()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.hideTypingIndicator()

    updateSendButtonIcon(false)
    updateSendButton()

    vscode.postMessage({ type: "abort", sessionId: active.id })
  }

  /* ─── BUTTONS ─── */

  function setupButtons() {
    els.newChatBtn.addEventListener("click", () => {
      createNewTab()
    })
    
    els.mcpBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "open_mcp_settings" })
    })
    
    els.settingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "open_settings" })
    })
    
     els.viewAllSessionsBtn.addEventListener("click", () => {
       vscode.postMessage({ type: "list_sessions" })
     })

     els.attachBtn?.addEventListener("click", () => {
       vscode.postMessage({ type: "attach_files" })
     })
   }

  /* ─── WELCOME ─── */

  function setupWelcomeSuggestions() {
    const suggestionCards = document.querySelectorAll<HTMLButtonElement>(".suggestion-card")
    suggestionCards.forEach((btn) => {
      btn.addEventListener("click", () => {
        els.promptInput.value = btn.dataset.prompt || ""
        autoResizeTextarea()
        updateSendButton()
        els.promptInput.focus()
      })
    })
  }

  /* ─── MESSAGES ─── */

  function addMessage(sessionId: string, msg: ChatMessage) {
    const session = stateManager.getSession(sessionId)
    if (!session) return

    session.messages.push(msg)
    const msgList = getMessageList(sessionId)
    if (msgList) {
      const welcome = msgList.querySelector(".welcome-container")
      if (welcome) welcome.remove()

      const el = renderMessage(msg)
      msgList.appendChild(el)
      scrollToBottom(msgList)
    }
    stateManager.save()
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
    window.addEventListener("message", (event) => {
      const msg: HostMessage = event.data
      if (!msg || !msg.type) return

      // Route by sessionId if present
      const sessionId = (msg.message?.sessionId || msg.sessionId) as string | undefined

      switch (msg.type) {
        case "message":
          if (msg.message) handleHostMessage(msg.message)
          break
        case "stream_start":
          if (sessionId) handleStreamStart(sessionId, msg.messageId as string)
          break
        case "stream_chunk":
          if (sessionId) handleStreamChunk(sessionId, msg.text as string)
          break
        case "stream_end":
          if (sessionId) handleStreamEnd(sessionId, msg.messageId as string, msg.blocks)
          break
        case "mention_results":
          mention.renderResults(msg.items)
          break
        case "session_list":
          if (msg.sessions) showSessionPicker(msg.sessions, (m) => vscode.postMessage(m))
          break
        case "resume_session_data": {
          const session = msg.session as import("./types").SessionState | undefined
          if (session) {
            stateManager.ensureSession(session)
            createTabUI(session.id, session.name)
            const msgList = getMessageList(session.id)
            if (msgList) {
              msgList.replaceChildren()
              session.messages.forEach((m) => msgList.appendChild(renderMessage(m)))
            }
            switchTab(session.id)
            updateTabBar()
            renderRecentSessionsList()
          }
          break
        }
        case "clear_messages":
          handleClearMessages(sessionId)
          break
        case "context_usage":
          updateContextUsage(els, { tokens: msg.tokens as number, total: msg.maxTokens as number, percentage: msg.percent as number })
          break
        case "server_status":
          if (sessionId) handleServerStatus(sessionId, msg.status as string)
          break
        case "streaming_state":
          if (sessionId) {
            stateManager.setStreaming(sessionId, Boolean(msg.isStreaming))
            updateTabBar()
            updateSendButton()
          }
          break
        case "tool_result":
          if (sessionId) {
            addMessage(sessionId, {
              role: "system",
              id: "tool-" + Date.now(),
              blocks: [{
                type: "tool_call",
                toolName: String(msg.toolName || "tool"),
                result: typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result ?? ""),
                state: "completed",
              }],
              timestamp: Date.now(),
              sessionId,
            })
          }
          break
        case "permission_request":
          if (sessionId) {
            addMessage(sessionId, {
              role: "system",
              id: "perm-" + Date.now(),
              blocks: [{
                type: "permission",
                permissionId: String(msg.permissionId || ""),
                text: typeof msg.title === "string" ? msg.title : "Allow OpenCode to perform this action?",
              }],
              timestamp: Date.now(),
              sessionId,
            })
          }
          break
        case "file_edited":
          if (sessionId) {
            addMessage(sessionId, {
              role: "system",
              id: "file-" + Date.now(),
              blocks: [{ type: "task_banner", status: "success", text: `Edited ${String(msg.file || "file")}` }],
              timestamp: Date.now(),
              sessionId,
            })
          }
          break
        case "theme_vars":
          applyThemeVars(msg.vars)
          break
        case "model_update":
          modelDropdown.setCurrentModel(msg.model as string)
          break
        case "model_list":
          if (msg.items) {
            const currentModel = msg.model as string || stateManager.getState().globalModel
            modelDropdown.render(msg.items as ModelInfo[], currentModel)
          }
          break
        case "init_state": {
          const sessions = (msg.sessions || []) as import("./types").SessionState[]
          if (sessions.length > 0) {
            stateManager.loadSessions(sessions, msg.activeSessionId as string | null, msg.globalModel as string)
            
            // Set model label from init state
            if (msg.globalModel) {
              modelDropdown.setCurrentModel(msg.globalModel as string)
            }
            // Clear existing UI and rebuild from backend state
            els.tabPanels.querySelectorAll<HTMLElement>("vscode-panel-tab").forEach((t) => t.remove())
            els.tabPanels.querySelectorAll<HTMLElement>("vscode-panel-view").forEach((c) => c.remove())
            sessions.forEach((session) => {
              createTabUI(session.id, session.name)
              const msgList = getMessageList(session.id)
              if (msgList) {
                msgList.replaceChildren()
                session.messages.forEach((m) => msgList.appendChild(renderMessage(m)))
              }
            })
            const activeId = stateManager.getState().activeSessionId
            if (activeId) {
              switchTab(activeId)
            }
            updateTabBar()
            syncModeUI()
            renderRecentSessionsList()
          }
          break
        }
        case "rate_limit_exhausted":
          handleRateLimitExhausted(els, msg.resetAt as string)
          break
        case "request_error":
          handleRequestError(sessionId, typeof msg.message === "string" ? msg.message : undefined)
          break
        case "diff_result":
          handleDiffResult(msg.blockId as string, msg.ok as boolean, typeof msg.message === "string" ? msg.message : undefined)
          break
        case "cost_update":
          handleCostUpdate(msg.sessionId as string, msg.cost as number)
          break
        case "prefill_prompt":
          if (typeof msg.text === "string") {
            els.promptInput.value = msg.text
            autoResizeTextarea()
            updateSendButton()
            els.promptInput.focus()
            if (msg.autoSend) sendMessage()
          }
          break
        case "insert_text":
          if (typeof msg.text === "string") {
            insertTextAtCursor(msg.text)
          }
          break
      }
    })
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
      updateSendButton()
      updateAgentStatus("idle")
    }
  }

  function updateAgentStatus(status: "idle" | "thinking" | "executing") {
    els.agentStatusLed.className = `status-led ${status}`
    els.agentStatusText.textContent = status === "idle" ? "SYSTEM READY" : status.toUpperCase()
  }

  function handleStreamStart(sessionId: string, messageId?: string) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return

    stream.handleStreamStart(messageId)
    stateManager.setStreaming(sessionId, true)
    updateTabBar()
    updateAgentStatus("thinking")
  }

  function handleStreamChunk(sessionId: string, text?: string) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return
    stream.handleStreamChunk(text)
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return

    stream.handleStreamEnd(messageId, blocks)
    stateManager.setStreaming(sessionId, false)
    updateTabBar()
    updateAgentStatus("idle")

    if (sessionId === stateManager.getState().activeSessionId) {
      updateSendButtonIcon(false)
      updateSendButton()
    }
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
      // Global error
      const active = stateManager.getActiveSession()
      if (active) sessionId = active.id
      else return
    }

    stateManager.setStreaming(sessionId, false)
    updateTabBar()

    const stream = streamHandlers.get(sessionId)
    if (stream) {
      stream.handleRequestError(message)
    }

    if (sessionId === stateManager.getState().activeSessionId) {
      updateSendButtonIcon(false)
      updateSendButton()
    }
  }

  function handleDiffResult(blockId?: string, ok?: boolean, message?: string) {
    // Find the block in any active session
    for (const [sid, stream] of streamHandlers) {
      stream.handleDiffResult(blockId, ok, message)
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

  init()
  vscode.postMessage({ type: "webview_ready" })
})()
