/**
 * Host-side audio capture + local transcription for native voice input.
 *
 * This is the ONLY voice module that touches Node (`child_process`, `fs`,
 * `os`). The webview cannot access the microphone (sandboxed iframe), so the
 * extension host records the default mic with a local CLI tool and transcribes
 * with a local speech-to-text engine. No cloud, no API keys, no audio leaves
 * the machine.
 *
 * Engine selection is "bring your own / auto-detect":
 *   - Recorder:    `rec` (sox, cross-platform) → `arecord` (Linux) → `ffmpeg`.
 *   - Transcriber: openai-whisper `whisper`, or whisper.cpp (`whisper-cli`/
 *                  `main`) when a model is configured.
 *   - Either can be fully overridden by a machine-scoped command template.
 *
 * If nothing is detected, both report unavailable and the UI degrades to a
 * clear "use OS dictation" message — it never silently fails.
 *
 * The pure selection helpers (`selectRecorderPlan`, `selectTranscriberPlan`)
 * are exported so they can be unit-tested with a fake `exists` predicate.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  applyCommandTemplate,
  buildArecordArgs,
  buildFfmpegRecordArgs,
  buildOpenAiWhisperArgs,
  buildSoxRecordArgs,
  buildWhisperCppArgs,
  pickTranscript,
  templateUsesOutput,
} from "./voiceInputCore"

/** Default transcription timeout. First whisper run may download a model. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_OPENAI_WHISPER_MODEL = "base"

export interface VoiceCaptureConfig {
  /** Override recorder command template; placeholders {output} {duration}. */
  recordCommand?: string
  /** Override transcriber command template; placeholders {input} {output} {language}. */
  localCommand?: string
  /** Model name/path for whisper engines (whisper.cpp requires it). */
  model?: string
}

export interface RecordingSession {
  /** Resolves once the recorder process has exited and the file is finalized. */
  readonly finished: Promise<void>
  /** Ask the recorder to stop gracefully and finalize the WAV file. */
  stop(): Promise<void>
  /** Kill the recorder and discard the recording. */
  cancel(): void
}

export interface Recorder {
  isAvailable(): boolean
  /** Spawns the recorder. Throws synchronously if it cannot start. */
  start(opts: { outputPath: string; maxDurationSeconds: number }): RecordingSession
  describe(): string
}

export interface Transcriber {
  isAvailable(): boolean
  transcribe(opts: { inputPath: string; language: string }): Promise<string>
  describe(): string
}

// ─── Pure plan selection (testable with a fake `exists`) ──────────────────

export type RecorderPlan =
  | { kind: "template"; template: string }
  | { kind: "sox"; bin: string }
  | { kind: "arecord"; bin: string }
  | { kind: "ffmpeg"; bin: string }

export type TranscriberPlan =
  | { kind: "template"; template: string }
  | { kind: "openai-whisper"; bin: string; model: string }
  | { kind: "whisper-cpp"; bin: string; model: string }

export function selectRecorderPlan(
  config: VoiceCaptureConfig,
  platform: NodeJS.Platform | string,
  exists: (bin: string) => boolean,
): RecorderPlan | null {
  if (config.recordCommand && config.recordCommand.trim()) {
    return { kind: "template", template: config.recordCommand.trim() }
  }
  if (exists("rec")) return { kind: "sox", bin: "rec" }
  if (platform === "linux" && exists("arecord")) return { kind: "arecord", bin: "arecord" }
  if (exists("ffmpeg") && buildFfmpegRecordArgs(platform, "x", 1) !== null) {
    return { kind: "ffmpeg", bin: "ffmpeg" }
  }
  return null
}

export function selectTranscriberPlan(
  config: VoiceCaptureConfig,
  exists: (bin: string) => boolean,
): TranscriberPlan | null {
  if (config.localCommand && config.localCommand.trim()) {
    return { kind: "template", template: config.localCommand.trim() }
  }
  const model = config.model && config.model.trim() ? config.model.trim() : ""
  if (model && exists("whisper-cli")) return { kind: "whisper-cpp", bin: "whisper-cli", model }
  if (model && exists("main")) return { kind: "whisper-cpp", bin: "main", model }
  if (exists("whisper")) {
    return { kind: "openai-whisper", bin: "whisper", model: model || DEFAULT_OPENAI_WHISPER_MODEL }
  }
  return null
}

