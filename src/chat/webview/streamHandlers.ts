import type { Block, ChatMessage, ToolCallBlock, DiffBlock, ErrorBlock, ToolCallState, DiffHunk } from "./types"
import type { SdkMessageEvent, DiffChunk } from "../../types"
import { renderMessage } from "./messageRenderer"
import { renderBlock, renderMarkdown, sanitizeHtml, highlightSyntax } from "./renderer"
import type { ScrollAnchor } from "./scrollAnchor"
import { CHECK_SVG, SUCCESS_SVG, SPINNER_SVG } from "./icons"
import { RenderQueue } from "./renderQueue"
import { handleStreamEnd as handleStreamEndImpl } from "./streamEndHandler"
import { getErrorHandler } from "./errorHandler"
import { getErrorDisplay } from "./errorComponents"
import { getNetworkMonitor } from "./networkMonitor"
import { getQuotaMonitor } from "./quotaMonitor"

export function stripContextFromText(text: string): string {
  const contextRegex = /<context>[\s\S]*?<\/context>/gi
  let cleaned = text.replace(contextRegex, "").trim()
  const partialStart = cleaned.indexOf("<context>")
  if (partialStart !== -1 && cleaned.indexOf("</context>") === -1) {
    cleaned = cleaned.substring(0, partialStart).trim()
  }
  return cleaned
}

function mergeStreamText(existing: string, chunk: string): string {
  if (!chunk) return stripContextFromText(existing)
  if (!existing) return stripContextFromText(chunk)

  const strippedChunk = stripContextFromText(chunk)
  if (strippedChunk && existing.includes(strippedChunk)) return existing

  const maxOverlap = Math.min(existing.length, chunk.length)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (existing.endsWith(chunk.slice(0, overlap))) {
      return stripContextFromText(existing + chunk.slice(overlap))
    }
  }

  return stripContextFromText(existing + chunk)
}


function appendTextToMessage(message: ChatMessage, text: string): void {
  const textBlock = message.blocks.find((block) => block.type === "text") as (Block & { text?: string }) | undefined
  if (textBlock) {
    textBlock.text = mergeStreamText(String(textBlock.text || ""), text)
    return
  }
  message.blocks.push({ type: "text", text: stripContextFromText(text) } as unknown as Block)
}

export function finishUnresolvedToolCalls(blocks: Block[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block) continue
    if (block.type !== "tool-call") continue
    const tool = block as ToolCallBlock
    if (tool.state === "pending" || tool.state === "running") {
      blocks[i] = { ...tool, state: "result" } as unknown as Block
    }
  }
}

export function reRenderMessage(
  messageId: string,
  els: StreamElements,
  messages: ChatMessage[]
): void {
  const msgObj = messages.find((m) => m.id === messageId)
  if (!msgObj) return

  const oldEl = els.messageList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null

  // When re-rendering an existing message, skip the header to avoid re-adding it
  const newEl = renderMessage(msgObj, { skipHeader: !!oldEl }, false)
  if (oldEl) {
    oldEl.replaceWith(newEl)
  } else {
    els.messageList.appendChild(newEl)
  }
}

export interface StreamState {
  isStreaming: boolean
  streamingMessageId: string | null
  streamingBuffer: string
  streamingBlockId: string | null
  streamingToolCallId: string | null
  seenEventIds: Set<string>
  lastStreamTextEl: HTMLElement | null
  currentBlockEl: HTMLElement | null
  currentBlockBuffer: string
  currentBlockIndex: number
  rafPending: boolean
  renderQueue: RenderQueue | null
  chunkSeq: number
}

let _vscode: any = null
export function setVsCodeApi(api: any) { _vscode = api }

function webviewLog(msg: string, level: "info" | "warn" | "error" = "info") {
  if (_vscode) {
    _vscode.postMessage({ type: "webview_log", level, message: msg })
  }
  if (level === "error") console.error(`[Webview] ${msg}`)
  else if (level === "warn") console.warn(`[Webview] ${msg}`)
  else console.info(`[Webview] ${msg}`)
}

export interface StreamElements {
  messageList: HTMLDivElement
  typingIndicator: HTMLDivElement
  typingLabel: HTMLSpanElement
  scrollAnchor: ScrollAnchor
}

