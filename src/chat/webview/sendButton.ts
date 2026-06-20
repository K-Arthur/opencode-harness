import type { ElementRefs } from "./dom"
import { TOOLTIPS } from "./tooltips"
import type { SendLogicDeps } from "./sendLogic"
import { getMaxConcurrentStreams } from "./streamConfig"

export interface StreamCapacityState {
  isFull: boolean
  streamingNames: string
  activeStreams: number
  maxStreams: number
}

export function getStreamCapacityState(
  stateManager: SendLogicDeps["stateManager"],
): StreamCapacityState {
  const maxStreams = getMaxConcurrentStreams()
  // Count any session the host has flagged as streaming OR the optimistic
  // local flag is set. The host flag is authoritative; the local flag is a
  // fallback so an in-flight send (between sendMessage and the first
  // streaming_state push) is still counted.
  const streamingSessions = stateManager.getAllSessions().filter(
    (s) => s.isStreaming || s.isServerStreaming === true,
  )
  const activeStreams = streamingSessions.length
  const isFull = activeStreams >= maxStreams
  const streamingNames = streamingSessions
    .map((s) => {
      const session = stateManager.getSession(s.id)
      return session?.name?.split("\n")[0]?.slice(0, 30) || s.id.slice(0, 8)
    })
    .filter(Boolean)
    .join(", ")
  return { isFull, streamingNames, activeStreams, maxStreams }
}

export function isServerStreaming(
  active: { id: string } | null,
  stateManager: SendLogicDeps["stateManager"],
): boolean {
  return active ? (stateManager.getState().sessions[active.id]?.isServerStreaming ?? false) : false
}

export function resolveSendModel(
  active: { model?: string } | null,
  stateManager: SendLogicDeps["stateManager"],
  modelDropdown: SendLogicDeps["modelDropdown"],
): string | undefined {
  return active?.model ?? modelDropdown.getCurrentModel() ?? stateManager.getState().globalModel
}

export function updateSendButtonIcon(
  isStreaming: boolean | undefined,
  streamCapacity: StreamCapacityState,
  els: ElementRefs,
  stateManager: SendLogicDeps["stateManager"],
  isServerStreamingFn: (active: { id: string } | null) => boolean,
): void {
  const active = stateManager.getActiveSession()
  const streaming = isStreaming ?? isServerStreamingFn(active) ?? active?.isStreaming ?? false
  els.inputArea?.classList.toggle("input-area--streaming", streaming)
  if (streaming) {
    els.sendBtn?.classList.add("stopping")
    els.sendBtn?.classList.remove("stream-limit-blocked")
    els.sendBtn?.setAttribute("aria-label", "Stop generation")
    els.sendBtn?.setAttribute("title", TOOLTIPS.chat.stop)
  } else if (streamCapacity.isFull) {
    els.sendBtn?.classList.remove("stopping")
    els.sendBtn?.classList.add("stream-limit-blocked")
    const limitLabel = streamCapacity.streamingNames
      ? TOOLTIPS.chat.sendBlockedByLimit(streamCapacity.streamingNames)
      : streamCapacity.maxStreams > 0
        ? `Only ${streamCapacity.maxStreams} concurrent streams allowed. Stop a streaming tab to free a slot.`
        : "Stream limit reached"
    els.sendBtn?.setAttribute("aria-label", limitLabel)
    els.sendBtn?.setAttribute("title", limitLabel)
  } else {
    els.sendBtn?.classList.remove("stopping")
    els.sendBtn?.classList.remove("stream-limit-blocked")
    els.sendBtn?.setAttribute("aria-label", "Send message")
    els.sendBtn?.setAttribute("title", TOOLTIPS.chat.send)
  }
}

export function updateSendButton(
  deps: SendLogicDeps,
  getStreamCapacityStateFn: () => StreamCapacityState,
  isServerStreamingFn: (active: { id: string } | null) => boolean,
  resolveSendModelFn: (active?: { model?: string } | null) => string | undefined,
  updateSendButtonIconFn: (isStreaming: boolean | undefined, streamCapacity: StreamCapacityState) => void,
): void {
  const {
    els,
    stateManager,
    attachmentManager,
    updateModeSelectorState,
    hasPendingQuestion,
  } = deps

  const hasText = els.promptInput.value.trim().length > 0
  const hasAttachments = attachmentManager.getAttachments().length > 0
  const active = stateManager.getActiveSession()
  const localStreaming = active?.isStreaming || false
  const hostStreaming = isServerStreamingFn(active)
  const isStreaming = localStreaming || hostStreaming
  const streamCapacity = getStreamCapacityStateFn()
  const blockedByStreamLimit = !isStreaming && streamCapacity.isFull
  const hasModel = isStreaming || !!resolveSendModelFn(active)
  // Block sending while a question is pending — the user must answer the
  // model's question first to avoid orphaning the activeToolCallIds tracking
  // and to prevent confusing dual-stream UX (Gap 5, Deadlock 2 prevention).
  const blockedByPendingQuestion: boolean = !isStreaming && !!active?.id && hasPendingQuestion?.() === true
  const canSubmit = hasModel && (isStreaming || ((hasText || hasAttachments) && !blockedByStreamLimit && !blockedByPendingQuestion))
  ;(els.sendBtn as HTMLButtonElement).disabled = !canSubmit
  els.sendBtn?.classList.toggle("stream-limit-blocked", blockedByStreamLimit)
  const blockedByModel = !hasModel && !isStreaming
  els.sendBtn?.classList.toggle("no-model-blocked", blockedByModel)
  if (blockedByModel) {
    els.sendBtn?.setAttribute("aria-label", "Select a model first")
    els.sendBtn?.setAttribute("title", "Select a model first")
  } else if (blockedByPendingQuestion) {
    els.sendBtn?.setAttribute("aria-label", "Answer the model's question first")
    els.sendBtn?.setAttribute("title", "Answer the model's question first")
  }
  updateSendButtonIconFn(isStreaming, streamCapacity)
  updateModeSelectorState()
}
