export type VoiceInputProvider = "browser" | "openai"

export type VoiceInputState =
  | "disabled"
  | "idle"
  | "requesting-permission"
  | "recording"
  | "stopping"
  | "transcribing"
  | "inserted"
  | "error"

export type VoiceInputEvent =
  | "enable"
  | "disable"
  | "start"
  | "permission-granted"
  | "stop"
  | "upload"
  | "transcript"
  | "error"
  | "reset"

export interface VoiceInputRawConfig {
  enabled?: unknown
  provider?: unknown
  maxDurationSeconds?: unknown
  maxUploadBytes?: unknown
  openaiModel?: unknown
}

export interface VoiceInputSettings {
  enabled: boolean
  provider: VoiceInputProvider
  maxDurationSeconds: number
  maxUploadBytes: number
  openaiModel: string
  hasOpenAiApiKey?: boolean
}

export type VoiceAudioValidationReason =
  | "invalid_request"
  | "invalid_mime"
  | "unsupported_mime"
  | "invalid_base64"
  | "too_large"

export type VoiceAudioValidationResult =
  | { ok: true; bytes: number; mimeType: string; extension: string }
  | { ok: false; reason: VoiceAudioValidationReason; message: string }

export interface VoiceAudioPayload {
  requestId: unknown
  mimeType: unknown
  data: unknown
  sizeBytes?: unknown
}

export const VOICE_INPUT_DEFAULT_MODEL = "gpt-4o-mini-transcribe"
export const VOICE_INPUT_SECRET_KEY = "opencode.voiceInput.openaiApiKey"
export const VOICE_INPUT_DEFAULT_DURATION_SECONDS = 60
export const VOICE_INPUT_MAX_DURATION_SECONDS = 300
export const VOICE_INPUT_DEFAULT_UPLOAD_BYTES = 10 * 1024 * 1024
export const VOICE_INPUT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const VOICE_INPUT_MIN_UPLOAD_BYTES = 1024
export const VOICE_INPUT_MAX_TRANSCRIPT_CHARS = 20_000

const MIME_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mpga",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeVoiceInputConfig(raw: VoiceInputRawConfig = {}): VoiceInputSettings {
  const provider = raw.provider === "openai" ? "openai" : "browser"
  const model = typeof raw.openaiModel === "string" && raw.openaiModel.trim().length > 0 && raw.openaiModel.length <= 120
    ? raw.openaiModel.trim()
    : VOICE_INPUT_DEFAULT_MODEL

  return {
    enabled: raw.enabled !== false,
    provider,
    maxDurationSeconds: clampInt(raw.maxDurationSeconds, VOICE_INPUT_DEFAULT_DURATION_SECONDS, 1, VOICE_INPUT_MAX_DURATION_SECONDS),
    maxUploadBytes: clampInt(raw.maxUploadBytes, VOICE_INPUT_DEFAULT_UPLOAD_BYTES, VOICE_INPUT_MIN_UPLOAD_BYTES, VOICE_INPUT_MAX_UPLOAD_BYTES),
    openaiModel: model,
  }
}

export function normalizeVoiceMimeType(mimeType: unknown): string | null {
  if (typeof mimeType !== "string") return null
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase()
  return normalized || null
}

export function getVoiceAudioExtension(mimeType: string): string | undefined {
  return MIME_EXTENSION[mimeType]
}

export function estimateBase64Bytes(data: string): number {
  const normalized = data.trim()
  if (normalized.length === 0) return 0
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

export function validateVoiceAudioPayload(payload: VoiceAudioPayload, maxBytes = VOICE_INPUT_MAX_UPLOAD_BYTES): VoiceAudioValidationResult {
  if (typeof payload.requestId !== "string" || payload.requestId.trim().length === 0 || payload.requestId.length > 120) {
    return { ok: false, reason: "invalid_request", message: "Missing speech-to-text request id." }
  }

  const normalizedMime = normalizeVoiceMimeType(payload.mimeType)
  if (!normalizedMime) {
    return { ok: false, reason: "invalid_mime", message: "Missing audio MIME type." }
  }

  const extension = getVoiceAudioExtension(normalizedMime)
  if (!extension) {
    return { ok: false, reason: "unsupported_mime", message: "Unsupported audio format." }
  }

  if (typeof payload.data !== "string" || payload.data.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data)) {
    return { ok: false, reason: "invalid_base64", message: "Invalid audio payload." }
  }

  const estimatedBytes = estimateBase64Bytes(payload.data)
  const declaredBytes = typeof payload.sizeBytes === "number" && Number.isFinite(payload.sizeBytes) && payload.sizeBytes >= 0
    ? Math.ceil(payload.sizeBytes)
    : estimatedBytes
  const bytes = Math.max(estimatedBytes, declaredBytes)
  if (bytes > maxBytes) {
    return { ok: false, reason: "too_large", message: "Audio recording is too large." }
  }

  return { ok: true, bytes, mimeType: normalizedMime, extension }
}

export function sanitizeVoiceTranscript(text: unknown): string {
  if (typeof text !== "string") return ""
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_INPUT_MAX_TRANSCRIPT_CHARS)
}

export function isStaleVoiceRequest(currentRequestId: string | null | undefined, incomingRequestId: unknown): boolean {
  return typeof incomingRequestId !== "string" || !currentRequestId || incomingRequestId !== currentRequestId
}

export function transitionVoiceInputState(current: VoiceInputState, event: VoiceInputEvent): VoiceInputState {
  if (event === "disable") return "disabled"
  if (event === "error") return "error"
  if (event === "reset") return current === "disabled" ? "disabled" : "idle"
  if (current === "disabled") return event === "enable" ? "idle" : "disabled"

  switch (current) {
    case "idle":
    case "inserted":
    case "error":
      return event === "start" ? "requesting-permission" : current
    case "requesting-permission":
      if (event === "permission-granted") return "recording"
      if (event === "stop") return "idle"
      return current
    case "recording":
      return event === "stop" ? "stopping" : current
    case "stopping":
      if (event === "upload") return "transcribing"
      if (event === "transcript") return "inserted"
      return current
    case "transcribing":
      return event === "transcript" ? "inserted" : current
    default:
      return current
  }
}