export interface StreamCallbacks {
  onStreamingChange?: (isStreaming: boolean) => void
}

const TYPING_INDICATOR_ICON = `<span class="premium-spinner-container">${SPINNER_SVG}</span>`

export function showTypingIndicator(
  els: StreamElements,
  label?: string
): void {
  els.typingIndicator.classList.remove("hidden")
  els.typingLabel.innerHTML = TYPING_INDICATOR_ICON
  const labelSpan = document.createElement("span")
  labelSpan.textContent = label || "Thinking..."
  els.typingLabel.appendChild(labelSpan)
  els.scrollAnchor.scrollIfAnchored()
}

export function hideTypingIndicator(
  els: StreamElements
): void {
  els.typingIndicator.classList.add("hidden")
  els.typingLabel.innerHTML = ''
}

export function handleStreamStart(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  messageId?: string
): void {
  if (state.isStreaming) {
    webviewLog(`handleStreamStart: already streaming (msgId=${state.streamingMessageId}), skipping duplicate start`, "warn")
    return
  }

  state.streamingMessageId = messageId || `stream-${crypto.randomUUID()}`
  state.streamingBuffer = ""
  state.streamingBlockId = null
  state.streamingToolCallId = null
  state.lastStreamTextEl = null
  state.currentBlockEl = null
  state.currentBlockBuffer = ""
  state.currentBlockIndex = -1
  state.chunkSeq = 0
  hideTypingIndicator(els)

  els.scrollAnchor.anchor()

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const isConsecutive = lastMsg?.role === "assistant"

  const streamMsg: ChatMessage = {
    role: "assistant",
    id: state.streamingMessageId || undefined,
    blocks: [],
    timestamp: Date.now(),
  }
  messages.push(streamMsg)

  const el = renderMessage(streamMsg, undefined, isConsecutive)
  el.classList.add("assistant", "streaming")
  if (state.streamingMessageId) el.dataset.messageId = state.streamingMessageId

  const bubble = el.querySelector(".message-bubble") as HTMLElement
  if (bubble) {
    const textEl = document.createElement("div")
    textEl.className = "msg-text streaming-text"
    textEl.id = `stream-text-${state.streamingMessageId}`
    bubble.appendChild(textEl)
    state.lastStreamTextEl = textEl
    state.currentBlockEl = textEl

    streamMsg.blocks.push({ type: "text", text: "" } as unknown as Block)
    state.currentBlockIndex = 0
  }

  const welcome = els.messageList.querySelector(".welcome-container")
  if (welcome) welcome.remove()

  els.messageList.appendChild(el)
  els.scrollAnchor.scrollIfAnchored()

  const streamId = state.streamingMessageId
  state.renderQueue = new RenderQueue((_text: string) => {
    let textEl = state.currentBlockEl
    if (!textEl || !els.messageList.contains(textEl)) {
      const bubble = els.messageList.querySelector(`[data-message-id="${streamId}"] .message-bubble`) as HTMLElement
      if (bubble) {
        textEl = bubble.querySelector(".streaming-text") as HTMLElement
        if (!textEl) {
          textEl = document.createElement("div")
          textEl.className = "msg-text streaming-text"
          bubble.appendChild(textEl)
        }
        state.currentBlockEl = textEl
        state.lastStreamTextEl = textEl
      }
    }
    if (!textEl) return

    const displayText = stripContextFromText(state.currentBlockBuffer)
    textEl.textContent = displayText

    const msgObj = messages.find((m) => m.id === streamId)
    if (msgObj && state.currentBlockIndex >= 0) {
      const block = msgObj.blocks[state.currentBlockIndex]
      if (block && block.type === "text") {
        (block as any).text = displayText
      }
    }
    els.scrollAnchor.scrollIfAnchored()
  })

  state.isStreaming = true
  state.rafPending = false
  webviewLog(`Stream started: session=${state.streamingMessageId || "unknown"}`)
}

