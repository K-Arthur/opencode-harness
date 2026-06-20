import type { WebviewState, ChatMessage } from "./types"
import type { ElementRefs } from "./dom"
import {
  generateTitle,
  isAutoSessionName,
  probeActiveRun,
  abortStream,
  sendMessage,
  type SendMessageDeps,
} from "./sendMessage"
import {
  getStreamCapacityState,
  isServerStreaming,
  resolveSendModel,
  updateSendButtonIcon,
  updateSendButton,
} from "./sendButton"
import type { StreamCapacityState } from "./sendButton"
import {
  getCurrentSteerMode,
  setSteerMode,
  syncSteerModeUI,
  getSteerMode,
  sendSteerPrompt,
} from "./steerMode"

export { setMaxConcurrentStreams, getMaxConcurrentStreams } from "./streamConfig"
/** @deprecated Use getMaxConcurrentStreams() for runtime checks */
export const MAX_CONCURRENT_STREAMS = 5

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
    getAttachments: () => Array<{ data: string; mimeType: string }>
    clearAttachments: () => void
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
  /** Returns true if the active session has at least one pending (unanswered)
   *  question in the question bar. Used to warn/block send when user input
   *  is expected first (Gap 5, Deadlock 2 prevention). */
  hasPendingQuestion?: () => boolean
}

export function createSendLogic(deps: SendLogicDeps) {
  const {
    els,
    stateManager,
    vscode,
    streamHandlers,
    modelDropdown,
    updateAgentStatus,
  } = deps

  // Helper functions for the composed modules
  const getStreamCapacityStateFn = () => getStreamCapacityState(stateManager)
  const isServerStreamingFn = (active: { id: string } | null) => isServerStreaming(active, stateManager)
  const resolveSendModelFn = (active?: { model?: string } | null | undefined) => resolveSendModel(active ?? null, stateManager, modelDropdown)
  const updateSendButtonIconFn = (isStreaming: boolean | undefined, streamCapacity: StreamCapacityState) =>
    updateSendButtonIcon(isStreaming, streamCapacity, els, stateManager, isServerStreamingFn)
  const updateSendButtonFn = () =>
    updateSendButton(deps, getStreamCapacityStateFn, isServerStreamingFn, resolveSendModelFn, updateSendButtonIconFn)
  const getCurrentSteerModeFn = () => getCurrentSteerMode(stateManager)
  const sendSteerPromptFn = (modeOverride?: "interrupt" | "queue") =>
    sendSteerPrompt(modeOverride, deps, getCurrentSteerModeFn, updateSendButtonFn)

  // Compose sendMessage with all dependencies
  const sendMessageDeps: SendMessageDeps = {
    ...deps,
    getStreamCapacityState: getStreamCapacityStateFn,
    isServerStreaming: isServerStreamingFn,
    resolveSendModel: resolveSendModelFn,
    updateSendButton: updateSendButtonFn,
    sendSteerPrompt: sendSteerPromptFn,
  }

  return {
    getStreamCapacityState: getStreamCapacityStateFn,
    updateSendButtonIcon: (isStreaming?: boolean, streamCapacity?: StreamCapacityState) =>
      updateSendButtonIconFn(isStreaming, streamCapacity ?? getStreamCapacityStateFn()),
    updateSendButton: updateSendButtonFn,
    sendMessage: () => sendMessage(sendMessageDeps),
    abortStream: () => abortStream(stateManager, streamHandlers, updateAgentStatus, vscode),
    generateTitle,
    isAutoSessionName,
    sendSteerPrompt: sendSteerPromptFn,
    setSteerMode: (mode: "interrupt" | "queue") => setSteerMode(mode, stateManager, els),
    syncSteerModeUI: () => syncSteerModeUI(stateManager, els),
    getSteerMode: () => getSteerMode(stateManager),
    probeActiveRun: () => probeActiveRun(stateManager, vscode),
  }
}
