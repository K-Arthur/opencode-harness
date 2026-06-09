import type { WebviewState, ChatMessage } from "./types"
import type { ElementRefs } from "./dom"
import { TOOLTIPS } from "./tooltips"

export interface StreamCapacityState {
  isFull: boolean
  streamingNames: string
  activeStreams: number
}

let _maxConcurrentStreams = 5
export function setMaxConcurrentStreams(max: number): void {
  if (max >= 1 && max <= 10) _maxConcurrentStreams = max
}
export function getMaxConcurrentStreams(): number { return _maxConcurrentStreams }
/** @deprecated Use getMaxConcurrentStreams() for runtime checks */
export const MAX_CONCURRENT_STREAMS = 5

export interface SendLogicDeps {
  els: ElementRefs
  stateManager: {
    getState: () => WebviewState
    getActiveSession: () => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string; steerMode?: "interrupt" | "append" | "queue" } | null
    getSession: (id: string) => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string; steerMode?: "interrupt" | "append" | "queue"; messages: any[] } | undefined
    getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
    setStreaming: (id: string, streaming: boolean) => void
    setSessionSteerMode?: (id: string, mode: "interrupt" | "append" | "queue") => void
  }
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
  attachmentManager: {
    getAttachments: () => Array<{ data: string; mimeType: string }>
    clearAttachments: () => void
  }
  streamHandlers: {
    get: (id: string) => { showTypingIndicator: (msg: string) => void } | undefined
  }
  modelDropdown: {
    getCurrentModel: () => string | undefined
  }
  hideWelcomeView: () => void
  handleRequestError: (sessionId: string, msg: string) => void
  addMessage: (sessionId: string, msg: ChatMessage) => void
  updateTabBar: () => void
  switchTab: (id: string) => void
  switchToTab: (id: string) => void
  createTabUI: (id: string, name: string) => void
  createNewTab: (name?: string) => { id: string; name: string; mode?: string } | undefined
  updateAgentStatus: (status: string) => void
  updateModeSelectorState: () => void
  renderAttachmentChips: () => void
  autoResizeTextarea: () => void
  runSlashCommandText: (
    text: string,
    active: { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string },
  ) => void
  openModelManager: () => void
  STREAM_LIMIT_TOOLTIP: string
}

function createWebviewId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

