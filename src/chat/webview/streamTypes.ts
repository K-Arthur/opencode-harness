import type { RenderQueue } from "./renderQueue"
import type { ScrollAnchor } from "./scrollAnchor"

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

export interface StreamElements {
  messageList: HTMLDivElement
  typingIndicator: HTMLDivElement
  typingLabel: HTMLSpanElement
  scrollAnchor: ScrollAnchor
}

export interface StreamCallbacks {
  onStreamingChange?: (isStreaming: boolean) => void
}
