/**
 * Pure, dependency-free core for native voice input (speech-to-text).
 *
 * Architecture (see ADR-013): the VS Code webview CANNOT capture the
 * microphone — it is a sandboxed iframe without `allow="microphone"`, and
 * `SpeechRecognition` fails in Electron. So all audio capture and
 * transcription happen in the extension host using local OS tools. This
 * module holds only the pure logic shared by the host orchestrator and the
 * webview UI: settings normalization, the UI state machine, transcript
 * sanitization, and pure builders for the recorder / transcriber commands.
 *
 * Nothing here touches Node, VS Code, or the DOM, so it is exhaustively
 * unit-testable.
 */

export type VoiceInsertMode = "append" | "replace"

/**
 * Webview-facing UI state. The host drives transitions via messages; the
 * webview never owns the microphone.
 */
export type VoiceInputState =
  | "disabled" // feature off, or no local engine available
  | "idle" // ready to record
  | "starting" // host asked to start the recorder; awaiting confirmation
  | "recording" // recorder is live
  | "transcribing" // recording stopped; local engine is running
  | "inserted" // transcript placed into the prompt (transient)
  | "error" // last attempt failed

export type VoiceInputEvent =
  | "enable"
  | "disable"
  | "start"
  | "recording-started"
  | "stop"
  | "transcript"
  | "error"
  | "reset"

export interface VoiceInputRawConfig {
  enabled?: unknown
  autoSend?: unknown
  language?: unknown
  insertMode?: unknown
  maxRecordingSeconds?: unknown
}

export interface VoiceInputSettings {
  enabled: boolean
  autoSend: boolean
  /** BCP-47 tag (e.g. "en-US") or "auto" to let the engine detect. */
  language: string
  insertMode: VoiceInsertMode
  maxRecordingSeconds: number
  /** Runtime-only: set by the host once engine availability is known. */
  available?: boolean
  /** Runtime-only: human-readable reason when `available` is false. */
  unavailableReason?: string
}

export const VOICE_DEFAULT_MAX_DURATION_SECONDS = 60
export const VOICE_MIN_DURATION_SECONDS = 1
export const VOICE_MAX_DURATION_SECONDS = 300
export const VOICE_MAX_TRANSCRIPT_CHARS = 20_000
export const VOICE_DEFAULT_LANGUAGE = "auto"

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeVoiceInputConfig(raw: VoiceInputRawConfig = {}): VoiceInputSettings {
  const language =
    typeof raw.language === "string" && raw.language.trim().length > 0 && raw.language.length <= 35
      ? raw.language.trim()
      : VOICE_DEFAULT_LANGUAGE
  return {
    enabled: raw.enabled !== false,
    autoSend: raw.autoSend === true,
    language,
    insertMode: raw.insertMode === "replace" ? "replace" : "append",
    maxRecordingSeconds: clampInt(
      raw.maxRecordingSeconds,
      VOICE_DEFAULT_MAX_DURATION_SECONDS,
      VOICE_MIN_DURATION_SECONDS,
      VOICE_MAX_DURATION_SECONDS,
    ),
  }
}

/**
 * Collapse whitespace and strip control characters from a transcript, then
 * cap its length. Returns "" for non-strings or empty input.
 */
export function sanitizeVoiceTranscript(text: unknown): string {
  if (typeof text !== "string") return ""
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_MAX_TRANSCRIPT_CHARS)
}

/**
 * A voice message is stale if it carries no request id, there is no active
 * request, or the ids do not match. Guards against late callbacks from a
 * cancelled/superseded recording landing in the prompt.
 */
export function isStaleVoiceRequest(
  currentRequestId: string | null | undefined,
  incomingRequestId: unknown,
): boolean {
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
      return event === "start" ? "starting" : current
    case "starting":
      if (event === "recording-started") return "recording"
      if (event === "stop") return "idle" // user bailed before capture began
      return current
    case "recording":
      return event === "stop" ? "transcribing" : current
    case "transcribing":
      return event === "transcript" ? "inserted" : current
    default:
      return current
  }
}

// ─── Pure command builders (host capture pipeline) ────────────────────────
//
// Audio is always captured to a 16 kHz mono WAV — the format every local
// engine (whisper.cpp, openai-whisper, vosk) accepts without conversion.

