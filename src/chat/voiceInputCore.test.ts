import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  estimateBase64Bytes,
  isStaleVoiceRequest,
  normalizeVoiceInputConfig,
  sanitizeVoiceTranscript,
  transitionVoiceInputState,
  validateVoiceAudioPayload,
} from "./voiceInputCore"

void describe("voice input core", () => {
  void it("normalizes settings with privacy-safe defaults and hard caps", () => {
    const settings = normalizeVoiceInputConfig({
      enabled: "yes",
      provider: "openai",
      maxDurationSeconds: 999,
      maxUploadBytes: 100 * 1024 * 1024,
      openaiModel: "",
    })

    assert.equal(settings.enabled, true)
    assert.equal(settings.provider, "openai")
    assert.equal(settings.maxDurationSeconds, 300)
    assert.equal(settings.maxUploadBytes, 25 * 1024 * 1024)
    assert.equal(settings.openaiModel, "gpt-4o-mini-transcribe")
  })

  void it("accepts supported audio mime types with codec parameters", () => {
    const data = Buffer.from("audio").toString("base64")
    const result = validateVoiceAudioPayload({
      requestId: "voice-1",
      mimeType: "audio/webm;codecs=opus",
      data,
    }, 1024)

    assert.equal(result.ok, true)
    assert.equal(result.bytes, 5)
    assert.equal(result.extension, "webm")
  })

  void it("rejects unsupported mime types and oversized base64 payloads", () => {
    const textPayload = validateVoiceAudioPayload({
      requestId: "voice-1",
      mimeType: "text/plain",
      data: Buffer.from("hello").toString("base64"),
    }, 1024)
    assert.equal(textPayload.ok, false)
    assert.equal(textPayload.reason, "unsupported_mime")

    const oversized = validateVoiceAudioPayload({
      requestId: "voice-1",
      mimeType: "audio/webm",
      data: Buffer.alloc(8).toString("base64"),
    }, 4)
    assert.equal(oversized.ok, false)
    assert.equal(oversized.reason, "too_large")
  })

  void it("sanitizes transcripts without preserving control characters", () => {
    assert.equal(
      sanitizeVoiceTranscript("  hello\u0000\n\tthere   world  "),
      "hello there world",
    )
  })

  void it("detects stale request ids before inserting a transcript", () => {
    assert.equal(isStaleVoiceRequest("voice-new", "voice-old"), true)
    assert.equal(isStaleVoiceRequest("voice-new", "voice-new"), false)
  })

  void it("keeps state transitions deterministic", () => {
    assert.equal(transitionVoiceInputState("idle", "start"), "requesting-permission")
    assert.equal(transitionVoiceInputState("requesting-permission", "permission-granted"), "recording")
    assert.equal(transitionVoiceInputState("recording", "stop"), "stopping")
    assert.equal(transitionVoiceInputState("stopping", "upload"), "transcribing")
    assert.equal(transitionVoiceInputState("transcribing", "transcript"), "inserted")
    assert.equal(transitionVoiceInputState("recording", "error"), "error")
    assert.equal(transitionVoiceInputState("inserted", "reset"), "idle")
    assert.equal(transitionVoiceInputState("recording", "start"), "recording")
  })

  void it("estimates base64 bytes for padded and unpadded strings", () => {
    assert.equal(estimateBase64Bytes("YQ=="), 1)
    assert.equal(estimateBase64Bytes("YXVkaW8="), 5)
  })
})
