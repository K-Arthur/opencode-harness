import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { VoiceInputService } from "./VoiceInputService"
import type { Recorder, RecordingSession, Transcriber } from "./voiceCapture"

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r))
}

class MockSession implements RecordingSession {
  readonly finished: Promise<void>
  private resolve!: () => void
  stopped = false
  cancelled = false
  constructor() {
    this.finished = new Promise<void>((r) => {
      this.resolve = r
    })
  }
  async stop(): Promise<void> {
    this.stopped = true
    this.resolve()
  }
  cancel(): void {
    this.cancelled = true
    this.resolve()
  }
  /** Simulate the recorder exiting on its own (e.g. max duration). */
  endOnItsOwn(): void {
    this.resolve()
  }
}

class MockRecorder implements Recorder {
  available = true
  startError: Error | null = null
  sessions: MockSession[] = []
  isAvailable(): boolean {
    return this.available
  }
  describe(): string {
    return "mock-recorder"
  }
  start(): RecordingSession {
    if (this.startError) throw this.startError
    const s = new MockSession()
    this.sessions.push(s)
    return s
  }
}

class MockTranscriber implements Transcriber {
  available = true
  result = "hello world"
  error: Error | null = null
  calls: Array<{ inputPath: string; language: string }> = []
  isAvailable(): boolean {
    return this.available
  }
  describe(): string {
    return "mock-transcriber"
  }
  async transcribe(opts: { inputPath: string; language: string }): Promise<string> {
    this.calls.push(opts)
    if (this.error) throw this.error
    return this.result
  }
}

function makeService(overrides: {
  rawConfig?: Record<string, unknown>
  recorder?: MockRecorder
  transcriber?: MockTranscriber
} = {}) {
  const posted: Record<string, unknown>[] = []
  const removed: string[] = []
  const recorder = overrides.recorder ?? new MockRecorder()
  const transcriber = overrides.transcriber ?? new MockTranscriber()
  let counter = 0
  const service = new VoiceInputService({
    getRawConfig: () => overrides.rawConfig ?? { enabled: true },
    recorder,
    transcriber,
    createTempAudioPath: () => `/tmp/voice-${++counter}.wav`,
    removeFile: async (p) => {
      removed.push(p)
    },
    postMessage: (msg) => posted.push(msg),
  })
  return { service, posted, removed, recorder, transcriber }
}

