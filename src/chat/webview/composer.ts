import type { WebviewState, ChatMessage } from "./types"
import type { CommandEntry } from "./commands-modal"
import { createPromptQueue, type PromptQueue, type QueueItem } from "./queue"
import type { ElementRefs } from "./dom"
import { REMOVE_SVG } from "./icons"

export interface ComposerDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
    getState: <T>() => T | undefined
    setState: (state: WebviewState) => void
  }
  stateManager: {
    getState: () => WebviewState
    getActiveSession: () => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null
    getSession: (id: string) => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string; messages: any[] } | undefined
    getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
    getActiveSessionId: () => string | undefined
    setStreaming: (id: string, streaming: boolean) => void
    setSessionModel: (id: string, model: string) => void
    setGlobalModel: (model: string) => void
    save: () => void
    ensureSession: (init: any) => any
  }
  attachmentManager: {
    onPaste: (e: ClipboardEvent) => void
    getAttachments: () => Array<{ data: string; mimeType: string }>
    clearAttachments: () => void
    updatePromptContextChips: () => void
    renderAttachmentChips: () => void
    attachImageBlob: (file: File) => void
  }
  mention: {
    handleTrigger: () => void
    handleKeydown: (e: KeyboardEvent) => void
  }
  modelDropdown: {
    getCurrentModel: () => string | undefined
    open: () => void
    render: (models: any[], currentModel?: string) => void
    setCurrentModel: (model: string) => void
  }
  modelManager: {
    getAllModels: () => any[]
    setModels: (models: any[]) => void
  }
  commandsModal: {
    open: () => void
  }
  streamHandlers: {
    get: (id: string) => { showTypingIndicator: (msg: string) => void } | undefined
  }
  tabBar: {
    renderTabs: (sessions: any[]) => void
  }
  timers: {
    setTimeout: (fn: (...args: any[]) => void, ms: number) => any
  }
  promptQueues: Map<string, PromptQueue>
  hideWelcomeView: () => void
  showSystemMessage: (sessionId: string, msg: string) => void
  handleRequestError: (sessionId: string, msg: string) => void
  addMessage: (sessionId: string, msg: ChatMessage) => void
  updateTabBar: () => void
  switchTab: (id: string) => void
  switchToTab: (id: string) => void
  createTabUI: (id: string, name: string) => void
  createNewTab: (name?: string) => { id: string; name: string; mode?: string } | undefined
  closeTab: (id: string) => void
  updateAgentStatus: (status: string) => void
  syncModelViews: (models?: any[]) => void
  updateModeSelectorState: () => void
  renderRecentSessionsList: () => void
  debouncedUpdateScrollMarkers: (sessionId: string) => void
  STREAM_LIMIT_TOOLTIP: string
  getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
}

export interface ComposerAPI {
  setupInput: () => void
  sendMessage: () => void
  abortStream: () => void
  sendSteerPrompt: () => void
  persistQueues: () => void
  restoreQueues: () => void
  renderQueue: (tabId: string) => void
  updateSendButton: () => void
  updateSendButtonIcon: (isStreaming?: boolean, streamCapacity?: StreamCapacityState) => void
  updateQueueSendButton: () => void
  autoResizeTextarea: () => void
  getStreamCapacityState: () => StreamCapacityState
  isAutoSessionName: (name?: string) => boolean
  insertTextAtCursor: (text: string) => void
  runCommandEntry: (entry: CommandEntry) => void
  insertIntoPrompt: (text: string) => void
  setSteerMode: (mode: "interrupt" | "append" | "queue") => void
  onInputChange: () => void
  onInputKeydown: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  updatePromptContextChips: () => void
  renderAttachmentChips: () => void
  generateTitle: (text: string) => string
  formatTokenCount: (n: number) => string
  wireChipReorderHandlers: (chip: HTMLElement, itemId: string, tabId: string, queue: PromptQueue) => void
}

interface StreamCapacityState {
  isFull: boolean
  streamingNames: string
  activeStreams: number
}

