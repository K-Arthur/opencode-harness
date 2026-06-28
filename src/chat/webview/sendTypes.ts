import type { ElementRefs } from "./dom"
import type { ChatMessage, WebviewState, AttachedContextItem } from "./types"

export interface StreamCapacityState {
  isFull: boolean
  streamingNames: string
  activeStreams: number
  maxStreams: number
}

export interface SendLogicDeps {
  els: ElementRefs
  stateManager: {
    getState: () => WebviewState
    getActiveSession: () => { id: string; isStreaming: boolean; isServerStreaming?: boolean; activeServerMessageId?: string; activeRunId?: string; model?: string; mode?: string; name?: string; steerMode?: "interrupt" | "queue" } | null
    getSession: (id: string) => { id: string; isStreaming: boolean; isServerStreaming?: boolean; activeServerMessageId?: string; activeRunId?: string; model?: string; mode?: string; name?: string; steerMode?: "interrupt" | "queue"; messages: unknown[] } | undefined
    getAllSessions: () => Array<{ id: string; isStreaming: boolean; isServerStreaming?: boolean }>
    setStreaming: (id: string, streaming: boolean) => void
    setServerStreaming: (id: string, streaming: boolean) => void
    save: () => void
    setSessionSteerMode?: (id: string, mode: "interrupt" | "queue") => void
  }
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
  attachmentManager: {
    getAttachments: () => Array<{ data: string; mimeType: string; filename?: string }>
    clearAttachments: () => void
    isActiveFileIncluded: () => boolean
    getActiveFile: () => string | null
    getActiveFileSelection: () => { startLine: number; endLine: number; text: string } | null
    getContextItems: () => AttachedContextItem[]
    clearSentContextItems: () => void
  }
  streamHandlers: {
    get: (id: string) => { showTypingIndicator: (msg: string) => void; finalizeStreamingText?: () => void; finalizePendingTools?: () => void } | undefined
  }
  modelDropdown: {
    getCurrentModel: () => string | undefined
  }
  hideWelcomeView: () => void
  handleRequestError: (sessionId: string, msg: string) => void
  addMessage: (sessionId: string, msg: ChatMessage) => void
  updateTabBar: () => void
  switchTab: (id: string) => void
  switchToTab: (id: string) => void
  createTabUI: (id: string, name: string) => void
  createNewTab: (name?: string) => { id: string; name: string; mode?: string } | undefined
  updateAgentStatus: (status: string) => void
  updateModeSelectorState: () => void
  renderAttachmentChips: () => void
  autoResizeTextarea: () => void
  runSlashCommandText: (
    text: string,
    active: { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string },
  ) => void
  openModelManager: () => void
  STREAM_LIMIT_TOOLTIP: string
  hasPendingQuestion?: () => boolean
}

export interface SendMessageDeps extends SendLogicDeps {
  getStreamCapacityState: () => StreamCapacityState
  isServerStreaming: (active: { id: string } | null) => boolean
  resolveSendModel: (active?: { model?: string } | null | undefined) => string | undefined
  updateSendButton: () => void
  sendSteerPrompt: (modeOverride?: "interrupt" | "queue") => void
}