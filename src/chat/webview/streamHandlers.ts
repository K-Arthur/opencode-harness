import type { Block, ChatMessage, ToolCallBlock, DiffBlock, ErrorBlock, QuestionBlock, ToolCallState, DiffHunk } from "./types"
import { createTextBlock, createErrorBlock, createTaskBannerBlock } from "./blocks"
import { timers } from "./timerRegistry"
import type { SdkMessageEvent, DiffChunk } from "../../types"
import type { ErrorContext } from "./errorTypes"
import { renderMessage } from "./messageRenderer"
import { renderBlock, renderMarkdown } from "./renderer"
import { sanitizeHtml, highlightSyntax } from "./syntaxHighlighter"
import type { RenderOptions } from "./renderer"
import { renderToolGroup } from "./toolCallRenderer"
import type { ScrollAnchor } from "./scrollAnchor"
import { CHECK_SVG, SUCCESS_SVG, SPINNER_SVG } from "./icons"
import { RenderQueue } from "./renderQueue"
import { LiveTextRenderer } from "./liveTextRenderer"
type HandleStreamEndFn = (state: StreamState, els: StreamElements, messages: ChatMessage[], saveState: () => void, messageId?: string, blocks?: unknown) => void
let _handleStreamEndImpl: HandleStreamEndFn | undefined
export function registerStreamEndHandler(fn: HandleStreamEndFn): void { _handleStreamEndImpl = fn }
import { getErrorHandler } from "./errorHandler"
import { getErrorDisplay } from "./errorComponents"
import type { ErrorActionButton } from "./types"
import { parseQuestionArgs, parseAllowFreeText } from "../../session/questionModel"

// Stateless (no /g) so it is safe to reuse across calls without lastIndex drift.
const HAS_CONTEXT_MARKER = /<context>/i

// M6: soft cap for the live render buffer — diagnostics only, never truncated.
const LIVE_BUFFER_SOFT_CAP = 2 * 1024 * 1024

export function stripContextFromText(text: string): string {
  if (!text) return ""
  // M1: skip the lazy [\s\S]*? strip regex entirely when there is no marker.
  // A non-backtracking case-insensitive existence test is linear and cheap;
  // the trim is preserved to keep the function's contract unchanged.
  if (!HAS_CONTEXT_MARKER.test(text)) return text.trim()

  const contextRegex = /<context>[\s\S]*?<\/context>/gi
  let cleaned = text.replace(contextRegex, "").trim()
  const partialStart = cleaned.indexOf("<context>")
  if (partialStart !== -1 && cleaned.indexOf("</context>") === -1) {
    cleaned = cleaned.substring(0, partialStart).trim()
  }
  return cleaned
}

/**
 * M4: the prefix/suffix overlap probe is capped to a small window. A streamed
 * retransmission only ever overlaps by at most the last chunk, so scanning the
 * full accumulated length was needless O(N²) work on the recovery path.
 */
const MAX_OVERLAP_PROBE = 256

export function mergeStreamText(existing: string, chunk: string): string {
  if (!chunk) return stripContextFromText(existing)
  if (!existing) return stripContextFromText(chunk)

  const strippedChunk = stripContextFromText(chunk)
  if (strippedChunk && existing.includes(strippedChunk)) return existing

  const maxOverlap = Math.min(existing.length, chunk.length, MAX_OVERLAP_PROBE)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (existing.endsWith(chunk.slice(0, overlap))) {
      return stripContextFromText(existing + chunk.slice(overlap))
    }
  }

  return stripContextFromText(existing + chunk)
}

/**
 * Look up a message by id scanning from the END of the transcript.
 *
 * On the streaming hot path the target is almost always the most-recent
 * message, so a reverse scan is O(1) in the common case — versus `Array.find`,
 * which scans from the front and therefore did O(N) work (growing with the
 * conversation) on every render flush / tool / diff event. Message ids are
 * unique by construction (crypto ids for live streams, server ids for history),
 * so "first match from the end" is the same element `Array.find` would return.
 */
export function findMessageById(messages: ChatMessage[], id: string): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.id === id) return m
  }
  return undefined
}

