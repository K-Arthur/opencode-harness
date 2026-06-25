import type { ChatMessage } from "../../types"
import type { ScrollAnchor } from "./scrollAnchor"
import type { DiffHunk, RunActivitySnapshot, ToolCallBlock, ToolCallState } from "./types"
import type { ErrorContext } from "./errorTypes"
import type { LiveToolOutput } from "./toolPartialStore"
import { createToolResultPanel } from "./toolCallRenderer"

import {
  StreamState,
  StreamElements,
  StreamCallbacks,
  handleStreamStart,
  handleStreamToken,
  handleStreamChunk,
  handleStreamEnd,
  handleStreamError,
  handleRequestError,
  handleToolStart,
  handleToolUpdate,
  handleToolPartial,
  handleToolEnd,
  refreshQuestionBlock,
  handleDiff,
  handleDiffResult,
  handleServerStatus,
  handleRunActivityUpdate,
  clearMessages,
  showTypingIndicator,
  hideTypingIndicator,
  stripContextFromText,
  reRenderMessage,
  handleSkillIndicator,
  finalizeAllPendingTools,
  resetStreamState,
} from "./streamHandlers"
import "./streamEndHandler"

// Re-export for backward compatibility with tests
export type { StreamState, StreamElements, StreamCallbacks }
export { stripContextFromText, reRenderMessage }

export interface StreamHandlers {
  handleStreamStart: (messageId?: string, opts?: { skipAnchor?: boolean }) => void
  handleStreamToken: (text?: string) => void
  handleStreamChunk: (text?: string, messageId?: string) => void
  handleStreamEnd: (messageId?: string, blocks?: unknown) => void
  /** Reset local streaming state without rendering a final message. Used after
   *  session compaction so stale chunks don't render into the old bubble. */
  resetStream: () => void
  handleStreamError: (error: { code: string; message: string; detail?: string; retryable?: boolean }) => void
  handleRequestError: (message?: string, errorContext?: unknown) => void
  handleToolStart: (toolCall: { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }) => void
  handleToolUpdate: (toolId: string, update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }) => void
  handleToolPartial: (sessionId: string, toolId: string, live: LiveToolOutput) => void
  handleToolEnd: (toolId: string, result: { ok: boolean; result?: string; durationMs?: number; stale?: boolean; state?: ToolCallState; stderr?: string; exitCode?: number }) => void
  handleSkillIndicator: (skillName: string) => void
  handleDiff: (diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }) => void
  handleDiffResult: (blockId?: string, ok?: boolean, message?: string) => void
  handleServerStatus: (status?: string, errorContext?: unknown) => void
  handleRunActivityUpdate: (activity: RunActivitySnapshot) => void
  showTypingIndicator: (label?: string) => void
  hideTypingIndicator: () => void
  /** Finalize any still-running/pending tool blocks (drop spinners / live
   *  elapsed) and re-render. Backstop for run-end paths that don't call
   *  handleStreamEnd (server idle, request error). */
  finalizePendingTools: () => void
  clearMessages: () => void
  readonly isStreaming: boolean
  readonly streamingMessageId: string | null
  readonly chunkSeq: number
  forceRerender(text: string): void
}

export function createStreamHandlers(
  els: StreamElements,
  messages: ChatMessage[],
  saveState: () => void,
  callbacks?: StreamCallbacks,
): StreamHandlers {
  return new StreamSession(
    els.messageList,
    els.typingIndicator,
    els.typingLabel,
    els.scrollAnchor,
    messages,
    saveState,
    callbacks,
  )
}

class StreamSession implements StreamHandlers {
  private state: StreamState
  private els: StreamElements
  private messages: ChatMessage[]
  private saveState: () => void
  private callbacks?: StreamCallbacks

  constructor(
    messageList: HTMLDivElement,
    typingIndicator: HTMLDivElement,
    typingLabel: HTMLSpanElement,
    scrollAnchor: ScrollAnchor,
    messages: ChatMessage[],
    saveState: () => void,
    callbacks?: StreamCallbacks,
  ) {
    this.state = {
      isStreaming: false,
      streamingMessageId: null,
      streamingBuffer: "",
      streamingBlockId: null,
      streamingToolCallId: null,
      seenEventIds: new Set<string>(),
      lastStreamTextEl: null,
      currentBlockEl: null,
      currentBlockBuffer: "",
      currentBlockIndex: -1,
      rafPending: false,
      renderQueue: null,
      chunkSeq: 0,
    }
    this.els = { messageList, typingIndicator, typingLabel, scrollAnchor }
    this.messages = messages
    this.saveState = saveState
    this.callbacks = callbacks
  }

  get isStreaming(): boolean {
    return this.state.isStreaming
  }

  get streamingMessageId(): string | null {
    return this.state.streamingMessageId
  }

  get chunkSeq(): number {
    return this.state.chunkSeq
  }

  forceRerender(text: string): void {
    this.state.currentBlockBuffer = text
    const textEl = this.state.currentBlockEl || this.state.lastStreamTextEl
    if (textEl) textEl.textContent = stripContextFromText(text)
  }

  handleStreamStart(messageId?: string, opts?: { skipAnchor?: boolean }): void {
    handleStreamStart(this.state, this.els, this.messages, messageId, this.callbacks, opts)
    this.callbacks?.onStreamingChange?.(true)
  }

