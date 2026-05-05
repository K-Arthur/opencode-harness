import type { Block, ChatMessage, ToolCallBlock, DiffBlock, ErrorBlock, ToolCallState, DiffHunk } from "./types"
import type { SdkMessageEvent, DiffChunk } from "../../types"
import { renderMessage, renderBlock } from "./renderer"
import type { ScrollAnchor } from "./scrollAnchor"
import { OC_LOGO_SVG, CHECK_SVG, SUCCESS_SVG } from "./icons"

export function stripContextFromText(text: string): string {
  const contextRegex = /<context>[\s\S]*?<\/context>/gi
  let cleaned = text.replace(contextRegex, "").trim()
  const partialStart = cleaned.indexOf("<context>")
  if (partialStart !== -1 && cleaned.indexOf("</context>") === -1) {
    cleaned = cleaned.substring(0, partialStart).trim()
  }
  return cleaned
}

export interface StreamState {
  isStreaming: boolean
  streamingMessageId: string | null
  streamingBuffer: string
  streamingBlockId: string | null
  streamingToolCallId: string | null
  seenEventIds: Set<string>
  lastStreamTextEl: HTMLElement | null
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

const TYPING_DOTS_SVG = '<span class="typing-dots"><span></span><span></span><span></span></span>'

export function showTypingIndicator(
  els: StreamElements,
  label?: string
): void {
  els.typingIndicator.classList.remove("hidden")
  els.typingLabel.innerHTML = TYPING_DOTS_SVG
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
  state.streamingMessageId = messageId || `stream-${crypto.randomUUID()}`
  state.streamingBuffer = ""
  state.streamingBlockId = null
  state.streamingToolCallId = null
  state.lastStreamTextEl = null
  hideTypingIndicator(els)

  els.scrollAnchor.anchor()

  const streamMsg: ChatMessage = {
    role: "assistant",
    id: state.streamingMessageId || undefined,
    blocks: [],
    timestamp: Date.now(),
  }
  messages.push(streamMsg)

  const el = document.createElement("div")
  el.className = "message assistant"
  if (state.streamingMessageId) el.dataset.messageId = state.streamingMessageId

  const avatar = document.createElement("div")
  avatar.className = "message-avatar"
  avatar.innerHTML = OC_LOGO_SVG
  el.appendChild(avatar)

  const contentWrapper = document.createElement("div")
  contentWrapper.className = "message-content"

  const header = document.createElement("div")
  header.className = "message-header"
  const roleSpan = document.createElement("span")
  roleSpan.className = "message-role"
  roleSpan.textContent = "OpenCode"
  header.appendChild(roleSpan)
  contentWrapper.appendChild(header)

  const bubble = document.createElement("div")
  bubble.className = "message-bubble"

  const textEl = document.createElement("div")
  textEl.className = "msg-text streaming-text"
  textEl.id = `stream-text-${state.streamingMessageId}`
  state.lastStreamTextEl = textEl
  bubble.appendChild(textEl)

  contentWrapper.appendChild(bubble)
  el.appendChild(contentWrapper)

  const welcome = els.messageList.querySelector(".welcome-container")
  if (welcome) welcome.remove()

  els.messageList.appendChild(el)
  els.scrollAnchor.scrollIfAnchored()

  state.isStreaming = true
}

export function handleStreamToken(
  state: StreamState,
  els: StreamElements,
  text?: string
): void {
  const id = state.streamingMessageId
  if (!id) return

  state.streamingBuffer += text || ""

  const textEl = state.lastStreamTextEl || document.getElementById(`stream-text-${id}`)
  if (textEl) {
    const displayText = stripContextFromText(state.streamingBuffer)
    textEl.textContent = displayText
    state.lastStreamTextEl = textEl
  }

  els.scrollAnchor.scrollIfAnchored()
}

export function handleToolStart(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  toolCall: { id: string; name: string; class?: string; args?: unknown }
): void {
  const id = state.streamingMessageId
  if (!id) return

  state.streamingToolCallId = toolCall.id

  const toolBlock: ToolCallBlock = {
    type: 'tool-call',
    id: toolCall.id,
    name: toolCall.name,
    class: (toolCall.class as ToolCallBlock['class']) || 'read',
    state: 'pending',
    args: toolCall.args,
  }

  const msgObj = messages.find((m) => m.id === id)
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
  update: { state?: ToolCallState; result?: string; error?: string }
): void {
  const toolEl = els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
  if (!toolEl) return

  if (update.state) {
    toolEl.className = toolEl.className.replace(/tool-call--\w+/g, `tool-call--${update.state}`)
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
  result: { ok: boolean; result?: string; durationMs?: number }
): void {
  const toolEl = els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
  if (!toolEl) return

  toolEl.className = toolEl.className.replace(/tool-call--\w+/g, `tool-call--result`)

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
  text?: string
): void {
  handleStreamToken(state, els, text)
  // Process any complete events that may have buffered
  processBufferedEvents(state, els, messages)
}

let eventBuffer = ""

function processBufferedEvents(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[]
): void {
  // Placeholder for SSE event processing if needed
  // The original handleStreamChunk only called handleStreamToken
}

export function handleStreamEnd(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  messageId?: string,
  blocks?: unknown
): void {
  state.isStreaming = false
  hideTypingIndicator(els)

  const id = messageId || state.streamingMessageId
  if (!id) {
    resetStreamState(state)
    saveState()
    return
  }

  const streamTextEl = state.lastStreamTextEl || document.getElementById(`stream-text-${id}`)
  if (streamTextEl) streamTextEl.classList.remove("streaming-text")

  const blockList = Array.isArray(blocks) ? blocks as Block[] : []

  if (blockList.length === 0) {
    const displayText = stripContextFromText(state.streamingBuffer)
    if (displayText.trim()) {
      const msgObj = messages.find((m) => m.id === id)
      if (msgObj) {
        msgObj.blocks = [{ type: "text", text: displayText } as unknown as Block]
      }
      reRenderMessage(id, els, messages)
    } else {
      const emptyEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
      if (emptyEl) emptyEl.remove()
      const idx = messages.findIndex((m) => m.id === id)
      if (idx !== -1) messages.splice(idx, 1)
    }
    resetStreamState(state)
    saveState()
    return
  }

  const msgObj = messages.find((m) => m.id === id)
  if (msgObj) {
    msgObj.blocks = blockList
    reRenderMessage(id, els, messages)
  }

  resetStreamState(state)
  saveState()
}

export function handleStreamError(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  error: { code: string; message: string; detail?: string; retryable?: boolean }
): void {
  state.isStreaming = false
  resetStreamState(state)
  hideTypingIndicator(els)

  const errBlock: ErrorBlock = {
    type: 'error',
    code: error.code || 'unknown',
    message: error.message || "An error occurred",
    detail: error.detail,
    retryable: error.retryable || false,
  }

  const errMsg: ChatMessage = {
    role: "system",
    id: `error-${crypto.randomUUID()}`,
    blocks: [errBlock as unknown as Block],
    timestamp: Date.now(),
  }
  messages.push(errMsg)

  const el = renderMessage(errMsg)
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
  const block = blockId ? els.messageList.querySelector(`[data-block-id="${blockId}"]`) : null
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

function resetStreamState(state: StreamState): void {
  state.streamingMessageId = null
  state.streamingBuffer = ""
  state.streamingBlockId = null
  state.streamingToolCallId = null
  state.lastStreamTextEl = null
}

export function reRenderMessage(
  messageId: string,
  els: StreamElements,
  messages: ChatMessage[]
): void {
  const msgObj = messages.find((m) => m.id === messageId)
  if (!msgObj) return

  const oldEl = els.messageList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
  if (!oldEl) return

  const newEl = renderMessage(msgObj)
  oldEl.replaceWith(newEl)
}