function finalizeCurrentTextBlock(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
): void {
  if (!state.currentBlockEl || !state.currentBlockBuffer.trim()) return
  const displayText = stripContextFromText(state.currentBlockBuffer)
  if (!displayText.trim()) return

  const textEl = state.currentBlockEl
  textEl.classList.remove("streaming-text")
  textEl.classList.add("msg-text", "markdown-content")
  textEl.innerHTML = renderMarkdown(displayText, false)

  const id = state.streamingMessageId
  if (id) {
    const msgObj = findMessageById(messages, id)
    if (msgObj && state.currentBlockIndex >= 0) {
      const block = msgObj.blocks[state.currentBlockIndex]
      if (block && block.type === "text") {
        block.text = displayText
      }
    }
  }
}

function insertStreamingTextAfterLastBlock(
  bubble: HTMLElement,
  state: StreamState,
  messages: ChatMessage[],
): HTMLElement | null {
  let insertAfter: HTMLElement | null = null
  for (let i = bubble.children.length - 1; i >= 0; i--) {
    const child = bubble.children[i] as HTMLElement
    if (child.matches("details.tool-call, details.tool-group, .diff-block, .skill-badge")) {
      insertAfter = child
      break
    }
    if (child.classList.contains("msg-text") && !child.classList.contains("streaming-text")) {
      break
    }
  }

  const textEl = document.createElement("div")
  textEl.className = "msg-text streaming-text"

  if (insertAfter && insertAfter.nextSibling) {
    bubble.insertBefore(textEl, insertAfter.nextSibling)
  } else if (insertAfter) {
    bubble.appendChild(textEl)
  } else {
    bubble.appendChild(textEl)
  }

  state.currentBlockEl = textEl
  state.lastStreamTextEl = textEl

  const id = state.streamingMessageId
  if (id) {
    const msgObj = findMessageById(messages, id)
    if (msgObj) {
      msgObj.blocks.push(createTextBlock(""))
      state.currentBlockIndex = msgObj.blocks.length - 1
    }
  }

  return textEl
}

function appendTextToMessage(message: ChatMessage, text: string): void {
  const textBlock = message.blocks.find((block) => block.type === "text") as (Block & { text?: string }) | undefined
  if (textBlock) {
    textBlock.text = mergeStreamText(String(textBlock.text || ""), text)
    return
  }
  message.blocks.push(createTextBlock(stripContextFromText(text)))
}

export function finishUnresolvedToolCalls(blocks: Block[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block) continue
    if (block.type !== "tool-call") continue
    const tool = block as ToolCallBlock
    if (tool.state === "pending" || tool.state === "running") {
      blocks[i] = { ...tool, state: "unresolved", error: "Tool did not complete before stream ended" } as Block
    }
  }
}

export function reRenderMessage(
  messageId: string,
  els: StreamElements,
  messages: ChatMessage[]
): void {
  const msgObj = findMessageById(messages, messageId)
  if (!msgObj) return

  const oldEl = els.messageList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null

  // When re-rendering an existing message, skip the header to avoid re-adding it
  // isStreaming is false here because the message is complete
  const newEl = renderMessage(msgObj, { skipHeader: !!oldEl, isStreaming: false }, false)
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
  /** M6: set once when the live buffer crosses the soft cap (diagnostics only). */
  bufferCapWarned?: boolean
}

// m7: typed module singleton (set once at webview init via setVsCodeApi). Kept
// as a module-level handle because webviewLog is a fire-and-forget logging
// side-effect used pervasively; a typed handle removes the `any` without the
// churn of threading the API through every caller.
interface VsCodeLogApi { postMessage(msg: { type: string; level: string; message: string }): void }
let _vscode: VsCodeLogApi | null = null
export function setVsCodeApi(api: VsCodeLogApi): void { _vscode = api }

export function webviewLog(msg: string, level: "info" | "warn" | "error" | string = "info") {
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
  /** Posts webview→host messages (e.g. `question_answer`); enables interactive blocks mid-stream. */
  postMessage?: (msg: Record<string, unknown>) => void
  /** Called after live text is actually flushed to the DOM so the host can apply backpressure. */
  onRenderFlush?: (chunkSeq: number, force?: boolean) => void
  /**
   * Fired when a question tool block is created or refreshed. Main.ts wires
   * this into the input-area question bar so the user can answer without
   * scrolling back through the transcript.
   */
  onQuestionBlock?: (block: QuestionBlock, messageId: string) => void
}