export function handleStreamToken(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  text?: string,
  saveState?: () => void,
  messageId?: string,
): void {
  let id = state.streamingMessageId
  if (!id) {
    if (messageId) {
      const targetMsg = messages.find(m => m.id === messageId)
      if (targetMsg) {
        state.streamingMessageId = messageId
        state.isStreaming = true
        id = messageId
      } else {
        webviewLog(`handleStreamToken: restarting stream for messageId=${messageId} (recovered after error)`, "warn")
        state.isStreaming = false
        handleStreamStart(state, els, messages, messageId)
        id = state.streamingMessageId
        if (!id) return
      }
    } else {
      const lastMsg = messages[messages.length - 1]
      if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.id) {
        webviewLog(`handleStreamToken: dropping chunk len=${text?.length || 0} — no streamingMessageId`, "warn")
        return
      }
      webviewLog(
        `handleStreamToken: recovering late chunk len=${text?.length || 0} into ${lastMsg.id}`,
        "warn",
      )
      appendTextToMessage(lastMsg, text || "")
      reRenderMessage(lastMsg.id, els, messages)
      els.scrollAnchor.scrollIfAnchored()
      saveState?.()
      return
    }
  }

  const chunk = text || ""
  state.streamingBuffer += chunk
  state.currentBlockBuffer += chunk
  state.chunkSeq++

  if (state.renderQueue) {
    state.renderQueue.enqueue(chunk)
    return
  }

  const doUpdate = () => {
    state.rafPending = false
    
    let textEl = state.currentBlockEl
    if (!textEl || !els.messageList.contains(textEl)) {
      const bubble = els.messageList.querySelector(`[data-message-id="${id}"] .message-bubble`) as HTMLElement
      if (bubble) {
        textEl = bubble.querySelector(".streaming-text") as HTMLElement
        if (!textEl) {
          textEl = document.createElement("div")
          textEl.className = "msg-text streaming-text"
          bubble.appendChild(textEl)
        }
        state.currentBlockEl = textEl
        state.lastStreamTextEl = textEl
      } else {
        webviewLog(`handleStreamToken: bubble missing for ${id}, triggering recovery re-render`, "warn")
        reRenderMessage(id, els, messages)
        return doUpdate()
      }
    }
    
    if (!textEl.classList.contains("msg-text")) {
      const bubble = els.messageList.querySelector(`[data-message-id="${id}"] .message-bubble`) as HTMLElement
      if (bubble) {
        textEl = document.createElement("div")
        textEl.className = "msg-text streaming-text"
        bubble.appendChild(textEl)
        state.currentBlockEl = textEl
        state.lastStreamTextEl = textEl

        const msgObj = messages.find((m: ChatMessage) => m.id === id)
        if (msgObj) {
          msgObj.blocks.push({ type: "text", text: "" } as unknown as Block)
          state.currentBlockIndex = msgObj.blocks.length - 1
        }
      }
    }

    const displayText = stripContextFromText(state.currentBlockBuffer)
    if (textEl) {
      textEl.textContent = displayText
    }

    const msgObj = messages.find((m: ChatMessage) => m.id === id)
    if (msgObj && state.currentBlockIndex >= 0) {
      const block = msgObj.blocks[state.currentBlockIndex]
      if (block && block.type === "text") {
        (block as any).text = displayText
      }
    }

    els.scrollAnchor.scrollIfAnchored()
  }

  if (!state.rafPending) {
    state.rafPending = true
    requestAnimationFrame(doUpdate)
    setTimeout(() => {
      if (state.rafPending) doUpdate()
    }, 50)
  }
}

export function handleToolStart(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  toolCall: { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }
): void {
  const id = state.streamingMessageId
  if (!id) return

  const msgObj = messages.find((m) => m.id === id)
  const existing = msgObj?.blocks.findIndex(
    (b) => b.type === "tool-call" && (b as ToolCallBlock).id === toolCall.id
  ) ?? -1
  if (existing >= 0) {
    state.streamingToolCallId = toolCall.id
    webviewLog(`handleToolStart: updating existing tool_start id=${toolCall.id}`)
    const block = msgObj!.blocks[existing] as ToolCallBlock
    block.args = toolCall.args
    handleToolUpdate(els, toolCall.id, { args: toolCall.args })
    return
  }

  state.streamingToolCallId = toolCall.id
  state.currentBlockBuffer = ""
  state.currentBlockEl = null

  const toolBlock: ToolCallBlock = {
    type: 'tool-call',
    id: toolCall.id,
    name: toolCall.name || "Tool",
    class: (toolCall.class as ToolCallBlock['class']) || 'read',
    state: toolCall.state === 'running' ? 'running' : 'pending',
    args: toolCall.args,
  }

  if (msgObj) msgObj.blocks.push(toolBlock as unknown as Block)

  const msgEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
  if (msgEl) {
    const bubble = msgEl.querySelector(".message-bubble")
    if (bubble) {
      const blockEl = renderBlock(toolBlock as unknown as Block, {})
      if (blockEl) bubble.appendChild(blockEl)
    }
  }

  els.scrollAnchor.scrollIfAnchored()
}

