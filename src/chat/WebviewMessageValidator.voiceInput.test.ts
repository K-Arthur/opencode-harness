import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { validateWebviewMessage } from "./WebviewMessageValidator"

function validate(msg: Record<string, unknown>): { ok: boolean; warnings: string[] } {
  const warnings: string[] = []
  return {
    ok: validateWebviewMessage(msg, String(msg.type), {
      hasPromptContent: () => true,
      isValidThemeConfigPayload: () => true,
      warn: (message) => warnings.push(message),
    }),
    warnings,
  }
}

void describe("WebviewMessageValidator voice input", () => {
  void it("accepts bounded speech-to-text audio payloads", () => {
    const result = validate({
      type: "stt_transcribe_audio",
      requestId: "voice-1",
      mimeType: "audio/webm;codecs=opus",
      data: Buffer.from("audio").toString("base64"),
      durationMs: 1200,
      sizeBytes: 5,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings, [])
  })

  void it("rejects invalid speech-to-text mime and oversized payloads", () => {
    const invalidMime = validate({
      type: "stt_transcribe_audio",
      requestId: "voice-1",
      mimeType: "text/html",
      data: Buffer.from("audio").toString("base64"),
    })
    assert.equal(invalidMime.ok, false)

    const oversized = validate({
      type: "stt_transcribe_audio",
      requestId: "voice-1",
      mimeType: "audio/webm",
      data: Buffer.alloc(26 * 1024 * 1024).toString("base64"),
    })
    assert.equal(oversized.ok, false)
  })

  void it("requires a non-empty request id for speech-to-text messages", () => {
    const result = validate({
      type: "stt_transcribe_audio",
      requestId: "",
      mimeType: "audio/webm",
      data: Buffer.from("audio").toString("base64"),
    })

    assert.equal(result.ok, false)
  })
})
