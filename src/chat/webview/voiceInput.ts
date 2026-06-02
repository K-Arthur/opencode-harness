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
  handleTranscript: (msg: { requestId?: unknown; text?: unknown }) => void
  handleError: (msg: { requestId?: unknown; message?: unknown }) => void
  setCurrentRequestId: (requestId: string | null) => void
  getState: () => VoiceInputState
  dispose: () => void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

function hasMediaRecorderSupport(): boolean {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined"
}

function createRequestId(): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  return `voice-${randomUUID ? randomUUID.call(globalThis.crypto) : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

function chooseAudioMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ]
  const recorder = MediaRecorder as unknown as { isTypeSupported?: (mimeType: string) => boolean }
  return candidates.find((mime) => recorder.isTypeSupported?.(mime)) ?? ""
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function setupVoiceInput(deps: VoiceInputDeps): VoiceInputApi {
  const { els, postMessage, insertTextAtCursor, autoResizeTextarea, updateSendButton } = deps
  let settings: VoiceInputSettings | null = null
  let state: VoiceInputState = "disabled"
  let currentRequestId: string | null = null
  let recognition: SpeechRecognitionLike | null = null
  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let chunks: Blob[] = []
  let elapsedTimer: ReturnType<typeof setInterval> | undefined
  let maxDurationTimer: ReturnType<typeof setTimeout> | undefined
  let recordingStartedAt = 0
  let browserFinalTranscript = ""
  let browserInterimTranscript = ""

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

  function clearTimers(): void {
    if (elapsedTimer) clearInterval(elapsedTimer)
    if (maxDurationTimer) clearTimeout(maxDurationTimer)
    elapsedTimer = undefined
    maxDurationTimer = undefined
  }

  function releaseMedia(): void {
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
    mediaRecorder = null
  }

  function resetRecordingBuffers(): void {
    chunks = []
    browserFinalTranscript = ""
    browserInterimTranscript = ""
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
    if (next.provider === "browser" && !getSpeechRecognitionCtor()) {
      setState("disabled", "Browser speech recognition is unavailable in this webview.")
      return
    }
    if (next.provider === "openai" && !hasMediaRecorderSupport()) {
      setState("disabled", "Microphone recording is unavailable in this webview.")
      return
    }
    if (next.provider === "openai" && !next.hasOpenAiApiKey) {
      setState("disabled", "OpenAI speech-to-text requires an API key.")
      return
    }
    setState("idle")
  }

  function startElapsedTimer(): void {
    clearTimers()
    recordingStartedAt = Date.now()
    elapsedTimer = setInterval(() => {
      const elapsed = Math.max(0, Math.round((Date.now() - recordingStartedAt) / 1000))
      els.voiceInputStatus.textContent = `Recording ${elapsed}s. Press Escape or the microphone button to stop.`
    }, 1000)
    maxDurationTimer = setTimeout(() => {
      void stopRecording()
    }, (settings?.maxDurationSeconds ?? 60) * 1000)
  }

  async function startRecording(): Promise<void> {
    if (!settings || state === "disabled" || state === "requesting-permission" || state === "recording" || state === "stopping" || state === "transcribing") return
    resetRecordingBuffers()
    currentRequestId = createRequestId()
    setState(transitionVoiceInputState(state, "start"))
    if (settings.provider === "browser") {
      startBrowserRecognition()
    } else {
      await startCloudRecording()
    }
  }

  function startBrowserRecognition(): void {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setState("disabled", "Browser speech recognition is unavailable in this webview.")
      return
    }
    recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = ""
    recognition.onstart = () => {
      setState(transitionVoiceInputState(state, "permission-granted"))
      startElapsedTimer()
    }
    recognition.onresult = (event) => {
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result?.[0]?.transcript ?? ""
        if (result?.isFinal) browserFinalTranscript += transcript
        else interim += transcript
      }
      browserInterimTranscript = interim
      const preview = sanitizeVoiceTranscript(`${browserFinalTranscript} ${browserInterimTranscript}`)
      if (preview) els.voiceInputStatus.textContent = `Recording: ${preview}`
    }
    recognition.onerror = (event) => {
      clearTimers()
      const message = event.error === "not-allowed" || event.error === "permission-denied"
        ? "Microphone permission was denied."
        : "Voice input failed."
      setState("error", message)
    }
    recognition.onend = () => {
      clearTimers()
      recognition = null
      const transcript = sanitizeVoiceTranscript(browserFinalTranscript || browserInterimTranscript)
      if (transcript) {
        insertTranscript(transcript)
      } else if (state !== "error") {
        setState("error", "No speech was detected.")
      }
    }
    recognition.start()
  }

  async function startCloudRecording(): Promise<void> {
    if (!settings) return
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = chooseAudioMimeType()
      mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream)
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      mediaRecorder.onstop = () => {
        void uploadRecording()
      }
      mediaRecorder.start()
      setState(transitionVoiceInputState(state, "permission-granted"))
      startElapsedTimer()
    } catch (err) {
      releaseMedia()
      setState("error", err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone permission was denied." : "Microphone is unavailable.")
    }
  }

  async function stopRecording(): Promise<void> {
    if (state !== "recording" && state !== "requesting-permission") return
    clearTimers()
    if (recognition) {
      setState(transitionVoiceInputState(state, "stop"))
      recognition.stop()
      return
    }
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      setState(transitionVoiceInputState(state, "stop"))
      mediaRecorder.stop()
      return
    }
    setState("idle")
  }

  async function uploadRecording(): Promise<void> {
    if (!settings || !currentRequestId) {
      releaseMedia()
      resetRecordingBuffers()
      setState("idle")
      return
    }
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || mediaRecorder?.mimeType || "audio/webm" })
      releaseMedia()
      resetRecordingBuffers()
      if (blob.size === 0) {
        setState("error", "No speech was detected.")
        return
      }
      if (blob.size > settings.maxUploadBytes) {
        setState("error", "Audio recording is too large.")
        return
      }
      setState(transitionVoiceInputState(state, "upload"))
      const data = await blobToBase64(blob)
      postMessage({
        type: "stt_transcribe_audio",
        requestId: currentRequestId,
        mimeType: blob.type || "audio/webm",
        data,
        sizeBytes: blob.size,
        durationMs: Date.now() - recordingStartedAt,
      })
    } catch {
      releaseMedia()
      resetRecordingBuffers()
      setState("error", "Voice input failed.")
    }
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
    clearTimers()
    releaseMedia()
    resetRecordingBuffers()
    currentRequestId = null
    setState("error", typeof msg.message === "string" && msg.message ? msg.message : "Voice input failed.")
  }

  function onClick(): void {
    if (state === "recording") {
      void stopRecording()
      return
    }
    void startRecording()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && (state === "recording" || state === "requesting-permission")) {
      event.preventDefault()
      void stopRecording()
    }
  }

  function dispose(): void {
    clearTimers()
    try { recognition?.abort() } catch { /* best effort */ }
    releaseMedia()
    resetRecordingBuffers()
    window.removeEventListener("keydown", onKeydown)
    els.voiceInputBtn.removeEventListener("click", onClick)
  }

  els.voiceInputBtn.addEventListener("click", onClick)
  window.addEventListener("keydown", onKeydown)
  setState("disabled")
  postMessage({ type: "get_stt_settings" })

  return {
    applySettings,
    handleTranscript,
    handleError,
    setCurrentRequestId,
    getState: () => state,
    dispose,
  }
}
