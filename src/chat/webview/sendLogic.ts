import type { WebviewState, ChatMessage } from "./types"
import type { ElementRefs } from "./dom"
import type { SendLogicDeps, SendMessageDeps, StreamCapacityState } from "./sendTypes"
import {
  generateTitle,
  isAutoSessionName,
  probeActiveRun,
  abortStream,
  sendMessage,
} from "./sendMessage"
import {
  getStreamCapacityState,
  isServerStreaming,
  resolveSendModel,
  updateSendButtonIcon,
  updateSendButton,
} from "./sendButton"
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