export function handleToolUpdate(
  els: StreamElements,
  toolId: string,
  update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }
): void {
  const toolEl = els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
  if (!toolEl) return

  if (update.state) {
    toolEl.className = toolEl.className.replace(/tool-call--(?:pending|running|result|completed|error|stale)/g, `tool-call--${update.state}`)
    const badge = toolEl.querySelector(".tool-status")
    if (badge) {
      if (update.state === 'pending') badge.textContent = '\u25cb Pending'
      else if (update.state === 'running') badge.textContent = '\u25c9 Running'
      else if (update.state === 'stale') badge.textContent = 'Stale'
      else if (update.error || update.state === 'error') badge.textContent = '\u2717 Error'
      else if (update.state === 'completed' || update.state === 'result') badge.textContent = '\u2713 Done'
    }
  }

  if (update.args !== undefined) {
    let argsPanel = toolEl.querySelector(".tool-args-panel") as HTMLElement | null
    if (!argsPanel) {
      argsPanel = document.createElement("div")
      argsPanel.className = "tool-args-panel"
      const summary = toolEl.querySelector("summary")
      if (summary) summary.after(argsPanel)
      else toolEl.prepend(argsPanel)
    }
    const argsStr = typeof update.args === 'string' ? update.args : JSON.stringify(update.args, null, 2)
    if (argsPanel.dataset.lastArgs !== argsStr) {
      const truncated = argsStr.length > 500
      const displayStr = truncated ? argsStr.slice(0, 500) : argsStr
      argsPanel.innerHTML = sanitizeHtml(highlightSyntax(displayStr, 'json'))
      argsPanel.dataset.lastArgs = argsStr
      if (truncated) {
        const more = document.createElement("button")
        more.className = "tool-show-more"
        more.textContent = "Show more\u2026"
        more.addEventListener("click", () => {
          argsPanel!.innerHTML = sanitizeHtml(highlightSyntax(argsStr, 'json'))
          more.remove()
        })
        argsPanel.appendChild(more)
      }
    }
  }

  if (update.result !== undefined) {
    let resultEl = toolEl.querySelector(".tool-result-panel") as HTMLElement | null
    if (!resultEl) {
      resultEl = document.createElement("div")
      resultEl.className = "tool-result-panel"
      toolEl.appendChild(resultEl)
    }
    resultEl.textContent = update.result
  }

  if (update.error !== undefined) {
    toolEl.classList.add("tool-call--error")
    let errorEl = toolEl.querySelector(".tool-error") as HTMLElement | null
    if (!errorEl) {
      errorEl = document.createElement("div")
      errorEl.className = "tool-error"
      toolEl.appendChild(errorEl)
    }
    errorEl.textContent = update.error
  }

  const scrollAnchor = (els as unknown as { scrollAnchor: ScrollAnchor }).scrollAnchor
  scrollAnchor?.scrollIfAnchored()
}

export function handleToolEnd(
  els: StreamElements,
  toolId: string,
  result: { ok: boolean; result?: string; durationMs?: number; stale?: boolean }
): void {
  const toolEl = els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
  if (!toolEl) return

  const state = result.stale ? 'stale' : result.ok ? 'completed' : 'error'
  toolEl.className = toolEl.className.replace(/tool-call--(?:pending|running|result|completed|error|stale)/g, `tool-call--${state}`)
  
  const badge = toolEl.querySelector(".tool-status")
  if (badge) {
    badge.textContent = result.stale ? 'Stale' : result.ok ? '\u2713 Done' : '\u2717 Error'
  }

  if (result.durationMs) {
    const nameEl = toolEl.querySelector(".tool-name") as HTMLElement | null
    if (nameEl) {
      const dur = document.createElement("span")
      dur.className = "tool-duration"
      dur.textContent = `${result.durationMs}ms`
      dur.style.marginLeft = 'auto'
      nameEl.parentElement?.appendChild(dur)
    }
  }

  if (result.result !== undefined) {
    let resultEl = toolEl.querySelector(".tool-result-panel") as HTMLElement | null
    if (!resultEl) {
      resultEl = document.createElement("div")
      resultEl.className = "tool-result-panel"
      toolEl.appendChild(resultEl)
    }
    resultEl.textContent = result.result
  }

  if (!result.ok) toolEl.classList.add("tool-call--error")
}

