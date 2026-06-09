import type { ChatMessage } from "../../types"
import type { ElementRefs } from "./dom"
import type { ToolCallState } from "./types"
import type { StreamHandlers } from "./stream"
import { timers } from "./timerRegistry"
import type { ToolElapsedTracker } from "./ui/toolElapsed"
import type { PromptQueue } from "./queue"
import { placeholderHasRenderedContent } from "./placeholderContent"

export interface StreamOrchestratorDeps {
  vscode: { postMessage(msg: Record<string, unknown>): void }
  els: ElementRefs
  streamHandlers: Map<string, StreamHandlers>
  getState: () => { activeSessionId: string | null; globalModel: string }
  getSession: (id: string) => { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; changedFiles?: string[]; [k: string]: unknown } | undefined
  getAllSessions: () => Array<{ id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; [k: string]: unknown }>
  ensureSession: (init: { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean }) => { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; [k: string]: unknown }
  setStreaming: (sessionId: string, streaming: boolean) => void
  save: () => void
  createWebviewId: (prefix: string) => string
  addMessage: (sessionId: string, msg: ChatMessage) => void
  showSystemMessage: (sessionId: string, text: string, retryable?: boolean) => void
  createTabUI: (tabId: string, tabName: string) => void
  switchTab: (tabId: string, notifyHost?: boolean) => void
  hideWelcomeView: () => void
  updateTabBar: () => void
  updateModeSelectorStateLocal: () => void
  updateSendButtonIcon: (isStreaming?: boolean) => void
  updateSendButton: () => void
  getMessageList: (tabId: string) => HTMLDivElement | null
  createStreamHandlersForTab: (tabId: string) => StreamHandlers
  setupJumpToBottom: (sessionId: string) => void
  debouncedUpdateScrollMarkers: (sessionId: string) => void
  debouncedTimelineRefresh: (sessionId: string) => void
  refreshConversationTimeline: (sessionId: string) => void
  toolElapsedTracker: ToolElapsedTracker
  promptQueues: Map<string, PromptQueue>
  renderQueue: (tabId: string) => void
  syncModeUI: () => void
  renderRecentSessionsList: () => void
  persistQueues: () => void
}

export interface StreamOrchestratorAPI {
  handleStreamStart: (sessionId: string, messageId?: string) => void
  handleStreamChunk: (sessionId: string, text?: string, messageId?: string) => void
  handleStreamEnd: (sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) => void
  handleServerStatus: (sessionId: string, status?: string, errorContext?: unknown) => void
  handleRequestError: (sessionId: string | undefined, message?: string, errorContext?: unknown) => void
  handleDiffResult: (sessionId?: string, blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) => void
  handleHostMessage: (msg: ChatMessage) => void
  handleCostUpdate: (sessionId: string, cost: number) => void
  sendQueuedPrompt: (sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) => void
  scheduleToolUpdate: (sessionId: string, toolId: string, update: { state?: ToolCallState; args?: unknown }) => void
  flushToolUpdate: (sessionId: string, toolId: string) => void
  markToolChainProgress: (sessionId: string) => void
  clearToolChainProgress: (sessionId: string) => void
  updateAgentStatus: (status: "idle" | "thinking" | "executing") => void
  showSkillIndicator: (sessionId: string, skillName: string) => void
}

