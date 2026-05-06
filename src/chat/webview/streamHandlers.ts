import type { Block, ChatMessage, ToolCallBlock, DiffBlock, ErrorBlock, ToolCallState, DiffHunk } from "./types"
import type { SdkMessageEvent, DiffChunk } from "../../types"
import { renderMessage, renderBlock, renderMarkdown, sanitizeHtml } from "./renderer"
import type { ScrollAnchor } from "./scrollAnchor"
import { CHECK_SVG, SUCCESS_SVG } from "./icons"

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
  currentBlockEl: HTMLElement | null
  currentBlockBuffer: string
  currentBlockIndex: number
  rafPending: boolean
}

// For logging back to extension host
let _vscode: any = null
export function setVsCodeApi(api: any) { _vscode = api }

function webviewLog(msg: string, level: "info" | "warn" | "error" = "info") {
  if (_vscode) {
    _vscode.postMessage({ type: "webview_log", level, message: msg })
  }
  console[level](`[Webview] ${msg}`)
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

  // Use renderMessage for consistency (handles headers, roles, etc.)
  const el = renderMessage(streamMsg, undefined, isConsecutive)
  el.classList.add("assistant", "streaming")
  if (state.streamingMessageId) el.dataset.messageId = state.streamingMessageId

  const bubble = el.querySelector(".message-bubble") as HTMLElement
  if (bubble) {
    // Initialize with a single streaming text block
    const textEl = document.createElement("div")
    textEl.className = "msg-text streaming-text"
    textEl.id = `stream-text-${state.streamingMessageId}`
    bubble.appendChild(textEl)
    state.lastStreamTextEl = textEl
    state.currentBlockEl = textEl

    // Sync with message object
    streamMsg.blocks.push({ type: "text", text: "" } as unknown as Block)
    state.currentBlockIndex = 0
  }

  const welcome = els.messageList.querySelector(".welcome-container")
  if (welcome) welcome.remove()

  els.messageList.appendChild(el)
  els.scrollAnchor.scrollIfAnchored()

  state.isStreaming = true
  state.rafPending = false
  webviewLog(`Stream started: session=${state.streamingMessageId || "unknown"}`)
}

