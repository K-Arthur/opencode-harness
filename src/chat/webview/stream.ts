import type { ChatMessage } from "../../types"
import type { ScrollAnchor } from "./scrollAnchor"
import { renderMessage } from "./messageRenderer"
import type { SdkMessageEvent } from "../../types"
import type { DiffHunk, ToolCallState } from "./types"

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
  handleToolEnd,
  handleDiff,
  handleDiffResult,
  handleServerStatus,
  clearMessages,
  showTypingIndicator,
  hideTypingIndicator,
  stripContextFromText,
  reRenderMessage,
  handleSkillIndicator,
} from "./streamHandlers"

// Re-export for backward compatibility with tests
export type { StreamState, StreamElements, StreamCallbacks }
export { stripContextFromText, reRenderMessage }

export interface StreamHandlers {
  handleStreamStart: (messageId?: string) => void
  handleStreamToken: (text?: string) => void
  handleStreamChunk: (text?: string, messageId?: string) => void
  handleStreamEnd: (messageId?: string, blocks?: unknown) => void
  handleStreamError: (error: { code: string; message: string; detail?: string; retryable?: boolean }) => void
  handleRequestError: (message?: string) => void
  handleToolStart: (toolCall: { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }) => void
  handleToolUpdate: (toolId: string, update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }) => void
  handleToolEnd: (toolId: string, result: { ok: boolean; result?: string; durationMs?: number; stale?: boolean }) => void
  handleSkillIndicator: (skillName: string) => void
  handleDiff: (diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }) => void
  handleDiffResult: (blockId?: string, ok?: boolean, message?: string) => void
  handleServerStatus: (status?: string, errorContext?: unknown) => void
  showTypingIndicator: (label?: string) => void
  hideTypingIndicator: () => void
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

  handleStreamStart(messageId?: string): void {
    handleStreamStart(this.state, this.els, this.messages, messageId)
    this.callbacks?.onStreamingChange?.(true)
  }

  handleStreamToken(text?: string): void {
    handleStreamToken(this.state, this.els, this.messages, text)
  }

  handleStreamChunk(text?: string, messageId?: string): void {
    handleStreamChunk(this.state, this.els, this.messages, text, this.saveState, messageId)
  }

  handleStreamEnd(messageId?: string, blocks?: unknown): void {
    handleStreamEnd(this.state, this.els, this.messages, this.saveState, messageId, blocks)
    this.callbacks?.onStreamingChange?.(false)
  }

  handleStreamError(error: { code: string; message: string; detail?: string; retryable?: boolean }): void {
    handleStreamError(this.state, this.els, this.messages, this.saveState, error)
    this.callbacks?.onStreamingChange?.(false)
  }

  handleRequestError(message?: string): void {
    handleRequestError(this.state, this.els, this.messages, this.saveState, message)
    this.callbacks?.onStreamingChange?.(false)
  }

  handleToolStart(toolCall: { id: string; name: string; class?: string; args?: unknown; state?: ToolCallState }): void {
    handleToolStart(this.state, this.els, this.messages, toolCall)
  }

  handleToolUpdate(toolId: string, update: { state?: ToolCallState; result?: string; error?: string; args?: unknown }): void {
    handleToolUpdate(this.els, toolId, update)
  }

  handleToolEnd(toolId: string, result: { ok: boolean; result?: string; durationMs?: number; stale?: boolean }): void {
    handleToolEnd(this.els, toolId, result)
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

  showTypingIndicator(label?: string): void {
    showTypingIndicator(this.els, label)
  }

  hideTypingIndicator(): void {
    hideTypingIndicator(this.els)
  }

  clearMessages(): void {
    clearMessages(this.state, this.els, this.messages, this.saveState)
  }
}
