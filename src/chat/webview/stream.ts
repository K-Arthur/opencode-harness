import type { Block, ChatMessage } from "./types"
import { scrollToBottom } from "./dom"
import { renderMessage } from "./renderer"

const OC_LOGO_SVG = '<svg class="oc-logo" viewBox="0 0 480 600" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0h480v600H0V0zm120 120h240v360H120V120z"/></svg>'

/**
 * Strip context wrapper from text for display.
 * The AI may echo back the context block, which we don't want to show.
 */
function stripContextFromText(text: string): string {
  // Remove complete <context>...</context> blocks
  const contextRegex = /<context>[\s\S]*?<\/context>/gi
  let cleaned = text.replace(contextRegex, "").trim()
  
  // Handle partial context tags (streaming in progress)
  // If we see <context> without closing, hide everything from that point
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
}

export interface StreamElements {
  messageList: HTMLDivElement
  typingIndicator: HTMLDivElement
  typingLabel: HTMLSpanElement
}

export interface StreamCallbacks {
  onStreamingChange?: (isStreaming: boolean) => void
}

export function createStreamHandlers(
  els: StreamElements,
  state: StreamState,
  messages: ChatMessage[],
  saveState: () => void,
  callbacks?: StreamCallbacks
) {
  function showTypingIndicator(label?: string) {
    els.typingIndicator.classList.remove("hidden")
    els.typingLabel.textContent = label || "Thinking..."
    scrollToBottom(els.messageList)
  }

  function hideTypingIndicator() {
    els.typingIndicator.classList.add("hidden")
  }

  function handleStreamStart(messageId?: string) {
    state.streamingMessageId = messageId || "stream-" + Date.now()
    state.streamingBuffer = ""
    hideTypingIndicator()

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
    textEl.id = "stream-text-" + state.streamingMessageId
    bubble.appendChild(textEl)

    contentWrapper.appendChild(bubble)
    el.appendChild(contentWrapper)

    const welcome = els.messageList.querySelector(".welcome-message")
    if (welcome) welcome.remove()

    els.messageList.appendChild(el)
    scrollToBottom(els.messageList)

    state.isStreaming = true
    callbacks?.onStreamingChange?.(true)
  }

  function handleStreamChunk(text?: string) {
    const id = state.streamingMessageId
    if (!id) return
    state.streamingBuffer += text || ""
    const textEl = document.getElementById("stream-text-" + id)
    if (textEl) {
      // Strip context wrapper from displayed text in real-time
      const displayText = stripContextFromText(state.streamingBuffer)
      textEl.textContent = displayText
      scrollToBottom(els.messageList)
    }
  }

  function handleStreamEnd(messageId?: string, blocks?: unknown) {
    state.isStreaming = false
    hideTypingIndicator()
    callbacks?.onStreamingChange?.(false)

    const id = messageId || state.streamingMessageId
    if (id) {
      const blockList = Array.isArray(blocks) ? blocks as Block[] : []
      if (blockList.length === 0) {
        // If we have buffered text from streaming, preserve it as the response
        const displayText = stripContextFromText(state.streamingBuffer)
        if (displayText.trim()) {
          const msgObj = messages.find((m) => m.id === id)
          if (msgObj) {
            msgObj.blocks = [{ type: "text", text: displayText }]
          }
          // Finalize the streaming element
          const streamEl = document.getElementById("stream-text-" + id)
          if (streamEl) {
            streamEl.classList.remove("streaming-text")
          }
        } else {
          // Truly empty response — remove the placeholder
          const emptyEl = els.messageList.querySelector('[data-message-id="' + id + '"]')
          if (emptyEl) emptyEl.remove()
          const idx = messages.findIndex((m) => m.id === id)
          if (idx !== -1) messages.splice(idx, 1)
        }
        state.streamingMessageId = null
        state.streamingBuffer = ""
        saveState()
        return
      }

      const streamingEl = document.getElementById("stream-text-" + id)
      if (streamingEl) {
        streamingEl.classList.remove("streaming-text")
      }
      const msgObj = messages.find((m) => m.id === id)
      if (msgObj) {
        msgObj.blocks = blockList
        reRenderMessage(id, els, messages)
      }
    }
    state.streamingMessageId = null
    state.streamingBuffer = ""
    saveState()
  }

  function handleRequestError(message?: string) {
    state.isStreaming = false
    state.streamingMessageId = null
    state.streamingBuffer = ""
    hideTypingIndicator()
    callbacks?.onStreamingChange?.(false)

    const errMsg: ChatMessage = {
      role: "system",
      id: "error-" + Date.now(),
      blocks: [{ type: "text", text: typeof message === "string" ? message : "The request failed. Please try again." }],
      timestamp: Date.now(),
    }
    messages.push(errMsg)
    const el = renderMessage(errMsg)
    els.messageList.appendChild(el)
    scrollToBottom(els.messageList)
    saveState()
  }

  function handleDiffResult(blockId?: string, ok?: boolean, message?: string) {
    const block = blockId ? els.messageList.querySelector('[data-block-id="' + blockId + '"]') : null
    if (!block) return
    const acceptBtn = block.querySelector<HTMLButtonElement>(".diff-btn-accept")
    const rejectBtn = block.querySelector<HTMLButtonElement>(".diff-btn-reject")
    if (ok) {
      if (acceptBtn) acceptBtn.textContent = typeof message === "string" ? message : "Applied"
      if (rejectBtn) rejectBtn.disabled = true
      block.classList.add("diff-applied")
      return
    }

    if (acceptBtn) {
      acceptBtn.textContent = "Accept Changes"
      acceptBtn.disabled = false
    }
    if (rejectBtn) rejectBtn.disabled = false

    const error = document.createElement("div")
    error.className = "diff-error"
    error.textContent = typeof message === "string" ? message : "Could not apply this diff."
    block.appendChild(error)
  }

  function handleServerStatus(status?: string) {
    if (status === "thinking" || status === "busy") {
      showTypingIndicator("Thinking...")
    } else if (status === "error") {
      hideTypingIndicator()
      handleRequestError("An error occurred. Please try again.")
    } else if (status === "idle") {
      hideTypingIndicator()
    } else if (status && (status.includes("tool") || status.includes("running"))) {
      showTypingIndicator("Running tool...")
    }
  }

  function clearMessages() {
    messages.length = 0
    state.streamingMessageId = null
    state.streamingBuffer = ""
    state.isStreaming = false
    els.messageList.innerHTML = ""
    hideTypingIndicator()
    saveState()
  }

  return {
    showTypingIndicator,
    hideTypingIndicator,
    handleStreamStart,
    handleStreamChunk,
    handleStreamEnd,
    handleRequestError,
    handleDiffResult,
    handleServerStatus,
    clearMessages,
  }
}

function reRenderMessage(messageId: string, els: StreamElements, messages: ChatMessage[]) {
  const idx = messages.findIndex((m) => m.id === messageId)
  if (idx === -1) return
  const msg = messages[idx]
  const oldEl = els.messageList.querySelector('[data-message-id="' + messageId + '"]')
  if (oldEl) {
    const newEl = renderMessage(msg)
    oldEl.replaceWith(newEl)
    scrollToBottom(els.messageList)
  }
}