export function handleDiff(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }
): void {
  const id = state.streamingMessageId
  if (!id) return

  const diffBlock: DiffBlock = {
    type: 'diff',
    diffId: diff.diffId,
    path: diff.path,
    hunks: diff.hunks,
    state: 'pending',
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
  }

  const msgObj = messages.find((m) => m.id === id)
  if (msgObj) msgObj.blocks.push(diffBlock as unknown as Block)

  const msgEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
  if (msgEl) {
    const bubble = msgEl.querySelector(".message-bubble")
    if (bubble) {
      const blockEl = renderBlock(diffBlock as unknown as Block, {})
      if (blockEl) bubble.appendChild(blockEl)
    }
  }

  els.scrollAnchor.scrollIfAnchored()
}

export function handleStreamChunk(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  text?: string,
  saveState?: () => void,
  messageId?: string,
): void {
  handleStreamToken(state, els, messages, text, saveState, messageId)
}

export function handleSkillIndicator(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  skillName: string
): void {
  const id = state.streamingMessageId
  if (!id) return

  const msgObj = messages.find((m) => m.id === id)
  if (!msgObj) return

  const skillBlock: Block = { type: "skill_badge", skillName }
  msgObj.blocks.push(skillBlock)

  const msgEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
  if (msgEl) {
    const bubble = msgEl.querySelector(".message-bubble")
    if (bubble) {
      const blockEl = renderBlock(skillBlock, {})
      if (blockEl) bubble.appendChild(blockEl)
    }
  }

  els.scrollAnchor.scrollIfAnchored()
}

export function handleStreamEnd(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  messageId?: string,
  blocks?: unknown
): void {
  handleStreamEndImpl(state, els, messages, saveState, messageId, blocks)
}

export function handleStreamError(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  error: { code: string; message: string; detail?: string; retryable?: boolean }
): void {
  state.isStreaming = false
  hideTypingIndicator(els)

  const id = state.streamingMessageId
  if (id) {
    const emptyEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
    if (emptyEl) {
      const bubble = emptyEl.querySelector(".message-bubble")
      const hasContent = bubble && bubble.textContent && bubble.textContent.trim().length > 0
      if (!hasContent) {
        emptyEl.remove()
        const idx = messages.findIndex((m) => m.id === id)
        if (idx !== -1) messages.splice(idx, 1)
      }
    }
  }
  resetStreamState(state)
  state.rafPending = false

  // Use new error handling system
  const errorHandler = getErrorHandler({ logToConsole: true, logToExtension: false })
  const errorContext = errorHandler.handleError(error)

  // Check network status for network-related errors
  const networkMonitor = getNetworkMonitor()
  if (!networkMonitor.isOnline() && errorContext.category === 'network') {
    // Enhance with network status
    errorContext.technicalDetails = `Network Status: ${networkMonitor.getConnectionQuality()}, Latency: ${networkMonitor.getNetworkStatus().latency}ms`
  }

  // Use new error display component
  const errorDisplay = getErrorDisplay()
  const errorElement = errorDisplay.render(errorContext)

  // Create a wrapper message for the error
  const errMsg: ChatMessage = {
    role: "system",
    id: `error-${crypto.randomUUID()}`,
    blocks: [{
      type: 'text',
      text: errorContext.userMessage
    } as unknown as Block],
    timestamp: Date.now(),
  }
  messages.push(errMsg)

  const el = renderMessage(errMsg)
  
  // Replace the default message content with our enhanced error display
  const messageContent = el.querySelector('.message-bubble')
  if (messageContent) {
    messageContent.innerHTML = ''
    messageContent.appendChild(errorElement)
  }
  
  els.messageList.appendChild(el)
  els.scrollAnchor.scrollIfAnchored()
  saveState()
}