export type RecorderKind = "sox" | "arecord" | "ffmpeg"

/** sox `rec` — uses the default input device on macOS/Linux/Windows. */
export function buildSoxRecordArgs(outputPath: string, maxDurationSeconds: number): string[] {
  return [
    "-q",
    "-c",
    "1",
    "-r",
    "16000",
    "-b",
    "16",
    "-e",
    "signed-integer",
    outputPath,
    "trim",
    "0",
    String(maxDurationSeconds),
  ]
}

/** ALSA `arecord` — Linux only. */
export function buildArecordArgs(outputPath: string, maxDurationSeconds: number): string[] {
  return ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", String(maxDurationSeconds), outputPath]
}

/**
 * ffmpeg capture of the default microphone. Input flags are platform
 * specific; returns null where we cannot pick a reliable default device
 * (Windows dshow needs an explicit device name).
 */
export function buildFfmpegRecordArgs(
  platform: NodeJS.Platform | string,
  outputPath: string,
  maxDurationSeconds: number,
): string[] | null {
  const tail = ["-ac", "1", "-ar", "16000", "-t", String(maxDurationSeconds), "-y", outputPath]
  if (platform === "darwin") return ["-f", "avfoundation", "-i", ":default", ...tail]
  if (platform === "linux") return ["-f", "alsa", "-i", "default", ...tail]
  return null
}

/**
 * Tokenize a user-supplied command template into argv, honoring double
 * quotes so paths with spaces survive. Empty/whitespace input → [].
 */
export function tokenizeCommandTemplate(template: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : (match[2] ?? ""))
  }
  return tokens
}

export interface CommandTemplateVars {
  input?: string
  output?: string
  language?: string
  duration?: string
}

/**
 * Substitute `{input}`, `{output}`, `{language}`, `{duration}` placeholders
 * inside each token of a tokenized template. Unknown placeholders are left
 * as-is. Returns null if the template is empty after tokenizing.
 */
export function applyCommandTemplate(template: string, vars: CommandTemplateVars): { bin: string; args: string[] } | null {
  const tokens = tokenizeCommandTemplate(template)
  if (tokens.length === 0) return null
  const substitute = (token: string): string =>
    token
      .replace(/\{input\}/g, vars.input ?? "")
      .replace(/\{output\}/g, vars.output ?? "")
      .replace(/\{language\}/g, vars.language ?? "")
      .replace(/\{duration\}/g, vars.duration ?? "")
  const substituted = tokens.map(substitute)
  const bin = substituted[0] ?? ""
  return { bin, args: substituted.slice(1) }
}

/** True when a template references the {output} placeholder. */
export function templateUsesOutput(template: string): boolean {
  return /\{output\}/.test(template)
}

/**
 * openai-whisper CLI. Writes `<outputDir>/<inputBasename>.txt`; the caller
 * reads that file. Language is omitted when "auto" so whisper auto-detects.
 */
export function buildOpenAiWhisperArgs(opts: {
  input: string
  outputDir: string
  model: string
  language: string
}): string[] {
  const args = [
    opts.input,
    "--model",
    opts.model,
    "--output_format",
    "txt",
    "--output_dir",
    opts.outputDir,
    "--task",
    "transcribe",
    "--fp16",
    "False",
  ]
  if (opts.language && opts.language !== "auto") args.push("--language", opts.language)
  return args
}

/**
 * whisper.cpp CLI (`whisper-cli` / legacy `main`). Requires a model file.
 * Writes `<outputBase>.txt` via `-otxt -of`.
 */
export function buildWhisperCppArgs(opts: {
  input: string
  outputBase: string
  model: string
  language: string
}): string[] {
  const args = ["-m", opts.model, "-f", opts.input, "-otxt", "-of", opts.outputBase, "-nt"]
  if (opts.language && opts.language !== "auto") args.push("-l", opts.language)
  return args
}

/**
 * Pick the transcript text given an optional sidecar file (preferred) and
 * the process stdout (fallback), then sanitize.
 */
export function pickTranscript(fileText: string | null | undefined, stdoutText: string | null | undefined): string {
  const fromFile = sanitizeVoiceTranscript(fileText)
  if (fromFile) return fromFile
  return sanitizeVoiceTranscript(stdoutText)
}
