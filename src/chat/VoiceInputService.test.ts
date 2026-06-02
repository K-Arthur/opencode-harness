import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { VoiceInputService } from "./VoiceInputService"

function audioPayload() {
  return {
    requestId: "voice-1",
    mimeType: "audio/webm;codecs=opus",
    data: Buffer.from("audio").toString("base64"),
    sizeBytes: 5,
  }
}

void describe("VoiceInputService", () => {
  void it("returns provider-disabled error without uploading audio", async () => {
    const posted: Record<string, unknown>[] = []
    let fetchCalled = false
    const service = new VoiceInputService({
      getRawConfig: () => ({ enabled: false, provider: "openai" }),
      secrets: { get: async () => "secret" },
      postMessage: (msg) => posted.push(msg),
      fetch: async () => {
        fetchCalled = true
        throw new Error("should not upload")
      },
    })

    await service.transcribeAudio(audioPayload())

    assert.equal(fetchCalled, false)
    assert.equal(posted[0]?.type, "stt_error")
    assert.equal(posted[0]?.reason, "provider_disabled")
    assert.equal(posted[0]?.requestId, "voice-1")
  })

  void it("returns missing-api-key error without uploading audio", async () => {
    const posted: Record<string, unknown>[] = []
    let fetchCalled = false
    const service = new VoiceInputService({
      getRawConfig: () => ({ enabled: true, provider: "openai" }),
      secrets: { get: async () => undefined },
      postMessage: (msg) => posted.push(msg),
      fetch: async () => {
        fetchCalled = true
        throw new Error("should not upload")
      },
    })

    await service.transcribeAudio(audioPayload())

    assert.equal(fetchCalled, false)
    assert.equal(posted[0]?.type, "stt_error")
    assert.equal(posted[0]?.reason, "missing_api_key")
  })

  void it("posts sanitized transcripts from the OpenAI response", async () => {
    const posted: Record<string, unknown>[] = []
    const service = new VoiceInputService({
      getRawConfig: () => ({ enabled: true, provider: "openai", openaiModel: "gpt-4o-mini-transcribe" }),
      secrets: { get: async () => "secret" },
      postMessage: (msg) => posted.push(msg),
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ text: "  hello\u0000\nthere  " }),
      }),
    })

    await service.transcribeAudio(audioPayload())

    assert.equal(posted[0]?.type, "stt_transcript")
    assert.equal(posted[0]?.requestId, "voice-1")
    assert.equal(posted[0]?.text, "hello there")
  })
})
