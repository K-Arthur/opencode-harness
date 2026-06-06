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
  void it("accepts voice control messages with a valid request id", () => {
    for (const type of ["voice_start", "voice_stop", "voice_cancel"]) {
      const result = validate({ type, requestId: "voice-1" })
      assert.equal(result.ok, true, `${type} should be accepted`)
      assert.deepEqual(result.warnings, [])
    }
  })

  void it("rejects voice control messages with a missing/invalid request id", () => {
    assert.equal(validate({ type: "voice_start", requestId: "" }).ok, false)
    assert.equal(validate({ type: "voice_stop", requestId: 123 }).ok, false)
    assert.equal(validate({ type: "voice_cancel", requestId: "x".repeat(200) }).ok, false)
  })

  void it("does not validate get_voice_settings (no payload required)", () => {
    // Unregistered types pass through; this message carries no fields.
    assert.equal(validate({ type: "get_voice_settings" }).ok, true)
  })
})