const TYPING_INDICATOR_ICON = `<span class="premium-spinner-container">${SPINNER_SVG}</span>`

function createLiveRenderQueue(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  streamId: string,
  callbacks?: StreamCallbacks,
): RenderQueue {
  const liveRenderer = new LiveTextRenderer()
  return new RenderQueue((_text: string) => {
    // Guard: if tool-start cleared the buffer between enqueue and flush, skip
    // so we don't create a spurious empty text block after each tool call.
    if (!state.currentBlockBuffer.trim()) return

    let textEl = state.currentBlockEl
    if (!textEl || !els.messageList.contains(textEl)) {
      const bubble = els.messageList.querySelector(`[data-message-id="${streamId}"] .message-bubble`) as HTMLElement
      if (bubble) {
        textEl = bubble.querySelector(".streaming-text") as HTMLElement
        if (!textEl) {
          textEl = insertStreamingTextAfterLastBlock(bubble, state, messages)
        }
        if (textEl) {
          state.currentBlockEl = textEl
          state.lastStreamTextEl = textEl
        }
      }
    }
    if (!textEl) return

    const displayText = stripContextFromText(state.currentBlockBuffer)
    liveRenderer.renderInto(textEl, displayText)

    const msgObj = findMessageById(messages, streamId)
    if (msgObj && state.currentBlockIndex >= 0) {
      const block = msgObj.blocks[state.currentBlockIndex]
      if (block && block.type === "text") {
        block.text = displayText
      }
    }
    els.scrollAnchor.scrollIfAnchored()
  }, () => callbacks?.onRenderFlush?.(state.chunkSeq))
}

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
  messageId?: string,
  callbacks?: StreamCallbacks,
): void {
  if (state.isStreaming) {
    // Idempotent re-emit for the SAME id → ignore.
    if (messageId && state.streamingMessageId === messageId) {
      webviewLog(`handleStreamStart: already streaming (msgId=${state.streamingMessageId}), skipping duplicate start`, "warn")
      return
    }
    // C2: a start for a DIFFERENT id is a genuine restart (e.g. error-recovered
    // resume). Finalize the prior bubble so nothing is left "running", then fall
    // through to begin the new stream — otherwise the new id's chunks would be
    // routed into the previous bubble.
    webviewLog(`handleStreamStart: restarting stream ${state.streamingMessageId} → ${messageId ?? "<new>"}`, "warn")
    const prior = state.streamingMessageId
    if (prior) {
      const priorMsg = findMessageById(messages, prior)
      if (priorMsg) finishUnresolvedToolCalls(priorMsg.blocks)
    }
    resetStreamState(state)
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

  const el = renderMessage(streamMsg, { isStreaming: true }, isConsecutive)
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

    streamMsg.blocks.push(createTextBlock(""))
    state.currentBlockIndex = 0
  } else {
    // m2: renderMessage should always produce a .message-bubble; if it ever
    // doesn't, leave currentBlockIndex at -1 (no block to point at) and surface
    // it so the token path's recovery re-render is the only thing relied upon.
    webviewLog(`handleStreamStart: no .message-bubble for ${state.streamingMessageId ?? "<unknown>"}; deferring to token-path recovery`, "warn")
  }

  const welcome = els.messageList.querySelector(".welcome-container")
  if (welcome) welcome.remove()

  els.messageList.appendChild(el)
  els.scrollAnchor.scrollIfAnchored()

  const streamId = state.streamingMessageId
  // P1/A: one renderer per stream freezes closed blocks and re-parses only the
  // tail. It reattaches automatically when a new text block is created after a
  // tool boundary, so a single instance spans the whole stream.
  state.renderQueue = createLiveRenderQueue(state, els, messages, streamId, callbacks)

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
  callbacks?: StreamCallbacks,
): void {
  let id = state.streamingMessageId
  if (!id) {
    if (messageId) {
      const targetMsg = findMessageById(messages, messageId)
      if (targetMsg) {
        state.streamingMessageId = messageId
        state.isStreaming = true
        id = messageId
      } else {
        webviewLog(`handleStreamToken: restarting stream for messageId=${messageId} (recovered after error)`, "warn")
        state.isStreaming = false
        handleStreamStart(state, els, messages, messageId, callbacks)
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

  // M6: the live buffer is unbounded by design (it backs the message model and
  // the server blocks are authoritative at stream_end). The frozen-prefix
  // renderer keeps the per-flush PARSE cost bounded regardless of length, so we
  // do not truncate — but surface a single warning if a stream grows
  // pathologically large so it is visible in diagnostics.
  if (state.currentBlockBuffer.length > LIVE_BUFFER_SOFT_CAP && !state.bufferCapWarned) {
    state.bufferCapWarned = true
    webviewLog(`handleStreamToken: live buffer exceeded ${LIVE_BUFFER_SOFT_CAP} chars (len=${state.currentBlockBuffer.length})`, "warn")
  }

  if (!state.renderQueue) {
    state.renderQueue = createLiveRenderQueue(state, els, messages, id, callbacks)
  }
  state.renderQueue.enqueue(chunk)
}

type ToolStartPayload = { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }

export function handleToolStart(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  toolCall: ToolStartPayload,
  postMessage?: (msg: Record<string, unknown>) => void,
  callbacks?: StreamCallbacks,
): void {
  const id = state.streamingMessageId
  if (!id) return

  const msgObj = findMessageById(messages, id)
  if (updateExistingToolStart(state, els, msgObj, toolCall, postMessage, id, callbacks)) return

  prepareForToolBlock(state, els, messages, toolCall.id)
  const block = isQuestionTool(toolCall) ? createQuestionToolBlock(toolCall, msgObj) : createToolCallBlock(toolCall) as Block
  if (block.type === "question" && callbacks?.onQuestionBlock) {
    callbacks.onQuestionBlock(block as QuestionBlock, id)
  }
  appendStreamingToolBlock(
    els,
    id,
    msgObj,
    block,
    { messageId: id, postMessage },
  )
  els.scrollAnchor.scrollIfAnchored()
}

function updateExistingToolStart(
  state: StreamState,
  els: StreamElements,
  msgObj: ChatMessage | undefined,
  toolCall: ToolStartPayload,
  postMessage?: (msg: Record<string, unknown>) => void,
  messageId?: string,
  callbacks?: StreamCallbacks,
): boolean {
  if (!msgObj) return false

  // A question that already exists: re-parse the (now fuller) args and
  // re-render it in place rather than treating it as a generic tool card.
  if (isQuestionTool(toolCall) && msgObj.blocks.some(
    (b) => b.type === "question" && ((b.toolCallId as string) === toolCall.id || (b.id as string) === toolCall.id)
  )) {
    state.streamingToolCallId = toolCall.id
    const refreshed = refreshQuestionBlock(els, msgObj.blocks ? [msgObj] : [], toolCall.id, toolCall.args, postMessage, messageId)
    if (refreshed && callbacks?.onQuestionBlock) {
      const block = msgObj.blocks.find(
        (b) => b.type === "question" && ((b.toolCallId as string) === toolCall.id || (b.id as string) === toolCall.id)
      )
      if (block) callbacks.onQuestionBlock(block as QuestionBlock, messageId ?? "")
    }
    return true
  }

  const existing = msgObj.blocks.findIndex(
    (b) => b.type === "tool-call" && (b as ToolCallBlock).id === toolCall.id
  )
  if (existing < 0) return false

  state.streamingToolCallId = toolCall.id
  webviewLog(`handleToolStart: updating existing tool_start id=${toolCall.id}`)
  const block = msgObj.blocks[existing] as ToolCallBlock
  block.args = toolCall.args
  handleToolUpdate(els, toolCall.id, { args: toolCall.args })
  return true
}

function prepareForToolBlock(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  toolCallId: string,
): void {
  // C3: drain any queued-but-unflushed bytes into the DOM/model FIRST. Between
  // two consecutive tools the previous prepare left currentBlockEl === null, so
  // finalizeCurrentTextBlock would early-return and the inter-tool text would
  // be lost when we zero the buffer below. forceFlush re-establishes the text
  // element (via the queue callback) so finalize can persist it.
  state.renderQueue?.forceFlush()
  finalizeCurrentTextBlock(state, els, messages)
  state.streamingToolCallId = toolCallId
  state.currentBlockBuffer = ""
  state.currentBlockEl = null
}

function isQuestionTool(toolCall: ToolStartPayload): boolean {
  return (toolCall.name || "").toLowerCase() === "question"
}

function createQuestionToolBlock(toolCall: ToolStartPayload, msgObj: ChatMessage | undefined): Block {
  const args = toolCall.args
  // One-time visibility into the real emitted schema (helps confirm whether the
  // model sends flat {question,options} or nested {questions:[...]}).
  try { webviewLog(`question tool start id=${toolCall.id} args=${JSON.stringify(args)}`) } catch { /* circular/oversized args */ }
  return buildQuestionBlock(toolCall.id, msgObj?.sessionId, args)
}

function buildQuestionBlock(id: string, sessionId: string | undefined, args: unknown): Block {
  const groups = parseQuestionArgs(args)
  const first = groups[0]
  return {
    type: "question",
    id,
    toolCallId: id,
    sessionId,
    groups,
    text: first?.question ?? "",
    options: first?.options ?? [],
    allowFreeText: parseAllowFreeText(args),
  } satisfies QuestionBlock as Block
}

/**
 * Re-parse a question tool's (now more complete) args into the existing
 * question block and re-render it in place. Returns true when a question block
 * for `toolId` was found and handled — even if the new args were still empty —
 * so the generic tool-update path doesn't turn it into a tool-args card.
 */
export function refreshQuestionBlock(
  els: StreamElements,
  messages: ChatMessage[],
  toolId: string,
  args: unknown,
  postMessage?: (msg: Record<string, unknown>) => void,
  messageId?: string,
): boolean {
  for (const msg of messages) {
    const idx = msg.blocks.findIndex(
      (b) => b.type === "question" && ((b.toolCallId as string) === toolId || (b.id as string) === toolId)
    )
    if (idx < 0) continue
    const block = msg.blocks[idx] as QuestionBlock
    // Never overwrite a user-answered question
    if (block.answered) return true
    const groups = parseQuestionArgs(args)
    if (groups.length === 0) return true // partial/empty update — keep what we have
    block.groups = groups
    block.text = groups[0]!.question
    block.options = groups[0]!.options
    block.allowFreeText = parseAllowFreeText(args)

    const oldEl = els.messageList.querySelector(`.question-block[data-block-id="${toolId}"]`)
    const freshEl = renderBlock(block as Block, { messageId: messageId ?? "", postMessage })
    if (oldEl && freshEl) oldEl.replaceWith(freshEl)
    return true
  }
  return false
}

function createToolCallBlock(toolCall: ToolStartPayload): ToolCallBlock {
  return {
    type: "tool-call",
    id: toolCall.id,
    name: toolCall.name || "Tool",
    class: (toolCall.class as ToolCallBlock["class"]) || "read",
    state: toolCall.state === "running" ? "running" : "pending",
    args: toolCall.args,
  }
}

function appendStreamingToolBlock(
  els: StreamElements,
  messageId: string,
  msgObj: ChatMessage | undefined,
  block: Block,
  opts?: RenderOptions,
): void {
  if (msgObj) msgObj.blocks.push(block)

  const msgEl = els.messageList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
  const bubble = msgEl?.querySelector(".message-bubble") as HTMLElement | null
  if (bubble && msgObj) appendOrFoldToolDOM(bubble, block, msgObj.blocks, opts)
}

/**
 * Append a newly-started tool to the bubble while honoring codex-style
 * grouping: consecutive tool calls fold into one `details.tool-group`
 * instead of stacking as individual rows.
 *
 * Why this lives here (and not in messageRenderer): the live streaming
 * path appends tools one at a time as the server emits them. Calling
 * `reRenderMessage` mid-stream would tear down the still-mutating
 * streaming-text element. Folding at append-time keeps the streaming
 * state intact while giving the user the same visual result the
 * post-stream re-render already produces via groupConsecutiveToolCalls.
 *
 * The msg.blocks array is the source of truth: we look at the previous
 * non-silent block to decide whether to extend an existing group, wrap
 * the prior tool into a new group, or just append a fresh row.
 */
function appendOrFoldToolDOM(bubble: HTMLElement, newToolBlock: Block, allBlocks: Block[], opts?: RenderOptions): void {
  const renderOpts = opts ?? {}
  // Find the previous block that the renderer would have produced visible
  // DOM for. Skip silent step-start / normal step-finish blocks — they
  // don't render, so they don't appear in the bubble's child list.
  let prevBlock: Block | null = null
  for (let i = allBlocks.length - 2; i >= 0; i--) {
    const b = allBlocks[i]
    if (!b) continue
    if (b.type === "step-start") continue
    if (b.type === "step-finish") {
      const raw = typeof b.reason === "string" ? b.reason.trim() : ""
      const norm = raw.replace(/-/g, "_")
      if (raw === "" || norm === "stop" || norm === "end_turn" || norm === "stop_sequence" ||
          norm === "tool_use" || norm === "tool_calls" || norm === "complete") {
        continue
      }
    }
    prevBlock = b
    break
  }

  const lastEl = bubble.lastElementChild as HTMLElement | null
  const prevIsTool = prevBlock?.type === "tool-call" || prevBlock?.type === "tool_call" || prevBlock?.type === "tool"

  // Case 1: previous block was a tool and the DOM tail is already a
  // tool-group → append the new tool as another child of that group and
  // refresh the summary count.
  if (prevIsTool && lastEl && lastEl.matches("details.tool-group")) {
    const childrenContainer = lastEl.querySelector(".tool-group-children")
    if (childrenContainer) {
      const blockEl = renderBlock(newToolBlock, renderOpts)
      if (blockEl) {
        blockEl.classList.add("tool-group-child")
        childrenContainer.appendChild(blockEl)
        // Auto-expand the group if the new tool is running/pending
        const newState = (newToolBlock as ToolCallBlock).state
        const groupDetails = lastEl as HTMLDetailsElement
        if ((newState === 'running' || newState === 'pending') && !groupDetails.open) {
          groupDetails.open = true
        }
        updateToolGroupHeader(lastEl)
        return
      }
    }
  }

  // Case 2: previous block was a tool but the DOM tail is still a single
  // `details.tool-call` (no group yet) → wrap the live previous DOM and
  // the new tool into a fresh group.
  //
  // Why move the live DOM instead of re-rendering both from msg.blocks:
  // handleToolUpdate / handleToolEnd mutate the previous tool's DOM
  // directly (args panel, result panel, duration, error state) WITHOUT
  // writing those mutations back into msg.blocks. A naive re-render
  // would silently lose all of that state. Moving the existing element
  // into the new group keeps every progressive update intact.
  if (prevIsTool && lastEl && lastEl.matches("details.tool-call") && !lastEl.classList.contains("tool-group") && prevBlock) {
    const groupEl = renderToolGroup([prevBlock, newToolBlock], renderOpts) as HTMLElement | null
    if (groupEl) {
      const children = groupEl.querySelector(".tool-group-children") as HTMLElement | null
      if (children) {
        // Drop the freshly-rendered first child (a copy of prevBlock with
        // no runtime state) and slot the live DOM in its place.
        const fresh = children.firstElementChild
        if (fresh) fresh.remove()
        lastEl.classList.add("tool-group-child")
        // Detach lastEl from bubble before inserting into the group.
        lastEl.remove()
        children.insertBefore(lastEl, children.firstChild)
        bubble.appendChild(groupEl)
        return
      }
    }
  }

  // Case 3: nothing to fold into → append the tool individually.
  const blockEl = renderBlock(newToolBlock, renderOpts)
  if (blockEl) bubble.appendChild(blockEl)
}

function updateToolGroupHeader(groupEl: HTMLElement): void {
  const children = groupEl.querySelectorAll<HTMLElement>(".tool-group-children > .tool-group-child")
  const count = children.length

  // Count running/pending tools for header display and auto-expand
  const runningCount = Array.from(children).filter((child) =>
    child.classList.contains("tool-call--running") || child.classList.contains("tool-call--pending")
  ).length

  const countEl = groupEl.querySelector(".tool-group-count")
  if (countEl) {
    const base = `${count} call${count > 1 ? "s" : ""}`
    countEl.textContent = runningCount > 0 ? `${base} (${runningCount} running)` : base
    countEl.setAttribute("aria-live", "polite")
  }

  // Auto-expand the group if any child is still active
  const details = groupEl as HTMLDetailsElement
  if (runningCount > 0 && !details.open) {
    details.open = true
    groupEl.classList.remove("tool-group--idle")
    groupEl.classList.add("tool-group--active")
  } else if (runningCount === 0 && groupEl.classList.contains("tool-group--active")) {
    groupEl.classList.remove("tool-group--active")
    groupEl.classList.add("tool-group--idle")
  }

  // Refresh breakdown: count tool-class variants present in the group.
  const breakdownEl = groupEl.querySelector(".tool-group-breakdown")
  if (breakdownEl) {
    const counts: Record<string, number> = {}
    children.forEach((child) => {
      const match = child.className.match(/tool-call--(read|write|exec|meta|error)/)
      const cls = match ? match[1]! : "read"
      counts[cls] = (counts[cls] || 0) + 1
    })
    const breakdown = Object.entries(counts).map(([type, n]) => `${n} ${type}`).join(", ")
    breakdownEl.textContent = `(${breakdown})`
  }
}

// m1: single source of truth for tool-call state \u2192 CSS class / badge text. The
// regex is exhaustive over the known states; a new state is added in ONE place
// and both the class-swap and badge mapping stay in sync.
const TOOL_STATE_CLASS_RE = /tool-call--(?:pending|running|result|completed|error|stale)/g

export function setToolStateClass(el: HTMLElement, state: string): void {
  el.className = el.className.replace(TOOL_STATE_CLASS_RE, `tool-call--${state}`)
}

export function toolBadgeText(state?: string, hasError?: boolean): string | null {
  if (state === "pending") return "\u25cb Pending"
  if (state === "running") return "\u25c9 Running"
  if (state === "stale") return "Stale"
  if (state === "unresolved") return "\u26a0 Incomplete"
  if (hasError || state === "error") return "\u2717 Error"
  if (state === "completed" || state === "result") return "\u2713 Done"
  return null
}

export function handleToolUpdate(
  els: StreamElements,
  toolId: string,
  update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }
): void {
  const toolEl = els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
  if (!toolEl) return

  if (update.state) {
    setToolStateClass(toolEl, update.state)
    const badge = toolEl.querySelector(".tool-status")
    if (badge) {
      const text = toolBadgeText(update.state, update.error !== undefined)
      if (text) badge.textContent = text
    }
    // Re-evaluate parent group header after tool state change
    const parentGroup = toolEl.closest(".tool-group") as HTMLElement | null
    if (parentGroup) updateToolGroupHeader(parentGroup)
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
    if (resultEl.dataset.lastResult !== update.result) {
      resultEl.textContent = update.result
      resultEl.dataset.lastResult = update.result
    }
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
  setToolStateClass(toolEl, state)

  const badge = toolEl.querySelector(".tool-status")
  if (badge) {
    const text = toolBadgeText(state)
    if (text) badge.textContent = text
  }

  if (result.durationMs) {
    const nameEl = toolEl.querySelector(".tool-name") as HTMLElement | null
    if (nameEl) {
      let dur = nameEl.parentElement?.querySelector(".tool-duration") as HTMLElement | null
      if (!dur) {
        dur = document.createElement("span")
        dur.className = "tool-duration"
        dur.style.marginLeft = 'auto'
        nameEl.parentElement?.appendChild(dur)
      }
      dur.textContent = `${result.durationMs}ms`
    }
  }

  if (result.result !== undefined) {
    let resultEl = toolEl.querySelector(".tool-result-panel") as HTMLElement | null
    if (!resultEl) {
      resultEl = document.createElement("div")
      resultEl.className = "tool-result-panel"
      toolEl.appendChild(resultEl)
    }
    if (resultEl.dataset.lastResult !== result.result) {
      resultEl.textContent = result.result
      resultEl.dataset.lastResult = result.result
    }
  }

  if (!result.ok) toolEl.classList.add("tool-call--error")

  // Re-evaluate parent group header after tool state change
  const parentGroup = toolEl.closest(".tool-group") as HTMLElement | null
  if (parentGroup) updateToolGroupHeader(parentGroup)
}

export function handleDiff(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }
): void {
  const id = state.streamingMessageId
  if (!id) return

  // C3: drain queued bytes before clearing the buffer (see prepareForToolBlock).
  state.renderQueue?.forceFlush()
  finalizeCurrentTextBlock(state, els, messages)
  state.currentBlockBuffer = ""
  state.currentBlockEl = null

  const diffBlock: DiffBlock = {
    type: 'diff',
    diffId: diff.diffId,
    path: diff.path,
    hunks: diff.hunks,
    state: 'pending',
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
  }

  const msgObj = findMessageById(messages, id)
  if (msgObj) msgObj.blocks.push(diffBlock as Block)

  const msgEl = els.messageList.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null
  if (msgEl) {
    const bubble = msgEl.querySelector(".message-bubble")
    if (bubble) {
      const blockEl = renderBlock(diffBlock as Block, {})
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
  callbacks?: StreamCallbacks,
): void {
  handleStreamToken(state, els, messages, text, saveState, messageId, callbacks)
}

export function handleSkillIndicator(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  skillName: string
): void {
  const id = state.streamingMessageId
  if (!id) return

  const msgObj = findMessageById(messages, id)
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
  if (!_handleStreamEndImpl) throw new Error("Stream end handler not registered — import streamEndHandler before calling handleStreamEnd")
  _handleStreamEndImpl(state, els, messages, saveState, messageId, blocks)
}

export function handleStreamError(
  state: StreamState,
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  error: { code: string; message: string; detail?: string; retryable?: boolean; errorContext?: ErrorContext }
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
      } else {
        const msgObj = findMessageById(messages, id)
        if (msgObj) finishUnresolvedToolCalls(msgObj.blocks)
      }
    }
  }
  resetStreamState(state)
  state.rafPending = false

  // Prefer the structured context the host already mapped (full fidelity:
  // category, severity, actions, technical detail). Only re-classify the raw
  // string when no context was carried across the wire.
  const errorContext = error.errorContext
    ?? getErrorHandler({ logToConsole: true, logToExtension: false }).handleError(error)

  // Coalesce duplicate error cards: the same failure can arrive several times
  // (stream retries, repeated server "error" statuses for one fault). If the
  // most recent message is already an identical error card, refresh it in place
  // instead of stacking another out-of-flow copy for the same thing.
  const lastMsg = messages[messages.length - 1]
  const lastBlock = lastMsg?.role === "system" ? lastMsg.blocks?.[0] : undefined
  const lastErrMessage = lastBlock?.type === "error" ? (lastBlock as { message?: string }).message : undefined
  if (lastMsg && lastErrMessage !== undefined && lastErrMessage === errorContext.userMessage) {
    lastMsg.timestamp = Date.now()
    saveState()
    return
  }

  const errorDisplay = getErrorDisplay()
  const errorElement = errorDisplay.render(errorContext)

  // Convert ErrorContext.suggestedActions to ErrorActionButton[]
  const actionButtons: ErrorActionButton[] | undefined = errorContext.suggestedActions?.length
    ? errorContext.suggestedActions.map(a => ({
        label: a.label,
        action: a.action,
        primary: a.primary,
        disabled: a.disabled,
        metadata: a.metadata,
      }))
    : undefined

  // Create a wrapper message for the error
   const errMsg: ChatMessage = {
     role: "system",
     id: `error-${crypto.randomUUID()}`,
     blocks: [createErrorBlock("stream_error", errorContext.userMessage, errorContext.retryable ?? false, errorContext.technicalDetails, actionButtons)],
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
  message?: string,
  errorContext?: ErrorContext
): void {
  handleStreamError(state, els, messages, saveState, {
    code: 'request_failed',
    message: typeof message === "string" ? message : "The request failed. Please try again.",
    errorContext,
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
  messages: ChatMessage[],
  saveState: () => void,
  status?: string,
  errorContext?: ErrorContext
): void {
  if (status === "thinking" || status === "busy") {
    showTypingIndicator(els, "Thinking...")
  } else if (status === "error") {
    hideTypingIndicator(els)
    // Carry the host-mapped context through unchanged so its category, severity,
    // suggested actions (e.g. "Upgrade Plan" + URL) and technical detail survive,
    // instead of collapsing to a string the renderer would re-classify by regex.
    const errorMessage = errorContext?.userMessage || "An error occurred. Please try again."
    // m5: operate on the real session messages and persist, instead of passing
    // an empty array and a no-op save (which dropped the partial + skipped save).
    handleRequestError(state, els, messages, saveState, errorMessage, errorContext)
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
  state.bufferCapWarned = false
  // M5: defensively bound the per-stream event dedup set so it can never grow
  // unboundedly across a long-lived webview if a future code path adds to it.
  state.seenEventIds.clear()
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