  handleStreamToken(text?: string): void {
    handleStreamToken(this.state, this.els, this.messages, text, undefined, undefined, this.callbacks)
  }

  handleStreamChunk(text?: string, messageId?: string): void {
    handleStreamChunk(this.state, this.els, this.messages, text, this.saveState, messageId, this.callbacks)
  }

  handleStreamEnd(messageId?: string, blocks?: unknown): void {
    const lastRenderedChunkSeq = this.state.chunkSeq
    handleStreamEnd(this.state, this.els, this.messages, this.saveState, messageId, blocks)
    this.callbacks?.onRenderFlush?.(lastRenderedChunkSeq, true)
    this.callbacks?.onStreamingChange?.(false)
  }

  resetStream(): void {
    if (this.state.renderQueue) {
      this.state.renderQueue.forceFlush()
      this.state.renderQueue.destroy()
      this.state.renderQueue = null
    }
    resetStreamState(this.state)
    this.state.isStreaming = false
    this.state.streamingMessageId = null
    this.state.streamingBuffer = ""
    this.state.currentBlockBuffer = ""
    this.state.currentBlockEl = null
    this.state.currentBlockIndex = -1
    this.state.lastStreamTextEl = null
    this.state.streamingBlockId = null
    this.state.streamingToolCallId = null
    this.state.rafPending = false
    this.state.chunkSeq = 0
    this.callbacks?.onStreamingChange?.(false)
  }

  handleStreamError(error: { code: string; message: string; detail?: string; retryable?: boolean }): void {
    handleStreamError(this.state, this.els, this.messages, this.saveState, error)
    this.callbacks?.onStreamingChange?.(false)
  }

  handleRequestError(message?: string, errorContext?: unknown): void {
    handleRequestError(this.state, this.els, this.messages, this.saveState, message, errorContext as ErrorContext | undefined)
    this.callbacks?.onStreamingChange?.(false)
  }

  handleToolStart(toolCall: { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }): void {
    handleToolStart(this.state, this.els, this.messages, toolCall, this.callbacks?.postMessage, this.callbacks)
  }

  handleToolUpdate(toolId: string, update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }): void {
    // A question tool's input often finishes streaming after its block was
    // first rendered (empty). Refresh the question block in place so its text
    // and options appear and stay interactive; only fall back to the generic
    // tool-update path for non-question blocks.
    if (
      update.args !== undefined &&
      refreshQuestionBlock(
        this.els,
        this.messages,
        toolId,
        update.args,
        this.callbacks?.postMessage,
        this.state.streamingMessageId ?? undefined,
      )
    ) {
      return
    }
    handleToolUpdate(this.els, toolId, update)
  }

  handleToolPartial(sessionId: string, toolId: string, live: LiveToolOutput): void {
    handleToolPartial(this.els, this.messages, sessionId, toolId, live, this.callbacks?.postMessage)
  }

  handleToolEnd(toolId: string, result: { ok: boolean; result?: string; durationMs?: number; stale?: boolean; state?: ToolCallState; stderr?: string; exitCode?: number }): void {
    const found = this.messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tool-call" && (block as { id?: string }).id === toolId) as (ToolCallBlock | undefined)
    if (found) {
      found.state = result.state ?? (result.stale ? "stale" : result.ok ? "completed" : "error")
      found.result = result.result
      found.durationMs = result.durationMs
      if (typeof result.stderr === "string") found.stderr = result.stderr
      if (typeof result.exitCode === "number") found.exitCode = result.exitCode
    }
    handleToolEnd(this.els, toolId, result)
    if (found) {
      const toolEl = this.els.messageList.querySelector(`[data-block-id="${toolId}"]`) as HTMLElement | null
      const fresh = createToolResultPanel(found, {
        messageId: this.state.streamingMessageId ?? undefined,
        postMessage: this.callbacks?.postMessage,
      })
      if (toolEl && fresh) {
        const existing = toolEl.querySelector(".tool-result-panel") as HTMLElement | null
        if (existing) existing.replaceWith(fresh)
        else toolEl.appendChild(fresh)
      }
    }
    if (this.state.streamingToolCallId === toolId) this.state.streamingToolCallId = null
  }

  handleSkillIndicator(skillName: string): void {
    handleSkillIndicator(this.state, this.els, this.messages, skillName)
  }

  handleDiff(diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }): void {
    handleDiff(this.state, this.els, this.messages, diff)
  }

  handleDiffResult(blockId?: string, ok?: boolean, message?: string): void {
    handleDiffResult(this.els, blockId, ok, message)
  }

  handleServerStatus(status?: string, errorContext?: unknown): void {
    handleServerStatus(this.state, this.els, this.messages, this.saveState, status, errorContext as any)
  }

  handleRunActivityUpdate(activity: RunActivitySnapshot): void {
    handleRunActivityUpdate(this.state, this.els, activity)
  }

  showTypingIndicator(label?: string): void {
    showTypingIndicator(this.els, label)
  }

  hideTypingIndicator(): void {
    hideTypingIndicator(this.els)
  }

  clearMessages(): void {
    clearMessages(this.state, this.els, this.messages, this.saveState)
  }

  finalizePendingTools(): void {
    finalizeAllPendingTools(this.els, this.messages)
    this.saveState()
  }
}