export function handleStreamToken(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  text?: string
): void {
  const id = state.streamingMessageId
  if (!id) {
    webviewLog(`handleStreamToken: dropping chunk len=${text?.length || 0} — no streamingMessageId`, "warn")
    return
  }

  const chunk = text || ""
  state.streamingBuffer += chunk
  state.currentBlockBuffer += chunk

  const doUpdate = () => {
    state.rafPending = false
    
    let textEl = state.currentBlockEl
    // If we don't have an active text block, or the current block is not a text block, create a new one
    if (!textEl || !textEl.classList.contains("msg-text")) {
      const bubble = els.messageList.querySelector(`[data-message-id="${id}"] .message-bubble`) as HTMLElement
      if (bubble) {
        textEl = document.createElement("div")
        textEl.className = "msg-text streaming-text"
        bubble.appendChild(textEl)
        state.currentBlockEl = textEl
        state.lastStreamTextEl = textEl

        // Sync with message object
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

    // Update message object buffer for persistence
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
    // Primary: use requestAnimationFrame for smooth rendering.
    // Fallback: setTimeout(50ms) ensures the DOM is always updated even when
    // the webview is not focused (rAF pauses when tab is hidden).
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
  toolCall: { id: string; name: string; class?: string; args?: unknown }
): void {
  const id = state.streamingMessageId
  if (!id) return

  state.streamingToolCallId = toolCall.id
  state.currentBlockBuffer = ""
  state.currentBlockEl = null

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
  handleStreamToken(state, els, messages, text)
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
    webviewLog("handleStreamEnd: no messageId — no stream to end", "warn")
    resetStreamState(state)
    saveState()
    return
  }

  const blockList = Array.isArray(blocks) ? blocks as Block[] : []

  webviewLog(
    `handleStreamEnd id=${id} blocks=${blockList.length} bufferLen=${state.streamingBuffer.length} bufferPreview=${JSON.stringify(state.streamingBuffer.slice(0, 80))}`,
  )

  // Force-sync any pending rAF update immediately so the DOM reflects the final buffer
  state.rafPending = false

  // The stream_end messageId may differ from state.streamingMessageId:
  //   - Initial stream_start uses the SESSION ID (ses_...) as the messageId
  //   - Subsequent transitions use the MESSAGE ID (msg_...)
  // Try state.streamingMessageId as fallback for both DOM and message lookups.
  const streamId = state.streamingMessageId
  const lookupId = streamId && streamId !== id ? streamId : id

  const textEl = state.lastStreamTextEl || document.getElementById(`stream-text-${lookupId}`)

  if (blockList.length === 0) {
    const msgObj = messages.find((m) => m.id === id) || messages.find((m) => m.id === lookupId)
    
    if (msgObj && msgObj.blocks.length > 0) {
      // We have real-time blocks, just finalize them
      // Ensure all text blocks are rendered as markdown now
      reRenderMessage(id, els, messages)
    } else {
      // Truly empty response
      const noticeText = "(no response — model returned no text content)"
      webviewLog(`handleStreamEnd: empty response for ${id}`, "warn")
      if (msgObj) {
        msgObj.blocks = [{ type: "text", text: noticeText } as unknown as Block]
      }
      const placeholderEl = (els.messageList.querySelector(`[data-message-id="${id}"]`) ||
        els.messageList.querySelector(`[data-message-id="${lookupId}"]`)) as HTMLElement | null
      const emptyTextEl = placeholderEl?.querySelector(`#stream-text-${lookupId}`) as HTMLElement | null
      if (emptyTextEl) {
        emptyTextEl.textContent = noticeText
        emptyTextEl.classList.add("msg-text--empty-notice")
      }
    }
    resetStreamState(state)
    saveState()
    return
  }

  const msgObj = messages.find((m) => m.id === id)
  if (msgObj) {
    // Merge server blocks into existing real-time blocks rather than replacing.
    // The real-time stream accumulates all block types (thinking, tool-calls, text, etc.)
    // but finalizeStream's partsToBlocks only emits text + tool — overwriting would lose
    // thinking blocks, permission requests, and other non-text/tool content.
    //
    // Strategy: update text content from server blocks, add tool-calls the real-time
    // stream might have missed, but preserve everything else.
    const existingTextIdx = msgObj.blocks.findIndex((b) => b.type === "text")
    for (const sb of blockList) {
      if (sb.type === "text") {
        if (existingTextIdx >= 0) {
          msgObj.blocks[existingTextIdx] = sb
        } else {
          msgObj.blocks.push(sb)
        }
      } else if (sb.type === "tool-call") {
        const existing = msgObj.blocks.findIndex((b) => b.type === "tool-call" && b.id === sb.id)
        if (existing >= 0) {
          msgObj.blocks[existing] = sb
        } else {
          msgObj.blocks.push(sb)
        }
      }
    }
    reRenderMessage(id, els, messages)
  } else {
    webviewLog(`handleStreamEnd: message obj not found for id=${id}`, "warn")
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
  hideTypingIndicator(els)

  // Remove empty assistant placeholder if it exists (e.g. stream_start was sent but no chunks arrived)
  const id = state.streamingMessageId
  if (id) {
    const emptyEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
    if (emptyEl) {
      // Only remove if the placeholder has no meaningful content
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
  state.rafPending = false // Ensure raf is reset

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

  // Determine if this message is consecutive to hide header
  const idx = messages.indexOf(msgObj)
  const prevMsg = idx > 0 ? messages[idx - 1] : null
  const isConsecutive = prevMsg?.role === msgObj.role

  const newEl = renderMessage(msgObj, undefined, isConsecutive)
  oldEl.replaceWith(newEl)
}
