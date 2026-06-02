import {
  type VoiceInputSettings,
  type VoiceInputState,
  isStaleVoiceRequest,
  sanitizeVoiceTranscript,
  transitionVoiceInputState,
} from "../voiceInputCore"
import { getVoiceTooltip, type VoiceState } from "./tooltips"

type VoiceProvider = VoiceInputSettings["provider"]

interface VoiceInputElements {
  promptInput: HTMLTextAreaElement
  voiceInputBtn: HTMLButtonElement
  voiceInputStatus: HTMLElement
}

export interface VoiceInputDeps {
  els: VoiceInputElements
  postMessage: (msg: Record<string, unknown>) => void
  insertTextAtCursor: (text: string) => void
  autoResizeTextarea: () => void
  updateSendButton: () => void
}

export interface VoiceInputApi {
  applySettings: (settings: VoiceInputSettings) => void
  handleHelperOpened: (msg: { requestId?: unknown }) => void
  handleTranscript: (msg: { requestId?: unknown; text?: unknown }) => void
  handleError: (msg: { requestId?: unknown; message?: unknown }) => void
  setCurrentRequestId: (requestId: string | null) => void
  getState: () => VoiceInputState
  dispose: () => void
}

function createRequestId(): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  return `voice-${randomUUID ? randomUUID.call(globalThis.crypto) : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

export function setupVoiceInput(deps: VoiceInputDeps): VoiceInputApi {
  const { els, postMessage, insertTextAtCursor, autoResizeTextarea, updateSendButton } = deps
  let settings: VoiceInputSettings | null = null
  let state: VoiceInputState = "disabled"
  let currentRequestId: string | null = null

  function setState(next: VoiceInputState, status?: string): void {
    state = next
    els.voiceInputBtn.dataset.state = next
    els.voiceInputBtn.classList.toggle("voice-input-recording", next === "recording")
    els.voiceInputBtn.setAttribute("aria-pressed", next === "recording" ? "true" : "false")
    els.voiceInputStatus.textContent = status ?? statusForState(next)
    syncButton()
  }

  function statusForState(next: VoiceInputState): string {
    switch (next) {
      case "disabled": return "Voice input unavailable."
      case "requesting-permission": return "Requesting microphone permission."
      case "recording": return "Recording. Press Escape or the microphone button to stop."
      case "stopping": return "Stopping recording."
      case "transcribing": return "Transcribing recording."
      case "inserted": return "Transcript inserted."
      case "error": return "Voice input failed."
      case "idle":
      default: return "Voice input ready."
    }
  }

  function syncButton(): void {
    const disabled = state === "disabled" || state === "requesting-permission" || state === "stopping" || state === "transcribing"
    els.voiceInputBtn.disabled = disabled
    const copy = getVoiceTooltip(state as VoiceState)
    els.voiceInputBtn.title = copy.title
    els.voiceInputBtn.setAttribute("aria-label", copy.ariaLabel)
  }

  function setCurrentRequestId(requestId: string | null): void {
    currentRequestId = requestId
  }

  function applySettings(next: VoiceInputSettings): void {
    settings = next
    if (!next.enabled) {
      setState("disabled", "Voice input is disabled in settings.")
      return
    }
    if (next.provider === "openai" && !next.hasOpenAiApiKey) {
      setState("disabled", "OpenAI speech-to-text requires an API key.")
      return
    }
    setState("idle")
  }

  function startRecording(): void {
    if (!settings || state === "disabled" || state === "requesting-permission" || state === "recording" || state === "stopping" || state === "transcribing") return
    currentRequestId = createRequestId()
    setState(transitionVoiceInputState(state, "start"))
    postMessage({
      type: "stt_open_helper",
      requestId: currentRequestId,
      provider: settings.provider,
    })
  }

  function cancelHelperRequest(): void {
    if (state !== "recording" && state !== "requesting-permission") return
    currentRequestId = null
    setState("idle")
  }

  function handleHelperOpened(msg: { requestId?: unknown }): void {
    if (isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    setState(transitionVoiceInputState(state, "permission-granted"), "Voice helper opened in your browser. Finish recording there or click to cancel.")
  }

  function insertTranscript(transcript: string): void {
    const text = sanitizeVoiceTranscript(transcript)
    if (!text) {
      setState("error", "No speech was detected.")
      return
    }
    insertTextAtCursor(text)
    autoResizeTextarea()
    updateSendButton()
    els.promptInput.focus()
    setState("inserted")
    currentRequestId = null
  }

  function handleTranscript(msg: { requestId?: unknown; text?: unknown }): void {
    if (isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    insertTranscript(sanitizeVoiceTranscript(msg.text))
  }

  function handleError(msg: { requestId?: unknown; message?: unknown }): void {
    if (msg.requestId !== undefined && isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    currentRequestId = null
    setState("error", typeof msg.message === "string" && msg.message ? msg.message : "Voice input failed.")
  }

  function onClick(): void {
    if (state === "recording" || state === "requesting-permission") {
      cancelHelperRequest()
      return
    }
    startRecording()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && (state === "recording" || state === "requesting-permission")) {
      event.preventDefault()
      cancelHelperRequest()
    }
  }

  function dispose(): void {
    currentRequestId = null
    window.removeEventListener("keydown", onKeydown)
    els.voiceInputBtn.removeEventListener("click", onClick)
  }

  els.voiceInputBtn.addEventListener("click", onClick)
  window.addEventListener("keydown", onKeydown)
  setState("disabled")
  postMessage({ type: "get_stt_settings" })

  return {
    applySettings,
    handleHelperOpened,
    handleTranscript,
    handleError,
    setCurrentRequestId,
    getState: () => state,
    dispose,
  }
}