export function createSendLogic(deps: SendLogicDeps) {
  const {
    els,
    stateManager,
    vscode,
    attachmentManager,
    streamHandlers,
    modelDropdown,
    hideWelcomeView,
    handleRequestError,
    addMessage,
    updateTabBar,
    switchTab,
    switchToTab,
    createTabUI,
    createNewTab,
    updateAgentStatus,
    updateModeSelectorState,
    renderAttachmentChips,
    autoResizeTextarea,
    runSlashCommandText,
    openModelManager,
    STREAM_LIMIT_TOOLTIP,
  } = deps

  function getCurrentSteerMode(): "interrupt" | "append" | "queue" {
    const active = stateManager.getActiveSession()
    return active?.steerMode || "interrupt"
  }

  function getStreamCapacityState(): StreamCapacityState {
    const streamingSessions = stateManager.getAllSessions().filter((s) => s.isStreaming)
    const activeStreams = streamingSessions.length
    const isFull = activeStreams >= _maxConcurrentStreams
    const streamingNames = streamingSessions
      .map((s) => {
        const session = stateManager.getSession(s.id)
        return session?.name?.split("\n")[0]?.slice(0, 30) || s.id.slice(0, 8)
      })
      .filter(Boolean)
      .join(", ")
    return { isFull, streamingNames, activeStreams }
  }

  function updateSendButtonIcon(isStreaming?: boolean, streamCapacity = getStreamCapacityState()) {
    const active = stateManager.getActiveSession()
    const streaming = isStreaming ?? active?.isStreaming ?? false
    if (streaming) {
      els.sendBtn?.classList.add("stopping")
      els.sendBtn?.classList.remove("stream-limit-blocked")
      els.sendBtn?.setAttribute("aria-label", "Stop generation")
      els.sendBtn?.setAttribute("title", TOOLTIPS.chat.stop)
    } else if (streamCapacity.isFull) {
      els.sendBtn?.classList.remove("stopping")
      els.sendBtn?.classList.add("stream-limit-blocked")
      const limitLabel = streamCapacity.streamingNames
        ? TOOLTIPS.chat.sendBlockedByLimit(streamCapacity.streamingNames)
        : STREAM_LIMIT_TOOLTIP
      els.sendBtn?.setAttribute("aria-label", limitLabel)
      els.sendBtn?.setAttribute("title", limitLabel)
    } else {
      els.sendBtn?.classList.remove("stopping")
      els.sendBtn?.classList.remove("stream-limit-blocked")
      els.sendBtn?.setAttribute("aria-label", "Send message")
      els.sendBtn?.setAttribute("title", TOOLTIPS.chat.send)
    }
  }

  function resolveSendModel(active?: { model?: string } | null): string | undefined {
    return active?.model || modelDropdown.getCurrentModel() || stateManager.getState().globalModel
  }

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0
    const hasAttachments = attachmentManager.getAttachments().length > 0
    const active = stateManager.getActiveSession()
    const isStreaming = active?.isStreaming || false
    const streamCapacity = getStreamCapacityState()
    const blockedByStreamLimit = !isStreaming && streamCapacity.isFull
    const hasModel = isStreaming || !!resolveSendModel(active)
    const canSubmit = hasModel && (isStreaming || ((hasText || hasAttachments) && !blockedByStreamLimit))
    ;(els.sendBtn as HTMLButtonElement).disabled = !canSubmit
    els.sendBtn?.classList.toggle("stream-limit-blocked", blockedByStreamLimit)
    const blockedByModel = !hasModel && !isStreaming
    els.sendBtn?.classList.toggle("no-model-blocked", blockedByModel)
    if (blockedByModel) {
      els.sendBtn?.setAttribute("aria-label", "Select a model first")
      els.sendBtn?.setAttribute("title", "Select a model first")
    }
    updateSendButtonIcon(isStreaming, streamCapacity)
    updateModeSelectorState()
  }

  function setSteerMode(mode: "interrupt" | "append" | "queue") {
    const active = stateManager.getActiveSession()
    if (active && stateManager.setSessionSteerMode) {
      stateManager.setSessionSteerMode(active.id, mode)
    }
    document.querySelectorAll<HTMLElement>(".steer-mode-btn").forEach((btn) => {
      const isActive = btn.dataset.mode === mode
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-checked", String(isActive))
    })
    const btn = document.getElementById(`steer-mode-${mode}`)
    if (btn) {
      btn.classList.add("active")
      btn.setAttribute("aria-checked", "true")
    }
    els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
    els.inputArea.classList.add(`steer-${mode}`)
  }

  function syncSteerModeUI() {
    setSteerMode(getCurrentSteerMode())
  }

  function getSteerMode(): "interrupt" | "append" | "queue" {
    return getCurrentSteerMode()
  }

  function sendSteerPrompt() {
    const active = stateManager.getActiveSession()
    if (!active) return
    const text = els.promptInput.value.trim()
    const attachments = attachmentManager.getAttachments()
    if (!text && attachments.length === 0) return
    attachmentManager.clearAttachments()
    renderAttachmentChips()
    vscode.postMessage({
      type: "send_steer_prompt",
      text,
      sessionId: active.id,
      mode: getCurrentSteerMode(),
      ...(attachments.length > 0 ? { attachments } : {}),
    })
    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()
  }

  function abortStream() {
    const active = stateManager.getActiveSession()
    if (!active) return
    streamHandlers.get(active.id)?.showTypingIndicator("Stopping...")
    updateAgentStatus("idle")
    vscode.postMessage({ type: "abort", sessionId: active.id })
  }

  function generateTitle(text: string): string {
    if (!text.trim()) return ""
    const firstSentence = text.split(/[.!?\n]/)[0] || text
    const trimmed = firstSentence.trim()
    if (trimmed.length > 40) return trimmed.slice(0, 37).trimEnd() + "..."
    return trimmed
  }

  function isAutoSessionName(name?: string): boolean {
    const raw = (name || "").trim()
    return /^New Chat\b/i.test(raw) || /^Tab session\b/i.test(raw)
  }

  function handleNoModelSelected() {
    openModelManager()
    els.promptInput.placeholder = "Select a model to continue..."
    updateSendButton()
  }

  function sendMessage() {
    const text = els.promptInput.value.trim()
    let active = stateManager.getActiveSession()

    if (active?.isStreaming) {
      if (text || attachmentManager.getAttachments().length > 0) {
        sendSteerPrompt()
      } else {
        abortStream()
      }
      return
    }

    if (!text && attachmentManager.getAttachments().length === 0) return

    // Resolve model before any mutations — if missing, open picker without losing prompt
    const sendModel = resolveSendModel(active)
    if (!sendModel) {
      handleNoModelSelected()
      return
    }

    if (!active) {
      const title = generateTitle(text)
      const tab = createNewTab(title)
      if (!tab) return
      active = stateManager.getSession(tab.id) || (tab as any)
    }

    if (!active) return

    hideWelcomeView()

    const streamCapacity = getStreamCapacityState()
    if (streamCapacity.isFull) {
      updateSendButton()
      handleRequestError(
        active.id,
        streamCapacity.streamingNames
          ? TOOLTIPS.limits.streamCapWithNames(streamCapacity.streamingNames)
          : `${STREAM_LIMIT_TOOLTIP}. Stop a streaming tab to free a slot.`,
      )
      return
    }

    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${active.id}"]`)) {
      createTabUI(active.id, active.name || "")
      switchToTab(active.id)
      updateTabBar()
    } else if (stateManager.getState().activeSessionId !== active.id) {
      switchTab(active.id)
    }

    if (text.startsWith("/")) {
      runSlashCommandText(text, active)
      return
    }

    const attachments = attachmentManager.getAttachments()

    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()

    const msgObj: ChatMessage = {
      role: "user",
      id: createWebviewId("user"),
      blocks: [
        ...(text ? [{ type: "text" as const, text }] : []),
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
    updateModeSelectorState()
    updateSendButton()

    const stream = streamHandlers.get(active.id)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    const sendVariant = stateManager.getState().sessions[active.id]?.variant || stateManager.getState().globalVariant || undefined
    const clientRequestId = createWebviewId("req")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId: active.id,
      messageId: msgObj.id,
      clientRequestId,
      model: sendModel,
      mode: active.mode,
      ...(sendVariant ? { variant: sendVariant } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    })
  }

  return {
    getStreamCapacityState,
    updateSendButtonIcon,
    updateSendButton,
    sendMessage,
    abortStream,
    generateTitle,
    isAutoSessionName,
    sendSteerPrompt,
    setSteerMode,
    syncSteerModeUI,
    getSteerMode,
  }
}