void describe("VoiceInputService", () => {
  void it("runs the full record → transcribe → insert flow locally", async () => {
    const { service, posted, removed, transcriber } = makeService()

    await service.start("voice-1")
    assert.equal(posted.at(-1)?.type, "voice_recording_started")
    assert.equal(posted.at(-1)?.requestId, "voice-1")

    await service.stop("voice-1")
    assert.equal(posted.some((m) => m.type === "voice_transcribing"), true)
    const transcript = posted.find((m) => m.type === "voice_transcript")
    assert.equal(transcript?.text, "hello world")
    assert.equal(transcript?.requestId, "voice-1")
    assert.equal(transcriber.calls[0]?.inputPath, "/tmp/voice-1.wav")
    assert.deepEqual(removed, ["/tmp/voice-1.wav"]) // temp audio cleaned up
  })

  void it("passes the configured language to the transcriber", async () => {
    const { service, transcriber } = makeService({ rawConfig: { enabled: true, language: "es" } })
    await service.start("v")
    await service.stop("v")
    assert.equal(transcriber.calls[0]?.language, "es")
  })

  void it("refuses to record when disabled in settings", async () => {
    const { service, posted, recorder } = makeService({ rawConfig: { enabled: false } })
    await service.start("voice-1")
    assert.equal(posted[0]?.type, "voice_error")
    assert.equal(posted[0]?.reason, "disabled")
    assert.equal(recorder.sessions.length, 0)
  })

  void it("reports unavailable when no recorder is present", async () => {
    const recorder = new MockRecorder()
    recorder.available = false
    const { service, posted } = makeService({ recorder })
    await service.start("voice-1")
    assert.equal(posted[0]?.type, "voice_error")
    assert.equal(posted[0]?.reason, "unavailable")
    assert.match(String(posted[0]?.message), /recorder/i)
  })

  void it("reports unavailable when no transcription engine is present", async () => {
    const transcriber = new MockTranscriber()
    transcriber.available = false
    const { service, posted } = makeService({ transcriber })
    await service.start("voice-1")
    assert.equal(posted[0]?.reason, "unavailable")
    assert.match(String(posted[0]?.message), /speech-to-text/i)
  })

  void it("rejects an empty/invalid request id", async () => {
    const { service, posted } = makeService()
    await service.start("")
    assert.equal(posted[0]?.reason, "invalid_request")
  })

  void it("emits no_speech when the transcript is empty", async () => {
    const transcriber = new MockTranscriber()
    transcriber.result = "   "
    const { service, posted, removed } = makeService({ transcriber })
    await service.start("voice-1")
    await service.stop("voice-1")
    const err = posted.find((m) => m.type === "voice_error")
    assert.equal(err?.reason, "no_speech")
    assert.deepEqual(removed, ["/tmp/voice-1.wav"]) // still cleaned up
  })

  void it("emits transcribe_failed and cleans up when the engine throws", async () => {
    const transcriber = new MockTranscriber()
    transcriber.error = new Error("engine boom")
    const { service, posted, removed } = makeService({ transcriber })
    await service.start("voice-1")
    await service.stop("voice-1")
    const err = posted.find((m) => m.type === "voice_error")
    assert.equal(err?.reason, "transcribe_failed")
    assert.deepEqual(removed, ["/tmp/voice-1.wav"])
  })

  void it("emits record_failed when the recorder cannot start", async () => {
    const recorder = new MockRecorder()
    recorder.startError = new Error("no device")
    const { service, posted, removed } = makeService({ recorder })
    await service.start("voice-1")
    assert.equal(posted[0]?.reason, "record_failed")
    assert.deepEqual(removed, ["/tmp/voice-1.wav"]) // discards the temp path
  })

  void it("cancels the recording without transcribing", async () => {
    const { service, posted, removed, recorder, transcriber } = makeService()
    await service.start("voice-1")
    service.cancel("voice-1")
    await flush()
    assert.equal(recorder.sessions[0]?.cancelled, true)
    assert.equal(transcriber.calls.length, 0)
    assert.equal(posted.some((m) => m.type === "voice_transcript"), false)
    assert.deepEqual(removed, ["/tmp/voice-1.wav"])
  })

  void it("auto-finalizes when the recorder ends on its own (max duration)", async () => {
    const { service, posted, recorder } = makeService()
    await service.start("voice-1")
    recorder.sessions[0]?.endOnItsOwn()
    await flush()
    const transcript = posted.find((m) => m.type === "voice_transcript")
    assert.equal(transcript?.text, "hello world")
  })

  void it("ignores stop for a stale/unknown request id", async () => {
    const { service, posted } = makeService()
    await service.start("voice-1")
    await service.stop("voice-OTHER")
    assert.equal(posted.some((m) => m.type === "voice_transcript"), false)
    await service.stop("voice-1") // the real one still works
    assert.equal(posted.some((m) => m.type === "voice_transcript"), true)
  })

  void it("discards an in-flight take when a new recording starts", async () => {
    const { service, recorder } = makeService()
    await service.start("voice-1")
    await service.start("voice-2")
    assert.equal(recorder.sessions[0]?.cancelled, true)
    assert.equal(recorder.sessions.length, 2)
    service.dispose() // release the still-active second take
  })

  void it("exposes availability and reason via getSettings", () => {
    const recorder = new MockRecorder()
    const transcriber = new MockTranscriber()
    const { service } = makeService({ recorder, transcriber })
    assert.equal(service.getSettings().available, true)

    recorder.available = false
    assert.equal(service.getSettings().available, false)
    assert.match(String(service.getSettings().unavailableReason), /recorder/i)
  })

  void it("posts voice_settings with the resolved settings", () => {
    const { service, posted } = makeService({ rawConfig: { enabled: true, autoSend: true } })
    service.postSettings()
    assert.equal(posted[0]?.type, "voice_settings")
    assert.equal((posted[0]?.settings as { autoSend?: boolean })?.autoSend, true)
  })
})