export function handleRequestError(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  message?: string
): void {
  handleStreamError(state, els, messages, saveState, {
    code: 'request_failed',
    message: typeof message === "string" ? message : "The request failed. Please try again.",
  })
}

export function handleDiffResult(
  els: StreamElements,
  blockId?: string,
  ok?: boolean,
  message?: string
): void {
  const block = blockId ? els.messageList.querySelector(`[data-diff-id="${blockId}"]`) : null
  if (!block) return

  const acceptBtn = block.querySelector<HTMLButtonElement>(".diff-btn--accept")
  const discardBtn = block.querySelector<HTMLButtonElement>(".diff-btn--discard")
  const actionBar = block.querySelector<HTMLElement>(".diff-action-bar")

  if (ok) {
    if (acceptBtn) {
      acceptBtn.innerHTML = CHECK_SVG + '<span>Applied</span>'
      acceptBtn.disabled = true
    }
    if (discardBtn) discardBtn.disabled = true
    if (actionBar) {
      const chip = document.createElement("span")
      chip.className = "diff-state-chip diff-state--accepted"
      chip.innerHTML = SUCCESS_SVG + ' <span>Applied</span>'
      actionBar.replaceWith(chip)
    }
    block.classList.add("diff-block--accepted")
    return
  }

  if (acceptBtn) {
    acceptBtn.textContent = "Accept Changes"
    acceptBtn.disabled = false
  }
  if (discardBtn) discardBtn.disabled = false

  const error = document.createElement("div")
  error.className = "diff-error"
  error.textContent = typeof message === "string" ? message : "Could not apply this diff."
  block.appendChild(error)
}

export function handleServerStatus(
  state: StreamState,
  els: StreamElements,
  status?: string
): void {
  if (status === "thinking" || status === "busy") {
    showTypingIndicator(els, "Thinking...")
  } else if (status === "error") {
    hideTypingIndicator(els)
    handleRequestError(state, els, [], () => {}, "An error occurred. Please try again.")
  } else if (status === "idle") {
    hideTypingIndicator(els)
  } else if (status && (status.includes("tool") || status.includes("running"))) {
    showTypingIndicator(els, "Running tool...")
  }
}

export function clearMessages(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void
): void {
  messages.length = 0
  state.seenEventIds.clear()
  resetStreamState(state)
  els.messageList.innerHTML = ""
  hideTypingIndicator(els)
  saveState()
}

export function resetStreamState(state: StreamState): void {
  if (state.renderQueue) {
    state.renderQueue.forceFlush()
    state.renderQueue.destroy()
    state.renderQueue = null
  }
  state.streamingMessageId = null
  state.streamingBuffer = ""
  state.streamingBlockId = null
  state.streamingToolCallId = null
  state.lastStreamTextEl = null
  state.currentBlockEl = null
  state.currentBlockBuffer = ""
  state.currentBlockIndex = -1
  state.rafPending = false
  state.chunkSeq = 0
}

export function setupToolKeyboardNav(): () => void {
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest) return

    const toolRow = target.closest("details.tool-call > summary, details.tool-group > summary")
    if (!toolRow) return

    const messageList = toolRow.closest(".message-list") as HTMLElement | null
    if (!messageList) return

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const allTools = Array.from(
        messageList.querySelectorAll("details.tool-call > summary, details.tool-group > summary")
      ) as HTMLElement[]
      const currentIdx = allTools.indexOf(toolRow as HTMLElement)
      if (currentIdx < 0) return
      const next = e.key === "ArrowDown" ? currentIdx + 1 : currentIdx - 1
      if (next >= 0 && next < allTools.length) {
        allTools[next]!.focus()
      }
    } else if (e.key === "Home") {
      e.preventDefault()
      const first = messageList.querySelector("details.tool-call > summary, details.tool-group > summary") as HTMLElement | null
      if (first) first.focus()
    } else if (e.key === "End") {
      e.preventDefault()
      const allTools = messageList.querySelectorAll("details.tool-call > summary, details.tool-group > summary")
      const last = allTools[allTools.length - 1] as HTMLElement | null
      if (last) last.focus()
    }
  }

  document.addEventListener("keydown", handler)
  return () => document.removeEventListener("keydown", handler)
}

export { renderBlock as _renderBlock }