export function describeRecorderPlan(plan: RecorderPlan): string {
  return plan.kind === "template" ? `custom (${plan.template.split(/\s+/)[0]})` : plan.bin
}

export function describeTranscriberPlan(plan: TranscriberPlan): string {
  if (plan.kind === "template") return `custom (${plan.template.split(/\s+/)[0]})`
  return `${plan.bin}${plan.model ? ` (${plan.model})` : ""}`
}

// ─── Real Node implementations ────────────────────────────────────────────

const existsCache = new Map<string, boolean>()

/** Best-effort check that a binary is resolvable on PATH. Cached. */
export function commandExists(bin: string): boolean {
  const cached = existsCache.get(bin)
  if (cached !== undefined) return cached
  let ok = false
  try {
    const probe = process.platform === "win32" ? "where" : "which"
    const result = spawnSync(probe, [bin], { stdio: "ignore", timeout: 3000 })
    ok = result.status === 0
  } catch {
    ok = false
  }
  existsCache.set(bin, ok)
  return ok
}

function buildRecorderArgs(plan: RecorderPlan, outputPath: string, maxDurationSeconds: number): { bin: string; args: string[] } {
  switch (plan.kind) {
    case "template": {
      const built = applyCommandTemplate(plan.template, { output: outputPath, duration: String(maxDurationSeconds) })
      if (!built) throw new Error("Empty recordCommand template")
      return built
    }
    case "sox":
      return { bin: plan.bin, args: buildSoxRecordArgs(outputPath, maxDurationSeconds) }
    case "arecord":
      return { bin: plan.bin, args: buildArecordArgs(outputPath, maxDurationSeconds) }
    case "ffmpeg": {
      const args = buildFfmpegRecordArgs(process.platform, outputPath, maxDurationSeconds)
      if (!args) throw new Error("ffmpeg microphone capture is not supported on this platform")
      return { bin: plan.bin, args }
    }
  }
}

export interface VoiceCaptureLogger {
  (level: "info" | "warn" | "error", message: string, err?: unknown): void
}

class CommandRecorder implements Recorder {
  constructor(
    private readonly getConfig: () => VoiceCaptureConfig,
    private readonly log: VoiceCaptureLogger,
  ) {}

  private plan(): RecorderPlan | null {
    return selectRecorderPlan(this.getConfig(), process.platform, commandExists)
  }

  isAvailable(): boolean {
    return this.plan() !== null
  }

  describe(): string {
    const plan = this.plan()
    return plan ? describeRecorderPlan(plan) : "none"
  }

  start(opts: { outputPath: string; maxDurationSeconds: number }): RecordingSession {
    const plan = this.plan()
    if (!plan) throw new Error("No microphone recorder is available")
    const { bin, args } = buildRecorderArgs(plan, opts.outputPath, opts.maxDurationSeconds)
    this.log("info", `voice: recording with ${bin}`)
    const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] })
    return new ProcessRecordingSession(child, plan.kind, this.log)
  }
}

class ProcessRecordingSession implements RecordingSession {
  readonly finished: Promise<void>
  private resolveFinished!: () => void
  private settled = false
  private cancelled = false

  constructor(
    private readonly child: ChildProcess,
    private readonly kind: RecorderPlan["kind"],
    private readonly log: VoiceCaptureLogger,
  ) {
    this.finished = new Promise<void>((resolve) => {
      this.resolveFinished = resolve
    })
    let stderr = ""
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    child.on("error", (err) => {
      this.log("error", `voice: recorder process error`, err)
      this.settle()
    })
    child.on("close", (code) => {
      // SIGINT-terminated recorders exit non-zero but still finalize the WAV.
      if (code && code !== 0 && code !== 130 && !this.cancelled) {
        this.log("warn", `voice: recorder exited with code ${code}: ${stderr.trim().slice(-300)}`)
      }
      this.settle()
    })
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    this.resolveFinished()
  }

