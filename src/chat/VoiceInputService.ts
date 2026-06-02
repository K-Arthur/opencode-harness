import {
  VOICE_INPUT_SECRET_KEY,
  type VoiceAudioPayload,
  type VoiceInputRawConfig,
  type VoiceInputSettings,
  normalizeVoiceInputConfig,
  sanitizeVoiceTranscript,
  validateVoiceAudioPayload,
} from "./voiceInputCore"

type VoiceInputErrorReason =
  | "provider_disabled"
  | "missing_api_key"
  | "invalid_audio"
  | "transcription_failed"
  | "empty_transcript"

interface SecretStorageLike {
  get(key: string): PromiseLike<string | undefined>
  store?(key: string, value: string): PromiseLike<void>
  delete?(key: string): PromiseLike<void>
}

interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type FetchLike = (input: string, init: {
  method: "POST"
  headers: Record<string, string>
  body: FormData
}) => Promise<FetchResponseLike>

export interface VoiceInputServiceDeps {
  getRawConfig: () => VoiceInputRawConfig
  secrets: SecretStorageLike
  postMessage: (msg: Record<string, unknown>) => void
  fetch?: FetchLike
}

export class VoiceInputService {
  constructor(private readonly deps: VoiceInputServiceDeps) {}

  async getSettings(): Promise<VoiceInputSettings> {
    const settings = normalizeVoiceInputConfig(this.deps.getRawConfig())
    const key = await this.deps.secrets.get(VOICE_INPUT_SECRET_KEY)
    return { ...settings, hasOpenAiApiKey: Boolean(key && key.trim()) }
  }

  async postSettings(): Promise<void> {
    this.deps.postMessage({ type: "stt_settings", settings: await this.getSettings() })
  }

  async setOpenAiApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed || !this.deps.secrets.store) return
    await this.deps.secrets.store(VOICE_INPUT_SECRET_KEY, trimmed)
    await this.postSettings()
  }

  async clearOpenAiApiKey(): Promise<void> {
    if (!this.deps.secrets.delete) return
    await this.deps.secrets.delete(VOICE_INPUT_SECRET_KEY)
    await this.postSettings()
  }

  async transcribeAudio(payload: VoiceAudioPayload): Promise<void> {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined
    const settings = normalizeVoiceInputConfig(this.deps.getRawConfig())
    if (!settings.enabled || settings.provider !== "openai") {
      this.postError(requestId, "provider_disabled", "Cloud speech-to-text is not enabled.")
      return
    }

    const validation = validateVoiceAudioPayload(payload, settings.maxUploadBytes)
    if (!validation.ok) {
      this.postError(requestId, "invalid_audio", validation.message)
      return
    }

    const apiKey = await this.deps.secrets.get(VOICE_INPUT_SECRET_KEY)
    if (!apiKey || !apiKey.trim()) {
      this.postError(requestId, "missing_api_key", "Speech-to-text requires an OpenAI API key.")
      return
    }

    try {
      const response = await this.fetchOpenAiTranscription({
        requestId: payload.requestId as string,
        data: payload.data as string,
        mimeType: validation.mimeType,
        extension: validation.extension,
        apiKey,
        model: settings.openaiModel,
      })
      const transcript = sanitizeVoiceTranscript(response)
      if (!transcript) {
        this.postError(requestId, "empty_transcript", "No speech was detected in the recording.")
        return
      }
      this.deps.postMessage({ type: "stt_transcript", requestId, text: transcript })
    } catch {
      this.postError(requestId, "transcription_failed", "Speech-to-text transcription failed.")
    }
  }

  private async fetchOpenAiTranscription(args: {
    requestId: string
    data: string
    mimeType: string
    extension: string
    apiKey: string
    model: string
  }): Promise<unknown> {
    const audio = Buffer.from(args.data, "base64")
    const form = new FormData()
    const blob = new Blob([audio], { type: args.mimeType })
    form.append("file", blob, `${args.requestId}.${args.extension}`)
    form.append("model", args.model)
    form.append("response_format", "json")

    const fetchImpl = this.deps.fetch ?? globalThis.fetch
    const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
    })
    if (!response.ok) {
      throw new Error(`OpenAI transcription failed with status ${response.status}`)
    }
    const json = await response.json()
    return typeof json === "object" && json && "text" in json
      ? (json as { text?: unknown }).text
      : ""
  }

  private postError(requestId: string | undefined, reason: VoiceInputErrorReason, message: string): void {
    this.deps.postMessage({
      type: "stt_error",
      requestId,
      reason,
      message,
    })
  }
}