export function createStreamOrchestrator(deps: StreamOrchestratorDeps): StreamOrchestratorAPI {
  const {
    vscode,
    els,
    streamHandlers,
    getState,
    getSession,
    getAllSessions,
    ensureSession,
    setStreaming,
    save,
    createWebviewId,
    addMessage,
    showSystemMessage,
    createTabUI,
    switchTab,
    hideWelcomeView,
    updateTabBar,
    updateModeSelectorStateLocal,
    updateSendButtonIcon,
    updateSendButton,
    getMessageList,
    createStreamHandlersForTab,
    setupJumpToBottom,
    debouncedUpdateScrollMarkers,
    debouncedTimelineRefresh,
    refreshConversationTimeline,
    toolElapsedTracker,
    promptQueues,
    renderQueue,
    syncModeUI,
    renderRecentSessionsList,
    persistQueues,
  } = deps

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

  function updateAgentStatus(status: "idle" | "thinking" | "executing") {
    els.agentStatusLed.className = `status-led ${status}`
    els.agentStatusText.textContent = status === "idle" ? "SYSTEM READY" : status.toUpperCase()
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

  function handleStreamStart(sessionId: string, messageId?: string) {
    let session = getSession(sessionId)
    if (!session) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: Session ${sessionId} not in state, ensuring it` })
      session = ensureSession({
        id: sessionId,
        name: "New Session",
        model: getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
    }

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

    if (getState().activeSessionId !== sessionId) {
      vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Switching to tab ${sessionId}` })
      switchTab(sessionId)
    }
    hideWelcomeView()
    updateTabBar()

    vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Starting stream for ${sessionId} (msgId=${messageId})` })
    finalStream.handleStreamStart(messageId)
    setStreaming(sessionId, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateAgentStatus("thinking")
    const activeMsgList = getMessageList(sessionId)
    if (activeMsgList) {
      if (!activeMsgList.querySelector(".jump-to-bottom")) {
        setupJumpToBottom(sessionId)
      }
      debouncedUpdateScrollMarkers(sessionId)
    }
  }

  let chunkLogCounter = 0
  function handleStreamChunk(sessionId: string, text?: string, messageId?: string) {
    if (!getSession(sessionId)) {
      ensureSession({
        id: sessionId,
        name: "New Session",
        model: getState().globalModel || "",
        mode: "build",
        messages: [],
        isStreaming: false,
      })
    }
    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)) {
      const sess = getSession(sessionId)
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

  /**
   * Webview-side drain is disabled — host owns all draining via onQueueDrain.
   * The webview queue is a read-only render cache populated from host queue_state.
   */
  function processQueueIfReady(_sessionId: string, _reason?: string): void {
    return
  }

  function processStreamEndBlocks(sessionId: string, messageId?: string, blocks?: unknown) {
    const blockList = Array.isArray(blocks) ? blocks as ChatMessage["blocks"] : []
    if (blockList.length === 0) return

    const msgList = getMessageList(sessionId)
    if (messageId && msgList) {
      const placeholder = msgList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
      // M7: only remove a placeholder that has neither text nor tool/diff/skill
      // blocks — a text-less turn that still showed tool calls must survive.
      if (placeholder && !placeholderHasRenderedContent(placeholder)) {
        placeholder.remove()
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
          vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd: stream handler threw: ${err instanceof Error ? err.message : err}` })
        }
      }

      processStreamEndBlocks(sessionId, messageId, blocks)

      setStreaming(sessionId, false)
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
      debouncedTimelineRefresh(sessionId)

      showStreamEndReasonMessage(sessionId, reason, partial)

      if (sessionId === getState().activeSessionId) {
        updateSendButtonIcon(false)
        updateSendButton()
      }

      processQueueIfReady(sessionId, reason)
    } catch (err) {
      vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd error: ${err instanceof Error ? err.message : String(err)}` })
      try { setStreaming(sessionId, false) } catch (e) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `setStreaming recovery failed: ${e instanceof Error ? e.message : e}` })
      }
      try { updateTabBar() } catch (e) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `updateTabBar recovery failed: ${e instanceof Error ? e.message : e}` })
      }
      try { updateModeSelectorStateLocal() } catch (e) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `updateModeSelector recovery failed: ${e instanceof Error ? e.message : e}` })
      }
      try { updateAgentStatus("idle") } catch (e) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `updateAgentStatus recovery failed: ${e instanceof Error ? e.message : e}` })
      }
      const msg = reason === "ttfb_timeout" ? "Model took too long. Try a different model."
        : reason === "timeout" ? "Response timed out."
        : reason === "error" ? "An error occurred."
        : "Unexpected error."
      try { showSystemMessage(sessionId, msg) } catch (e) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `showSystemMessage recovery failed: ${e instanceof Error ? e.message : e}` })
      }
    }
  }

  function sendQueuedPrompt(sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) {
    const active = getSession(sessionId)
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
    setStreaming(sessionId, true)
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

  function handleRequestError(sessionId: string | undefined, message?: string, errorContext?: unknown) {
    if (!sessionId) {
      const sessions = getAllSessions()
      const streaming = sessions.find(s => s.isStreaming)
      if (streaming) sessionId = streaming.id
      else return
    }

    setStreaming(sessionId, false)
    updateTabBar()
    updateModeSelectorStateLocal()

    const stream = streamHandlers.get(sessionId)
    if (stream) {
      stream.handleRequestError(message, errorContext)
    }

    if (sessionId === getState().activeSessionId) {
      updateSendButtonIcon(false)
      updateSendButton()
    }
  }

  function handleDiffResult(sessionId: string | undefined, blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) {
    if (sessionId) {
      const stream = streamHandlers.get(sessionId)
      if (stream) stream.handleDiffResult(blockId, ok, message)
    } else {
      // Fallback: broadcast to all sessions only when sessionId is unknown
      for (const [, stream] of streamHandlers) {
        stream.handleDiffResult(blockId, ok, message)
      }
    }
    if (ok && checkpointCreated) {
      const activeId = getState().activeSessionId
      if (activeId) {
        showSystemMessage(activeId, "Checkpoint saved — you can revert via OpenCode: Rollback Changes")
      }
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
      setStreaming(msg.sessionId, false)
      updateTabBar()
      updateModeSelectorStateLocal()
      updateSendButton()
      updateAgentStatus("idle")
    }
    syncModeUI()
  }

  function handleCostUpdate(sessionId: string, cost: number) {
    if (!Number.isFinite(cost)) return
    const session = getSession(sessionId)
    if (session) {
      (session as any).cost = cost
      save()
      renderRecentSessionsList()
    }
  }

  return {
    handleStreamStart,
    handleStreamChunk,
    handleStreamEnd,
    handleServerStatus,
    handleRequestError,
    handleDiffResult,
    handleHostMessage,
    handleCostUpdate,
    sendQueuedPrompt,
    scheduleToolUpdate,
    flushToolUpdate,
    markToolChainProgress,
    clearToolChainProgress,
    updateAgentStatus,
    showSkillIndicator,
  }
}
