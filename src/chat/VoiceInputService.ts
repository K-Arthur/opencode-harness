/**
 * Host-side orchestrator for native voice input.
 *
 * Owns the record → transcribe lifecycle and the webview message protocol.
 * It depends only on the injected {@link Recorder} / {@link Transcriber}
 * abstractions (real ones from `voiceCapture.ts`, mocks in tests), so the
 * whole flow is unit-testable without a microphone.
 *
 * Webview → host:  voice_start, voice_stop, voice_cancel, get_voice_settings
 * host → webview:  voice_settings, voice_recording_started,
 *                  voice_transcribing, voice_transcript, voice_error
 *
 * Privacy: audio is written to a temp WAV, transcribed locally, and the file
 * is deleted afterward. No audio or transcript is persisted or sent anywhere.
 */
import {
  type VoiceInputRawConfig,
  type VoiceInputSettings,
  normalizeVoiceInputConfig,
  sanitizeVoiceTranscript,
} from "./voiceInputCore"
import type { Recorder, RecordingSession, Transcriber } from "./voiceCapture"

export type VoiceInputErrorReason =
  | "invalid_request"
  | "disabled"
  | "unavailable"
  | "record_failed"
  | "transcribe_failed"
  | "no_speech"

export interface VoiceInputServiceDeps {
  getRawConfig: () => VoiceInputRawConfig
  recorder: Recorder
  transcriber: Transcriber
  createTempAudioPath: () => string
  removeFile: (filePath: string) => Promise<void>
  postMessage: (msg: Record<string, unknown>) => void
  log?: (level: "info" | "warn" | "error", message: string, err?: unknown) => void
}

interface ActiveRecording {
  requestId: string
  session: RecordingSession
  outputPath: string
  settings: VoiceInputSettings
  maxTimer: ReturnType<typeof setTimeout> | undefined
  finalizing: boolean
}

/** Safety margin: the recorder self-limits, but back it with a host timer. */
const MAX_DURATION_SAFETY_MS = 2000

export class VoiceInputService {
  private active: ActiveRecording | null = null
  private readonly log: NonNullable<VoiceInputServiceDeps["log"]>

  constructor(private readonly deps: VoiceInputServiceDeps) {
    this.log = deps.log ?? (() => {})
  }

  /** Resolve settings plus current engine availability for the webview. */
  getSettings(): VoiceInputSettings {
    const settings = normalizeVoiceInputConfig(this.deps.getRawConfig())
    const recorderOk = this.deps.recorder.isAvailable()
    const transcriberOk = this.deps.transcriber.isAvailable()
    const available = recorderOk && transcriberOk
    let unavailableReason: string | undefined
    if (!available) {
      unavailableReason = !recorderOk
        ? "No microphone recorder found. Install sox (rec) or set opencode.voice.recordCommand."
        : "No local speech-to-text engine found. Install openai-whisper or set opencode.voice.localCommand."
    }
    return { ...settings, available, unavailableReason }
  }

  postSettings(): void {
    this.deps.postMessage({ type: "voice_settings", settings: this.getSettings() })
  }

  /** Begin recording for `requestId`. Idempotently discards any prior take. */
  async start(requestId: unknown): Promise<void> {
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 120) {
      this.postError(undefined, "invalid_request", "Missing voice request id.")
      return
    }
    const settings = normalizeVoiceInputConfig(this.deps.getRawConfig())
    if (!settings.enabled) {
      this.postError(requestId, "disabled", "Voice input is disabled in settings.")
      return
    }
    if (!this.deps.recorder.isAvailable() || !this.deps.transcriber.isAvailable()) {
      const { unavailableReason } = this.getSettings()
      this.postError(requestId, "unavailable", unavailableReason ?? "Voice input is unavailable in this environment.")
      return
    }

    // Rapid re-click: discard the in-flight take before starting a new one.
    if (this.active) this.discardActive()

    const outputPath = this.deps.createTempAudioPath()
    let session: RecordingSession
    try {
      session = this.deps.recorder.start({ outputPath, maxDurationSeconds: settings.maxRecordingSeconds })
    } catch (err) {
      this.log("error", "voice: failed to start recorder", err)
      void this.deps.removeFile(outputPath)
      this.postError(requestId, "record_failed", "Could not start the microphone recorder.")
      return
    }

    const maxTimer = setTimeout(() => {
      void this.finalize(requestId)
    }, settings.maxRecordingSeconds * 1000 + MAX_DURATION_SAFETY_MS)
    // Background safety net only — must not keep the host process alive on its own.
    ;(maxTimer as { unref?: () => void }).unref?.()
    const active: ActiveRecording = {
      requestId,
      session,
      outputPath,
      settings,
      maxTimer,
      finalizing: false,
    }
    this.active = active

    // The recorder may end on its own (max duration, or it died). Transcribe
    // what we have unless a stop/cancel already took over.
    session.finished
      .then(() => {
        if (this.active === active && !active.finalizing) void this.finalize(requestId)
      })
      .catch(() => {})

    this.deps.postMessage({ type: "voice_recording_started", requestId })
  }

  /** User pressed stop: finalize the active recording and transcribe it. */
  async stop(requestId: unknown): Promise<void> {
    if (!this.active || this.active.requestId !== requestId) return
    await this.finalize(this.active.requestId)
  }

  /** User cancelled: kill the recorder and drop the take silently. */
  cancel(requestId: unknown): void {
    const a = this.active
    if (!a || a.requestId !== requestId) return
    a.finalizing = true
    if (a.maxTimer) clearTimeout(a.maxTimer)
    a.session.cancel()
    void this.deps.removeFile(a.outputPath)
    this.active = null
  }

  dispose(): void {
    if (this.active) this.discardActive()
  }

  private discardActive(): void {
    const a = this.active
    if (!a) return
    a.finalizing = true
    if (a.maxTimer) clearTimeout(a.maxTimer)
    a.session.cancel()
    void this.deps.removeFile(a.outputPath)
    this.active = null
  }

  private async finalize(requestId: string): Promise<void> {
    const a = this.active
    if (!a || a.requestId !== requestId || a.finalizing) return
    a.finalizing = true
    if (a.maxTimer) clearTimeout(a.maxTimer)

    this.deps.postMessage({ type: "voice_transcribing", requestId })

    try {
      await a.session.stop()
    } catch (err) {
      this.log("warn", "voice: recorder stop failed", err)
    }

    let transcript = ""
    try {
      transcript = await this.deps.transcriber.transcribe({ inputPath: a.outputPath, language: a.settings.language })
    } catch (err) {
      this.log("error", "voice: transcription failed", err)
      await this.deps.removeFile(a.outputPath)
      this.active = null
      this.postError(requestId, "transcribe_failed", "Speech-to-text failed. See the OpenCode output channel for details.")
      return
    }

    await this.deps.removeFile(a.outputPath)
    this.active = null

    const clean = sanitizeVoiceTranscript(transcript)
    if (!clean) {
      this.postError(requestId, "no_speech", "No speech was detected. Try again closer to the microphone.")
      return
    }
    this.deps.postMessage({ type: "voice_transcript", requestId, text: clean })
  }

  private postError(requestId: string | undefined, reason: VoiceInputErrorReason, message: string): void {
    this.deps.postMessage({ type: "voice_error", requestId, reason, message })
  }
}
