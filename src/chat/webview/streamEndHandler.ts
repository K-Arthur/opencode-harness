import type { Block, ChatMessage } from "./types"
import { createTextBlock } from "./blocks"
import type { StreamState, StreamElements } from "./streamHandlers"
import { hideTypingIndicator, finishUnresolvedToolCalls, reRenderMessage, resetStreamState, webviewLog, registerStreamEndHandler, finalizeStreamingText, finalizeAllPendingTools } from "./streamHandlers"

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

/**
 * m3: decide whether two tool-call blocks are the same call. When BOTH carry an
 * id, the id is authoritative — two distinct calls with identical args (e.g.
 * reading the same file twice) must NOT be merged, and we avoid the
 * `JSON.stringify(args)` comparison entirely. Structural matching is only a
 * fallback for when an id is missing on either side.
 */
export function sameToolBlock(
  a: { id?: string; name?: string; args?: unknown },
  b: { id?: string; name?: string; args?: unknown },
): boolean {
  if (a.id && b.id) return a.id === b.id
  return a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args)
}

function mergeServerBlocks(msgObj: ChatMessage, blockList: Block[]): void {
  const merged: Block[] = []
  const usedExisting = new Set<number>()

  for (const sb of blockList) {
    if (sb.type === "tool-call") {
      const existingIdx = msgObj.blocks.findIndex(
        (b, idx) => !usedExisting.has(idx) && b.type === "tool-call" && sameToolBlock(b, sb),
      )

      if (existingIdx >= 0) {
        usedExisting.add(existingIdx)
        merged.push({ ...msgObj.blocks[existingIdx], ...sb } as Block)
      } else {
        merged.push(sb)
      }
    } else if (sb.type === "question") {
      // Match the live question block by tool-call id and merge, preferring
      // whichever side has non-empty groups so a late/empty server copy can't
      // wipe the interactive question the user is looking at.
      const sbKey = (sb.toolCallId as string) || (sb.id as string)
      const existingIdx = msgObj.blocks.findIndex(
        (b, idx) => !usedExisting.has(idx) && b.type === "question" &&
          (((b.toolCallId as string) || (b.id as string)) === sbKey),
      )
      if (existingIdx >= 0) {
        usedExisting.add(existingIdx)
        const existing = msgObj.blocks[existingIdx]!
        const mergedBlock = { ...existing, ...sb } as Block
        const sbGroups = Array.isArray(sb.groups) ? (sb.groups as unknown[]) : []
        const exGroups = Array.isArray(existing.groups) ? (existing.groups as unknown[]) : []
        if (sbGroups.length === 0 && exGroups.length > 0) {
          mergedBlock.groups = existing.groups
          mergedBlock.text = existing.text
          mergedBlock.options = existing.options
        }
        merged.push(mergedBlock)
      } else {
        merged.push(sb)
      }
    } else if (sb.type === "skill_badge") {
      const exists = merged.some(b => b.type === "skill_badge" && b.skillName === sb.skillName)
      if (!exists) {
        merged.push(sb)
      }
    } else {
      merged.push(sb)
    }
  }

  for (const existing of msgObj.blocks) {
    if (existing.type !== "skill_badge") continue
    const exists = merged.some(b => b.type === "skill_badge" && b.skillName === existing.skillName)
    if (!exists) merged.push(existing)
  }

  msgObj.blocks = merged
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

// Wrap the finalizer so a guaranteed cursor sweep runs after every stream end,
// no matter which internal exit path handleStreamEnd took (no-resolved-id,
// empty-blocks, server-blocks). This is the backstop that ensures a completed
// turn never leaves a blinking streaming caret behind.
registerStreamEndHandler((state, els, messages, saveState, messageId, blocks) => {
  handleStreamEnd(state, els, messages, saveState, messageId, blocks)
  // No streaming caret / blue backdrop, and no tool left spinning, after a turn.
  finalizeStreamingText(els.messageList)
  finalizeAllPendingTools(els, messages)
})
