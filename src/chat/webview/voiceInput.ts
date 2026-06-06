import {
  type VoiceInputSettings,
  type VoiceInputState,
  isStaleVoiceRequest,
  sanitizeVoiceTranscript,
  transitionVoiceInputState,
} from "../voiceInputCore"
import { getVoiceTooltip, type VoiceState } from "./tooltips"

interface VoiceInputElements {
  promptInput: HTMLTextAreaElement
  voiceInputBtn: HTMLButtonElement
  voiceInputStatus: HTMLElement
}

export interface VoiceInputDeps {
  els: VoiceInputElements
  postMessage: (msg: Record<string, unknown>) => void
  /** Insert text at the caret (used for append mode). */
  insertTextAtCursor: (text: string) => void
  autoResizeTextarea: () => void
  updateSendButton: () => void
  /** Submit the prompt (used only when autoSend is on and Send is enabled). */
  submitPrompt?: () => void
}

export interface VoiceInputApi {
  applySettings: (settings: VoiceInputSettings) => void
  handleRecordingStarted: (msg: { requestId?: unknown }) => void
  handleTranscribing: (msg: { requestId?: unknown }) => void
  handleTranscript: (msg: { requestId?: unknown; text?: unknown }) => void
  handleError: (msg: { requestId?: unknown; message?: unknown }) => void
  getState: () => VoiceInputState
  dispose: () => void
}

function createRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  return `voice-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

/**
 * Native, in-composer voice input controller.
 *
 * The webview cannot capture the microphone, so this is purely the UI: the
 * extension host records + transcribes locally and drives state transitions
 * through `voice_*` messages. The mic button toggles start → stop; the final
 * transcript is inserted into the prompt for the user to edit (never
 * auto-sent unless `autoSend` is explicitly enabled).
 */
export function setupVoiceInput(deps: VoiceInputDeps): VoiceInputApi {
  const { els, postMessage, insertTextAtCursor, autoResizeTextarea, updateSendButton } = deps
  let settings: VoiceInputSettings | null = null
  let state: VoiceInputState = "disabled"
  let currentRequestId: string | null = null

  function statusForState(next: VoiceInputState): string {
    switch (next) {
      case "disabled":
        return "Voice input unavailable. You can still type your prompt normally."
      case "starting":
        return "Starting microphone…"
      case "recording":
        return "Recording. Press Escape or the microphone button to stop."
      case "transcribing":
        return "Transcribing your recording…"
      case "inserted":
        return "Transcript inserted into the prompt."
      case "error":
        return "Voice input failed."
      case "idle":
      default:
        return "Voice input ready."
    }
  }

  function setState(next: VoiceInputState, status?: string): void {
    state = next
    els.voiceInputBtn.dataset.state = next
    els.voiceInputBtn.classList.toggle("voice-input-recording", next === "recording")
    els.voiceInputBtn.setAttribute("aria-pressed", next === "recording" ? "true" : "false")
    els.voiceInputStatus.textContent = status ?? statusForState(next)
    syncButton()
  }

  function syncButton(): void {
    // Disabled only when unusable; "starting" (cancel) and "recording" (stop)
    // are interactive.
    els.voiceInputBtn.disabled = state === "disabled" || state === "transcribing"
    const copy = getVoiceTooltip(state as VoiceState)
    els.voiceInputBtn.title = copy.title
    els.voiceInputBtn.setAttribute("aria-label", copy.ariaLabel)
  }

  function applySettings(next: VoiceInputSettings): void {
    settings = next
    if (!next.enabled) {
      setState("disabled", "Voice input is disabled in settings.")
      return
    }
    if (next.available === false) {
      setState(
        "disabled",
        next.unavailableReason ?? "Voice input is not available in this VS Code environment. You can still type your prompt normally.",
      )
      return
    }
    setState("idle")
  }

  function startRecording(): void {
    if (!settings || !settings.enabled || settings.available === false) return
    if (state !== "idle" && state !== "inserted" && state !== "error") return
    currentRequestId = createRequestId()
    setState(transitionVoiceInputState(state, "start")) // → starting
    postMessage({ type: "voice_start", requestId: currentRequestId })
  }

  function stopRecording(): void {
    if (state !== "recording" || !currentRequestId) return
    setState(transitionVoiceInputState(state, "stop")) // → transcribing
    postMessage({ type: "voice_stop", requestId: currentRequestId })
  }

  function cancelRecording(): void {
    if (state !== "starting" && state !== "recording") return
    if (currentRequestId) postMessage({ type: "voice_cancel", requestId: currentRequestId })
    currentRequestId = null
    setState("idle")
  }

  function handleRecordingStarted(msg: { requestId?: unknown }): void {
    if (isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    if (state === "starting") setState("recording")
  }

  function handleTranscribing(msg: { requestId?: unknown }): void {
    if (isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    if (state === "recording" || state === "starting") setState("transcribing")
  }

  function insertTranscript(transcript: string): void {
    const text = sanitizeVoiceTranscript(transcript)
    if (!text) {
      setState("error", "No speech was detected.")
      currentRequestId = null
      return
    }
    if (settings?.insertMode === "replace") {
      els.promptInput.value = text
      els.promptInput.selectionStart = els.promptInput.selectionEnd = text.length
    } else {
      const existing = els.promptInput.value
      const needsSpace = existing.length > 0 && !/\s$/.test(existing)
      // Append at the end so dictation lands predictably after existing text.
      els.promptInput.selectionStart = els.promptInput.selectionEnd = existing.length
      insertTextAtCursor(`${needsSpace ? " " : ""}${text}`)
    }
    autoResizeTextarea()
    updateSendButton()
    els.promptInput.focus()
    setState("inserted")
    currentRequestId = null
    if (settings?.autoSend && deps.submitPrompt) deps.submitPrompt()
  }

  function handleTranscript(msg: { requestId?: unknown; text?: unknown }): void {
    if (isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    insertTranscript(sanitizeVoiceTranscript(msg.text))
  }

  function handleError(msg: { requestId?: unknown; message?: unknown }): void {
    // Errors without a requestId are global (e.g. invalid request) — always show.
    if (msg.requestId !== undefined && isStaleVoiceRequest(currentRequestId, msg.requestId)) return
    currentRequestId = null
    setState("error", typeof msg.message === "string" && msg.message ? msg.message : "Voice input failed.")
  }

  function onClick(): void {
    if (state === "recording") return stopRecording()
    if (state === "starting") return cancelRecording()
    startRecording()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && (state === "recording" || state === "starting")) {
      event.preventDefault()
      cancelRecording()
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
  postMessage({ type: "get_voice_settings" })

  return {
    applySettings,
    handleRecordingStarted,
    handleTranscribing,
    handleTranscript,
    handleError,
    getState: () => state,
    dispose,
  }
}
