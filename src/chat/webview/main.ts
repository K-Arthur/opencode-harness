import type { ChatMessage, HostMessage, MentionItem, SessionSummary, ModelInfo, WebviewState } from "./types"
import { createState } from "./state"
import { getElementRefs, scrollToBottom, getActiveMessageList } from "./dom"
import { renderMessage } from "./renderer"
import { setupMentions } from "./mentions"
import { createStreamHandlers } from "./stream"
import { createTabBar, createTabContent, switchToTab, removeTabContent } from "./tabs"
import { setupModelDropdown } from "./model-dropdown"
import { setupModelManager } from "./model-manager"
import { setupVariantSelector } from "./variant-selector"
import { REMOVE_SVG } from "./icons"
import { updateContextChips, updateContextUsage, applyThemeVars, handleRateLimitExhausted } from "./theme"
import { renderRecentSessions } from "./recent-sessions"
import { createScrollAnchor, type ScrollAnchor } from "./scrollAnchor"

declare const acquireVsCodeApi: (() => {
  postMessage(message: Record<string, unknown>): void
  getState(): import("./types").WebviewState | undefined
  setState(state: import("./types").WebviewState): void
}) | undefined

// Timeout handle for deferred initialization
declare global {
  var __opencodeInitTimeout: ReturnType<typeof setTimeout> | undefined
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
      const active = stateManager.getActiveSession()
      if (active) {
        stateManager.setSessionModel(active.id, modelId)
        stateManager.setGlobalModel(modelId)
        modelDropdown.setCurrentModel(modelId)
        // Update variant selector visibility based on new model
        const model = modelManager.getEnabledModels().find((m) => `${m.provider}/${m.id}` === modelId)
        variantSelector.setModel(model || null)
        vscode.postMessage({ type: "set_model", model: modelId, sessionId: active.id })
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
      // Re-render dropdown with updated enabled state
      const allModels = modelManager.getAllModels()
      const currentModel = stateManager.getState().globalModel
      modelDropdown.render(allModels, currentModel)
    },
    onSelectModel: (modelId) => {
      stateManager.setGlobalModel(modelId)
      modelDropdown.setCurrentModel(modelId)
      const model = modelManager.getAllModels().find((m) => `${m.provider}/${m.id}` === modelId)
      variantSelector.setModel(model || null)
      vscode.postMessage({ type: "set_model", model: modelId })
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

  const tabBar = createTabBar(els, {
    onSwitch: (tabId) => switchTab(tabId),
    onClose: (tabId) => closeTab(tabId),
    onNew: () => createNewTab(),
  })

  // Streaming state per session
  const streamHandlers = new Map<string, ReturnType<typeof createStreamHandlers>>()

  // Scroll anchors per tab — disposed on tab close
  const scrollAnchors = new Map<string, ScrollAnchor>()

  const mention = setupMentions(
    els,
    { query: "", selectedIndex: -1, mode: "mention" as const },
    (msg) => vscode.postMessage(msg)
  )

  // Slash command autocomplete
  const SLASH_COMMANDS = [
    { name: "/clear", description: "Clear conversation" },
    { name: "/model", description: "Switch model", args: " {id}" },
    { name: "/cost", description: "Show session cost" },
    { name: "/new", description: "New session" },
    { name: "/export", description: "Export conversation" },
    { name: "/compact", description: "Compact session context" },
    { name: "/continue", description: "Continue last session" },
    { name: "/help", description: "Show available commands" },
  ]

  let slashFiltered: typeof SLASH_COMMANDS = []
  let slashSelectedIndex = -1
  let slashVisible = false

  // Mode state: "plan" or "build"
  let currentMode = "build"

  // Pending image attachments queued for next send
  interface PendingAttachment {
    data: string
    mimeType: string
  }
  let pendingAttachments: PendingAttachment[] = []

  /* ─── INIT ─── */

  function init() {
    try {
      setupModeToggle()
      setupInput()
      setupButtons()
      setupSessionModal()
      setupWelcomeSuggestions()
      setupMessageListener()
      setupPermissionListener()
      setupDiffActionListener()
      setupSearch()
      updateSendButton()

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
    renderRecentSessionsList()
  }

  function hideWelcomeView() {
    els.welcomeView.classList.add("hidden")
  }

  /* ─── RECENT SESSIONS ─── */

  function renderRecentSessionsList() {
    const activeId = stateManager.getState().activeSessionId
    const sessions = stateManager.getAllSessions()
      .filter((s) => s.id !== activeId && s.messages.length > 0)
      .sort((a, b) => (b.messages.length || 0) - (a.messages.length || 0))
      .slice(0, 5)
      .map((s) => ({
        id: s.id,
        title: s.name,
        time: s.messages.length > 0 ? s.messages[s.messages.length - 1]?.timestamp : undefined,
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

  function openSessionModal(sessions: Array<{ id: string; title?: string; messageCount?: number; cost?: number; time?: number }>) {
    const body = els.sessionModalBody
    body.replaceChildren()

    if (!sessions || sessions.length === 0) {
      const empty = document.createElement("div")
      empty.className = "modal-empty"
      empty.textContent = "No previous sessions."
      body.appendChild(empty)
    } else {
      for (const s of sessions) {
        const item = document.createElement("div")
        item.className = "modal-session-item"

        const info = document.createElement("div")
        info.className = "modal-session-info"

        const name = document.createElement("div")
        name.className = "modal-session-name"
        name.textContent = s.title || "Session"
        info.appendChild(name)

        const meta = document.createElement("div")
        meta.className = "modal-session-meta"
        const parts: string[] = []
        if (s.messageCount != null) parts.push(`${s.messageCount} messages`)
        if (s.time) parts.push(new Date(s.time).toLocaleDateString())
        meta.textContent = parts.join(" · ")
        info.appendChild(meta)

        item.appendChild(info)

        if (s.cost && s.cost > 0) {
          const cost = document.createElement("span")
          cost.className = "modal-session-cost"
          cost.textContent = `$${s.cost.toFixed(2)}`
          item.appendChild(cost)
        }

        item.addEventListener("click", () => {
          closeSessionModal()
          vscode.postMessage({ type: "resume_session", sessionId: s.id })
        })

        body.appendChild(item)
      }
    }

    els.sessionModal.classList.remove("hidden")
  }

  function closeSessionModal() {
    els.sessionModal.classList.add("hidden")
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

  function createTabUI(tabId: string, tabName: string) {
    // Check if content already exists
    if (els.tabPanels.querySelector(`.tab-panel[data-tab-id="${tabId}"]`)) return

    const [view] = createTabContent(tabId, tabName)
    if (!view) return

    // Insert panel at the front
    const firstPanel = els.tabPanels.firstChild
    if (firstPanel) {
      els.tabPanels.insertBefore(view, firstPanel)
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

    // Scroll to bottom of active tab using anchor if available
    const anchor = scrollAnchors.get(tabId)
    if (anchor) {
      anchor.anchor()
    } else {
      const msgList = getActiveMessageList(els)
      if (msgList) scrollToBottom(msgList)
    }
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

    // Dispose scroll anchor for this tab
    const anchor = scrollAnchors.get(tabId)
    if (anchor) {
      anchor.dispose()
      scrollAnchors.delete(tabId)
    }

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
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${tabId}"]`)
    return view?.querySelector<HTMLDivElement>(".message-list") || null
  }

  function getTypingIndicator(tabId: string): HTMLDivElement | null {
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${tabId}"]`)
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
      streamingBlockId: null as string | null,
      streamingToolCallId: null as string | null,
      seenEventIds: new Set<string>(),
      lastStreamTextEl: null as HTMLElement | null,
    }

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

    return {
      ...stream,
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
  }

  /* ─── MODE TOGGLE ─── */

  function getModeButtons() {
    return {
      plan: els.modePlanBtn,
      auto: els.modeAutoBtn,
      build: els.modeBuildBtn,
    }
  }

  function setMode(mode: string) {
    currentMode = mode
    const buttons = getModeButtons()
    for (const [key, btn] of Object.entries(buttons)) {
      const isActive = key === mode
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-checked", String(isActive))
    }

    const active = stateManager.getActiveSession()
    if (active) {
      stateManager.setSessionMode(active.id, mode)
      vscode.postMessage({ type: "change_mode", mode, sessionId: active.id })
    }
  }

  function setupModeToggle() {
    const buttons = getModeButtons()
    for (const [mode, btn] of Object.entries(buttons)) {
      btn.addEventListener("click", () => {
        const active = stateManager.getActiveSession()
        if (active?.isStreaming) return
        setMode(mode)
      })
    }
  }

  function syncModeUI() {
    const active = stateManager.getActiveSession()
    const rawMode = active?.mode || "plan"
    currentMode = rawMode === "normal" ? "plan" : rawMode
    const buttons = getModeButtons()
    for (const [key, btn] of Object.entries(buttons)) {
      const isActive = key === currentMode
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-checked", String(isActive))
    }
    const isStreaming = active?.isStreaming ?? false
    for (const btn of Object.values(buttons)) {
      (btn as HTMLButtonElement).disabled = isStreaming
    }
  }

  /* ─── INPUT ─── */

  function renderSlashAutocomplete(items: typeof SLASH_COMMANDS) {
    const el = els.slashAutocomplete
    el.replaceChildren()
    if (items.length === 0) {
      el.classList.add("hidden")
      slashVisible = false
      return
    }
    const ul = document.createElement("ul")
    ul.className = "slash-autocomplete-list"
    for (let i = 0; i < items.length; i++) {
      const li = document.createElement("li")
      li.className = "slash-autocomplete-item"
      if (i === slashSelectedIndex) li.classList.add("selected")
      const name = document.createElement("span")
      name.className = "slash-name"
      name.textContent = items[i]!.name + (items[i]!.args || "")
      li.appendChild(name)
      const desc = document.createElement("span")
      desc.className = "slash-desc"
      desc.textContent = items[i]!.description
      li.appendChild(desc)
      li.addEventListener("click", () => selectSlashItem(i))
      ul.appendChild(li)
    }
    el.appendChild(ul)
    el.classList.remove("hidden")
    slashVisible = true
  }

  function hideSlashAutocomplete() {
    els.slashAutocomplete.classList.add("hidden")
    slashVisible = false
    slashSelectedIndex = -1
    slashFiltered = []
  }

  function selectSlashItem(index: number) {
    const item = slashFiltered[index]
    if (!item) return
    els.promptInput.value = item.name + (item.args ? item.args.replace("{id}", "") : "") + " "
    els.promptInput.focus()
    els.promptInput.setSelectionRange(els.promptInput.value.length, els.promptInput.value.length)
    hideSlashAutocomplete()
    autoResizeTextarea()
    updateSendButton()
  }

  function updateSlashAutocomplete() {
    const val = els.promptInput.value
    // Only trigger if / is the very first character of the entire input (multi-line safety)
    if (!val.startsWith("/") || val.includes("\n")) {
      hideSlashAutocomplete()
      return
    }
    const query = val.slice(1).toLowerCase()
    slashFiltered = SLASH_COMMANDS.filter(
      (c) => c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query)
    )
    slashSelectedIndex = -1
    renderSlashAutocomplete(slashFiltered)
  }

  function setupInput() {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    document.addEventListener("paste", onPaste)
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
    updateSlashAutocomplete()
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

    // Handle slash autocomplete keyboard navigation
    if (slashVisible) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        slashSelectedIndex = Math.min(slashSelectedIndex + 1, slashFiltered.length - 1)
        renderSlashAutocomplete(slashFiltered)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        slashSelectedIndex = Math.max(slashSelectedIndex - 1, -1)
        renderSlashAutocomplete(slashFiltered)
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (slashSelectedIndex >= 0) {
          selectSlashItem(slashSelectedIndex)
        } else if (slashFiltered.length === 1) {
          selectSlashItem(0)
        } else {
          hideSlashAutocomplete()
          sendMessage()
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        hideSlashAutocomplete()
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
            updateSendButton()
          }
        }
        reader.readAsDataURL(blob)
        break
      }
    }
  }

  function renderAttachmentChips() {
    const existing = els.inputArea.querySelector(".attachment-chips")
    if (existing) existing.remove()

    if (pendingAttachments.length === 0) return

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
      remove.innerHTML = REMOVE_SVG
      remove.addEventListener("click", () => {
        pendingAttachments.splice(idx, 1)
        renderAttachmentChips()
        updateSendButton()
      })
      chip.appendChild(remove)
      container.appendChild(chip)
    })

    els.inputArea.insertBefore(container, els.inputWrapper)
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

  function sendMessage() {
    const text = els.promptInput.value.trim()
    let active = stateManager.getActiveSession()

    if (active?.isStreaming) {
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
      switch (cmd) {
        case "/clear":
          // Delegate to extension host — preserves session in history, creates new server session
          vscode.postMessage({ type: "execute_command", command: "/clear", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        case "/model":
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
        case "/continue":
          // Delegate to extension host — resumes most recently closed session
          vscode.postMessage({ type: "execute_command", command: "/continue", sessionId: active.id })
          els.promptInput.value = ""
          autoResizeTextarea()
          updateSendButton()
          return
        default: {
          // Unknown slash command — show inline error, not crash
          showSystemMessage(active.id, `Unknown command: ${cmd}. Type /help for available commands.`)
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
    updateSendButton()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId: active.id,
      messageId: msgObj.id,
      model: active.model,
      mode: active.mode,
      ...(attachments.length > 0 ? { attachments } : {}),
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
    // NOTE: newTabBtn click is handled by createTabBar in tabs.ts
    // to avoid duplicate listeners. Do NOT add another listener here.
    
    els.historyBtn.addEventListener("click", () => {
      els.sessionModal.classList.remove("hidden")
      els.sessionModalBody.innerHTML = '<div class="modal-empty">Loading sessions...</div>'
      vscode.postMessage({ type: "list_sessions" })
    })
    
    els.mcpBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "open_mcp_settings" })
    })
    
    els.settingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "open_settings" })
    })
     
     els.attachBtn?.addEventListener("click", () => {
       vscode.postMessage({ type: "attach_files" })
     })
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

  function showSystemMessage(sessionId: string, text: string) {
    const msg: ChatMessage = {
      role: "system",
              id: "sys-" + crypto.randomUUID(),
      blocks: [{ type: "text", text }],
      timestamp: Date.now(),
      sessionId,
    }
    addMessage(sessionId, msg)
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
      const welcome = msgList.querySelector(".welcome-container")
      if (welcome) welcome.remove()

      const el = renderMessage(msg, { mode: session.mode })
      msgList.appendChild(el)
      const anchor = scrollAnchors.get(sessionId)
      if (anchor) {
        anchor.scrollIfAnchored()
      } else {
        scrollToBottom(msgList)
      }
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
          {
            const sessions = (msg.sessions || []) as SessionSummary[]
            openSessionModal(sessions)
          }
          break
        case "resume_session_data": {
          const session = msg.session as import("./types").SessionState | undefined
          if (session) {
            stateManager.ensureSession(session)
            createTabUI(session.id, session.name)
            const msgList = getMessageList(session.id)
            if (msgList) {
              msgList.replaceChildren()
              session.messages.forEach((m) => msgList.appendChild(renderMessage(m, { mode: session.mode })))
            }
            switchTab(session.id)
            hideWelcomeView()
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
              id: "tool-" + crypto.randomUUID(),
              blocks: [{
                type: "tool_call",
                toolName: String(msg.toolName || "tool"),
                result: typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result ?? ""),
                state: "result",
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
              id: "perm-" + crypto.randomUUID(),
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
              id: "file-" + crypto.randomUUID(),
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
            // Apply persisted disabled state to incoming models
            const modelsWithState = stateManager.applyDisabledState(msg.items as ModelInfo[])
            const currentModel = msg.model as string || stateManager.getState().globalModel
            modelDropdown.render(modelsWithState, currentModel)
            modelManager.setModels(modelsWithState)
            // Update model label to actual name instead of "Default"
            if (currentModel) {
              modelDropdown.setCurrentModel(currentModel)
              const model = modelsWithState.find((m) => `${m.provider}/${m.id}` === currentModel)
              variantSelector.setModel(model || null)
            }
          }
          break
        case "init_state": {
          if (window.__opencodeInitTimeout) {
            clearTimeout(window.__opencodeInitTimeout)
            window.__opencodeInitTimeout = undefined
          }
          if (!stateManager.getState().initialized) {
            stateManager.setInitialized()
          }

          const sessions = (msg.sessions || []) as import("./types").SessionState[]
          if (sessions.length > 0) {
            stateManager.loadSessions(sessions, msg.activeSessionId as string | null, msg.globalModel as string)

            if (msg.globalModel) {
              modelDropdown.setCurrentModel(msg.globalModel as string)
            }
            // Request models to populate names and variant support
            vscode.postMessage({ type: "get_models" })

            // Create UI for loaded sessions and hide welcome view
            sessions.forEach((s) => {
              if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${s.id}"]`)) {
                createTabUI(s.id, s.name)
              }
            })

            const activeId = stateManager.getState().activeSessionId
            if (activeId) {
              switchToTab(els, activeId)
              hideWelcomeView()
            }

            syncModeUI()
            updateTabBar()
          } else {
            // No sessions — show welcome view, don't create an empty "Default" session
            showWelcomeView()
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
        case "session_renamed":
          if (typeof msg.sessionId === "string" && typeof msg.name === "string") {
            stateManager.renameSession(msg.sessionId, msg.name)
            updateTabBar()
          }
          break
        case "compaction_started":
          if (sessionId) {
            showSystemMessage(sessionId, "Compacting session...")
          }
          break
        case "session_compacted":
          if (sessionId) {
            showSystemMessage(sessionId, "Session compacted successfully.")
          }
          break
        case "command_list": {
          const commands = (msg.commands || []) as Array<{ name: string; description?: string; template: string }>
          mention.updateServerCommands(commands)
          const active = stateManager.getActiveSession()
          if (active && commands.length > 0) {
            const lines = commands.map(c => `/${c.name} \u2014 ${c.description || c.template}`).join("\n")
            showSystemMessage(active.id, `Available commands:\n${lines}`)
          }
          break
        }
        case "prefill_prompt":
          if (typeof msg.text === "string") {
            els.promptInput.value = msg.text
            autoResizeTextarea()
            updateSendButton()
            els.promptInput.focus()
            if (msg.autoSend) sendMessage()
          }
          break
        case "edit_message_prefill":
          if (sessionId && typeof msg.messageId === "string" && typeof msg.text === "string") {
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
              els.promptInput.value = msg.text as string
              autoResizeTextarea()
              updateSendButton()
              els.promptInput.focus()
            }
          }
          break
        case "insert_text":
          if (typeof msg.text === "string") {
            insertTextAtCursor(msg.text)
          }
          break
        case "skill_indicator":
          // Compact skill indicator — shown as small pill near typing area
          // instead of flooding the message list
          if (sessionId && typeof msg.skillName === "string") {
            showSkillIndicator(sessionId, msg.skillName as string)
          }
          break
      }
    })
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
    syncModeUI()
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
    // Clear any stale "file_edited" banners when new streaming starts
    const msgList = getMessageList(sessionId)
    if (msgList) {
      const staleBanners = msgList.querySelectorAll(".task-banner")
      staleBanners.forEach(b => {
        if (b.textContent?.includes("Edited")) b.remove()
      })
    }
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
      // Global error - find any streaming session
      const sessions = stateManager.getAllSessions()
      const streaming = sessions.find(s => s.isStreaming)
      if (streaming) sessionId = streaming.id
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

  try {
    init()
    vscode.postMessage({ type: "webview_ready" })
  } catch (err) {
    console.error("[OpenCode] Fatal init error:", err)
  }
})()
