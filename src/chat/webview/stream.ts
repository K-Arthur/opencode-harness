import type { ChatMessage } from "../../types"
import type { ScrollAnchor } from "./scrollAnchor"
import { renderMessage } from "./renderer"
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
} from "./streamHandlers"

// Re-export for backward compatibility with tests
export type { StreamState, StreamElements, StreamCallbacks }
export { stripContextFromText, reRenderMessage }

export interface StreamHandlers {
  handleStreamStart: (messageId?: string) => void
  handleStreamToken: (text?: string) => void
  handleStreamChunk: (text?: string) => void
  handleStreamEnd: (messageId?: string, blocks?: unknown) => void
  handleStreamError: (error: { code: string; message: string; detail?: string; retryable?: boolean }) => void
  handleRequestError: (message?: string) => void
  handleToolStart: (toolCall: { id: string; name: string; class?: string; args?: unknown }) => void
  handleToolUpdate: (toolId: string, update: { state?: ToolCallState; result?: string; error?: string }) => void
  handleToolEnd: (toolId: string, result: { ok: boolean; result?: string; durationMs?: number }) => void
  handleDiff: (diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }) => void
  handleDiffResult: (blockId?: string, ok?: boolean, message?: string) => void
  handleServerStatus: (status?: string) => void
  showTypingIndicator: (label?: string) => void
  hideTypingIndicator: () => void
  clearMessages: () => void
  readonly isStreaming: boolean
  readonly streamingMessageId: string | null
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

  handleStreamStart(messageId?: string): void {
    handleStreamStart(this.state, this.els, this.messages, messageId)
    this.callbacks?.onStreamingChange?.(true)
  }

  handleStreamToken(text?: string): void {
    handleStreamToken(this.state, this.els, text)
  }

  handleStreamChunk(text?: string): void {
    handleStreamChunk(this.state, this.els, this.messages, text)
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

  handleToolStart(toolCall: { id: string; name: string; class?: string; args?: unknown }): void {
    handleToolStart(this.state, this.els, this.messages, toolCall)
  }

  handleToolUpdate(toolId: string, update: { state?: ToolCallState; result?: string; error?: string }): void {
    handleToolUpdate(this.els, toolId, update)
  }

  handleToolEnd(toolId: string, result: { ok: boolean; result?: string; durationMs?: number }): void {
    handleToolEnd(this.els, toolId, result)
  }

  handleDiff(diff: { diffId: string; path: string; hunks: DiffHunk[]; linesAdded: number; linesRemoved: number }): void {
    handleDiff(this.state, this.els, this.messages, diff)
  }

  handleDiffResult(blockId?: string, ok?: boolean, message?: string): void {
    handleDiffResult(this.els, blockId, ok, message)
  }

  handleServerStatus(status?: string): void {
    handleServerStatus(this.state, this.els, status)
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