  async stop(): Promise<void> {
    if (this.settled) return
    try {
      if (this.kind === "ffmpeg" && this.child.stdin && !this.child.stdin.destroyed) {
        // ffmpeg stops cleanly when it reads "q" on stdin.
        this.child.stdin.write("q\n")
      }
      // SIGINT lets sox/arecord/ffmpeg flush the WAV header and exit.
      this.child.kill("SIGINT")
    } catch (err) {
      this.log("warn", "voice: failed to signal recorder to stop", err)
    }
    await this.finished
  }

  cancel(): void {
    this.cancelled = true
    if (this.settled) return
    try {
      this.child.kill("SIGKILL")
    } catch {
      /* already gone */
    }
  }
}

class CommandTranscriber implements Transcriber {
  constructor(
    private readonly getConfig: () => VoiceCaptureConfig,
    private readonly log: VoiceCaptureLogger,
  ) {}

  private plan(): TranscriberPlan | null {
    return selectTranscriberPlan(this.getConfig(), commandExists)
  }

  isAvailable(): boolean {
    return this.plan() !== null
  }

  describe(): string {
    const plan = this.plan()
    return plan ? describeTranscriberPlan(plan) : "none"
  }

  async transcribe(opts: { inputPath: string; language: string }): Promise<string> {
    const plan = this.plan()
    if (!plan) throw new Error("No local speech-to-text engine is available")
    const tmpDir = path.dirname(opts.inputPath)
    const baseNoExt = path.join(tmpDir, path.basename(opts.inputPath, path.extname(opts.inputPath)))

    let bin: string
    let args: string[]
    let sidecar: string | null = null

    switch (plan.kind) {
      case "template": {
        const outFile = `${baseNoExt}.txt`
        const built = applyCommandTemplate(plan.template, {
          input: opts.inputPath,
          output: outFile,
          language: opts.language,
        })
        if (!built) throw new Error("Empty localCommand template")
        bin = built.bin
        args = built.args
        sidecar = templateUsesOutput(plan.template) ? outFile : null
        break
      }
      case "openai-whisper": {
        bin = plan.bin
        args = buildOpenAiWhisperArgs({ input: opts.inputPath, outputDir: tmpDir, model: plan.model, language: opts.language })
        sidecar = `${baseNoExt}.txt`
        break
      }
      case "whisper-cpp": {
        bin = plan.bin
        args = buildWhisperCppArgs({ input: opts.inputPath, outputBase: baseNoExt, model: plan.model, language: opts.language })
        sidecar = `${baseNoExt}.txt`
        break
      }
    }

    this.log("info", `voice: transcribing with ${bin}`)
    const { stdout } = await runProcess(bin, args, TRANSCRIBE_TIMEOUT_MS)

    let fileText: string | null = null
    if (sidecar) {
      try {
        fileText = await fs.promises.readFile(sidecar, "utf8")
      } catch {
        fileText = null
      } finally {
        void fs.promises.unlink(sidecar).catch(() => {})
      }
    }
    return pickTranscript(fileText, stdout)
  }
}

function runProcess(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      reject(new Error(`${bin} timed out`))
    }, timeoutMs)
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code && code !== 0) {
        reject(new Error(`${bin} exited with code ${code}: ${stderr.trim().slice(-300)}`))
        return
      }
      resolve({ stdout, code })
    })
  })
}

export interface DefaultVoiceCapture {
  recorder: Recorder
  transcriber: Transcriber
  createTempAudioPath: () => string
  removeFile: (filePath: string) => Promise<void>
}

/**
 * Wire up the real Node-backed recorder + transcriber. `getConfig` reads the
 * machine-scoped override settings; the rest auto-detect from PATH.
 */
export function createDefaultVoiceCapture(getConfig: () => VoiceCaptureConfig, log: VoiceCaptureLogger): DefaultVoiceCapture {
  return {
    recorder: new CommandRecorder(getConfig, log),
    transcriber: new CommandTranscriber(getConfig, log),
    createTempAudioPath: () => path.join(os.tmpdir(), `opencode-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`),
    removeFile: async (filePath: string) => {
      try {
        await fs.promises.unlink(filePath)
      } catch {
        /* best effort */
      }
    },
  }
}