export function createComposer(deps: ComposerDeps): ComposerAPI {
  const {
    els, vscode, stateManager, attachmentManager, mention,
    modelDropdown, modelManager, commandsModal, streamHandlers,
    tabBar, timers, promptQueues,
    hideWelcomeView, showSystemMessage, handleRequestError,
    addMessage, updateTabBar, switchTab, switchToTab,
    createTabUI, createNewTab, closeTab,
    updateAgentStatus, syncModelViews, updateModeSelectorState,
    renderRecentSessionsList, debouncedUpdateScrollMarkers,
    STREAM_LIMIT_TOOLTIP,
  } = deps

  let currentSteerMode: 'interrupt' | 'append' | 'queue' = 'interrupt'

  const MAX_CONCURRENT_STREAMS = 3

  function createWebviewId(prefix: string): string {
    const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
    const id = randomUUID
      ? randomUUID.call(globalThis.crypto)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    return `${prefix}-${id}`
  }

  function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
    return String(n)
  }

  function runCommandEntry(entry: CommandEntry): void {
    const active = stateManager.getActiveSession()
    if (!active) return
    if (entry.source === "local") {
      runSlashCommandText(entry.insertText || `/${entry.name}`, active)
      return
    }
    if ((entry as any).run) {
      ;(entry as any).run()
      return
    }
    vscode.postMessage({ type: "execute_command", command: `/${entry.name}`, sessionId: active.id })
  }

  function insertIntoPrompt(text: string): void {
    els.promptInput.value = text
    autoResizeTextarea()
    updateSendButton()
    els.promptInput.focus()
  }

  function setSteerMode(mode: 'interrupt' | 'append' | 'queue') {
    currentSteerMode = mode
    ;(els as any).steerModeSelector?.querySelectorAll(".steer-option").forEach((btn: Element) => btn.classList.remove("active"))
    const btn = document.getElementById(`steer-mode-${mode}`)
    if (btn) btn.classList.add("active")
    els.inputArea.classList.remove("steer-interrupt", "steer-append", "steer-queue")
    els.inputArea.classList.add(`steer-${mode}`)
  }

  function autoResizeTextarea(): void {
    if (!els.promptInput) return
    const el = els.promptInput
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  function getStreamCapacityState(): StreamCapacityState {
    const streamingSessions = stateManager.getAllSessions().filter((s) => s.isStreaming)
    const activeStreams = streamingSessions.length
    const isFull = activeStreams >= MAX_CONCURRENT_STREAMS
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

  function updateSendButton() {
    const hasText = els.promptInput.value.trim().length > 0
    const hasAttachments = attachmentManager.getAttachments().length > 0
    const active = stateManager.getActiveSession()
    const isStreaming = active?.isStreaming || false
    const streamCapacity = getStreamCapacityState()
    const blockedByStreamLimit = !isStreaming && streamCapacity.isFull
    const canSubmit = isStreaming || ((hasText || hasAttachments) && !blockedByStreamLimit)
    ;(els.sendBtn as HTMLButtonElement).disabled = !canSubmit
    els.sendBtn?.classList.toggle("stream-limit-blocked", blockedByStreamLimit)
    updateSendButtonIcon(isStreaming, streamCapacity)
    updateModeSelectorState()
  }

  function persistQueues() {
    const state = vscode.getState<WebviewState>()
    if (!state) return
    const snapshot: Record<string, QueueItem[]> = {}
    for (const [sid, q] of promptQueues.entries()) {
      const items = q.persist().filter((i: QueueItem) => i.state === "queued" || i.state === "failed")
      if (items.length > 0) snapshot[sid] = items
    }
    vscode.setState({ ...state, queues: snapshot } as WebviewState)
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
    const queuedCount = items.filter((i: QueueItem) => i.state === "queued").length
    const totalTokens = queue.getTotalEstimatedTokens()

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

  function wireChipReorderHandlers(
    chip: HTMLElement,
    itemId: string,
    tabId: string,
    queue: PromptQueue,
  ) {
    function indexOf(id: string): number {
      return queue.getItems().findIndex((i: QueueItem) => i.id === id)
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
      let finalTo = toIdx
      if (fromIdx < toIdx && before) finalTo = toIdx - 1
      if (fromIdx > toIdx && !before) finalTo = toIdx + 1
      const ok = queue.reorder(fromIdx, finalTo)
      clearAllDropMarkers()
      if (ok) {
        persistQueues()
        renderQueue(tabId)
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
    const qCount = queue ? queue.getItems().filter((i: QueueItem) => i.state === "queued").length : 0
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
    const attachments = attachmentManager.getAttachments()
    if (!text && attachments.length === 0) return
    attachmentManager.clearAttachments()
    renderAttachmentChips()
    vscode.postMessage({
      type: "steer_prompt",
      text,
      sessionId: active.id,
      mode: currentSteerMode,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()
  }

  function clearPromptInput(): void {
    els.promptInput.value = ""
    autoResizeTextarea()
    updateSendButton()
  }

  function runSlashCommandText(
    text: string,
    active: NonNullable<ReturnType<ComposerDeps["stateManager"]["getActiveSession"]>>,
  ): void {
    const parts = text.split(/\s+/)
    const cmd = (parts[0] || "").toLowerCase()
    const commandArgs = parts.slice(1).join(" ")
    switch (cmd) {
      case "/clear":
        vscode.postMessage({ type: "execute_command", command: "/clear", sessionId: active.id })
        clearPromptInput()
        return
      case "/model":
        if (commandArgs) {
          stateManager.setSessionModel(active.id, commandArgs)
          stateManager.setGlobalModel(commandArgs)
          modelDropdown.setCurrentModel(commandArgs)
          syncModelViews()
          vscode.postMessage({ type: "set_model", model: commandArgs, sessionId: active.id })
          clearPromptInput()
          return
        }
        vscode.postMessage({ type: "get_models" })
        modelDropdown.open()
        clearPromptInput()
        return
      case "/cost":
        vscode.postMessage({ type: "execute_command", command: "/cost", sessionId: active.id })
        clearPromptInput()
        return
      case "/new":
        createNewTab()
        clearPromptInput()
        return
      case "/help":
        vscode.postMessage({ type: "execute_command", command: "/help", sessionId: active.id })
        clearPromptInput()
        return
      case "/export":
      case "/export-md":
        vscode.postMessage({ type: "export_chat" })
        clearPromptInput()
        return
      case "/export-json":
        vscode.postMessage({ type: "export_chat_json" })
        clearPromptInput()
        return
      case "/export-text":
        vscode.postMessage({ type: "export_chat_text" })
        clearPromptInput()
        return
      case "/copy":
        vscode.postMessage({ type: "copy_chat" })
        clearPromptInput()
        return
      case "/stash": {
        const stashName = (parts[1] && parts[1].trim()) ? parts[1] : "Untitled"
        const inlineContent = parts.slice(2).join(" ").trim()
        const stashContent = inlineContent || text.replace(/^\/stash(?:\s+\S+)?\s*/i, "").trim()
        if (!stashContent) {
          showSystemMessage(active.id, "Usage: /stash <name> <content>")
        } else {
          vscode.postMessage({ type: "stash_prompt", name: stashName, content: stashContent, isGlobal: true })
        }
        clearPromptInput()
        return
      }
      case "/stashes":
        vscode.postMessage({ type: "list_stashes" })
        clearPromptInput()
        return
      case "/compact":
        vscode.postMessage({ type: "compact_session", sessionId: active.id })
        showSystemMessage(active.id, "Compacting session...")
        clearPromptInput()
        return
      case "/commands":
        commandsModal.open()
        vscode.postMessage({ type: "list_commands" })
        clearPromptInput()
        return
      case "/queue":
        renderQueue(active.id)
        clearPromptInput()
        return
      case "/continue":
        vscode.postMessage({ type: "execute_command", command: "/continue", sessionId: active.id })
        clearPromptInput()
        return
      default:
        vscode.postMessage({ type: "execute_command", command: cmd, arguments: commandArgs, sessionId: active.id })
        clearPromptInput()
        return
    }
  }

  function abortStream() {
    const active = stateManager.getActiveSession()
    if (!active) return
    streamHandlers.get(active.id)?.showTypingIndicator("Stopping...")
    updateAgentStatus("idle")
    vscode.postMessage({ type: "abort", sessionId: active.id })
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
      handleRequestError(active.id,
        streamCapacity.streamingNames
          ? `${STREAM_LIMIT_TOOLTIP}. Currently streaming: ${streamCapacity.streamingNames}. Stop one to continue.`
          : `${STREAM_LIMIT_TOOLTIP}. Stop a streaming tab to free a slot.`
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
    const sendModel = active.model || modelDropdown.getCurrentModel() || stateManager.getState().globalModel
    if (!sendModel) {
      updateSendButton()
      handleRequestError(active.id, "No model selected. Please select a model to continue.")
      return
    }

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

  function renderAttachmentChips() {
    attachmentManager.renderAttachmentChips()
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
    return (
      /^New Chat\b/i.test(raw) ||
      /^Tab session\b/i.test(raw)
    )
  }

  function updatePromptContextChips() {
    attachmentManager.updatePromptContextChips()
  }

  function onInputChange() {
    autoResizeTextarea()
    mention.handleTrigger()
    updateSendButton()
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "Enter") {
        e.preventDefault()
        const active = stateManager.getActiveSession()
        if (active?.isStreaming) {
          sendSteerPrompt()
        } else {
          sendMessage()
        }
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

  function insertTextAtCursor(text: string) {
    const input = els.promptInput
    const start = input.selectionStart ?? input.value.length
    const before = input.value.slice(0, start)
    const after = input.value.slice(input.selectionEnd ?? start)
    input.value = before + text + after
    autoResizeTextarea()
    updateSendButton()
    stateManager.save()
  }

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

  return {
    setupInput,
    sendMessage,
    abortStream,
    sendSteerPrompt,
    persistQueues,
    restoreQueues,
    renderQueue,
    updateSendButton,
    updateSendButtonIcon,
    updateQueueSendButton,
    autoResizeTextarea,
    getStreamCapacityState,
    isAutoSessionName,
    insertTextAtCursor,
    runCommandEntry,
    insertIntoPrompt,
    setSteerMode,
    onInputChange,
    onInputKeydown,
    onPaste,
    updatePromptContextChips,
    renderAttachmentChips,
    generateTitle,
    formatTokenCount,
    wireChipReorderHandlers,
  }
}
