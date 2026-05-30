import type { Block, ChatMessage } from "./types"
import { createTextBlock } from "./blocks"
import type { StreamState, StreamElements } from "./streamHandlers"
import { hideTypingIndicator, finishUnresolvedToolCalls, reRenderMessage, resetStreamState, webviewLog } from "./streamHandlers"

function ensureRenderedTextFallback(messageId: string, msgObj: ChatMessage, els: StreamElements): void {
  const text = (msgObj.blocks || [])
    .filter((block) => block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0)
    .map((block) => block.text)
    .join("\n")

  if (!text.trim()) return

  const bubble = els.messageList.querySelector(`[data-message-id="${messageId}"] .message-bubble`) as HTMLElement | null
  if (!bubble) return

  const existingText = bubble.querySelector(".msg-text") as HTMLElement | null
  if (existingText) {
    if (!existingText.textContent?.trim()) {
      existingText.textContent = text
    }
    return
  }

  const fallback = document.createElement("div")
  fallback.className = "msg-text markdown-content"
  fallback.textContent = text
  bubble.appendChild(fallback)
}

function resolveStreamEndId(
  id: string | undefined,
  streamingMessageId: string | null
): { id: string; lookupId: string } | null {
  if (id) return { id, lookupId: streamingMessageId && streamingMessageId !== id ? streamingMessageId : id }
  if (!streamingMessageId) return null
  return { id: streamingMessageId, lookupId: streamingMessageId }
}

function handleEmptyStreamEnd(
  els: StreamElements,
  messages: ChatMessage[],
  id: string,
  lookupId: string,
  webviewLog: (msg: string, level?: string) => void
): void {
  const msgObj = messages.find((m) => m.id === id) || messages.find((m) => m.id === lookupId)

  if (msgObj && msgObj.blocks.length > 0) {
    finishUnresolvedToolCalls(msgObj.blocks)
    const renderId = msgObj.id || lookupId
    reRenderMessage(renderId, els, messages)
    ensureRenderedTextFallback(renderId, msgObj, els)
  } else {
    const noticeText = "(no response \u2014 model returned no text content)"
    webviewLog(`handleStreamEnd: empty response for ${id}`, "warn")
    if (msgObj) {
      msgObj.blocks = [createTextBlock(noticeText)]
      finishUnresolvedToolCalls(msgObj.blocks)
      const renderId = msgObj.id || lookupId
      reRenderMessage(renderId, els, messages)
      const bubble = els.messageList.querySelector(`[data-message-id="${renderId}"] .msg-text`) as HTMLElement | null
      bubble?.classList.add("msg-text--empty-notice")
    }
  }
}

function mergeServerBlocks(msgObj: ChatMessage, blockList: Block[]): void {
  const existingTextIdx = msgObj.blocks.findIndex((b) => b.type === "text")
  for (const sb of blockList) {
    if (sb.type === "text") {
      if (existingTextIdx >= 0) {
        msgObj.blocks[existingTextIdx] = sb
      } else {
        msgObj.blocks.push(sb)
      }
    } else if (sb.type === "tool-call") {
      const existingIdx = msgObj.blocks.findIndex((b) => {
        if (b.type !== "tool-call") return false
        if (b.id === sb.id) return true
        return b.name === sb.name &&
               JSON.stringify(b.args) === JSON.stringify(sb.args)
      })

      if (existingIdx >= 0) {
        if (sb.state === "result" || sb.result || sb.error) {
          msgObj.blocks[existingIdx] = sb
        }
      } else {
        msgObj.blocks.push(sb)
      }
    } else if (sb.type === "skill_badge") {
      const exists = msgObj.blocks.some(b => b.type === "skill_badge" && b.skillName === sb.skillName)
      if (!exists) {
        msgObj.blocks.push(sb)
      }
    }
  }
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

  const resolved = resolveStreamEndId(messageId, state.streamingMessageId)
  if (!resolved) {
    webviewLog("handleStreamEnd: no messageId \u2014 no stream to end", "warn")
    resetStreamState(state)
    saveState()
    return
  }

  state.rafPending = false

  const blockList = Array.isArray(blocks) ? blocks as Block[] : []
  finishUnresolvedToolCalls(blockList)

  // M3: when the server provides authoritative blocks, mergeServerBlocks +
  // reRenderMessage rebuild the whole bubble below — a forceFlush here would be
  // discarded a tick later, wasting a full parse/sanitize on the heaviest
  // message. Drain only on the empty-blocks path where the live text is what we
  // keep; otherwise destroy() the queue so its bytes are dropped and the later
  // safety-net forceFlush in resetStreamState becomes a guarded no-op.
  if (state.renderQueue) {
    if (blockList.length === 0) state.renderQueue.forceFlush()
    else state.renderQueue.destroy()
  }

  if (blockList.length === 0) {
    handleEmptyStreamEnd(els, messages, resolved.id, resolved.lookupId, webviewLog)
    resetStreamState(state)
    saveState()
    return
  }

  const msgObj = messages.find((m) => m.id === resolved.id) || messages.find((m) => m.id === resolved.lookupId)
  if (msgObj) {
    mergeServerBlocks(msgObj, blockList)
    finishUnresolvedToolCalls(msgObj.blocks)
    const renderId = msgObj.id || resolved.lookupId
    reRenderMessage(renderId, els, messages)
    ensureRenderedTextFallback(renderId, msgObj, els)
  } else {
    webviewLog(`handleStreamEnd: message obj not found for id=${resolved.id}`, "warn")
  }

  resetStreamState(state)
  saveState()
}
