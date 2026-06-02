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
  void it("accepts helper-open requests with a request id and provider", () => {
    const result = validate({
      type: "stt_open_helper",
      requestId: "voice-1",
      provider: "openai",
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings, [])
  })

  void it("rejects helper-open requests without a valid request id or provider", () => {
    const missingRequest = validate({
      type: "stt_open_helper",
      requestId: "",
      provider: "openai",
    })
    const invalidProvider = validate({
      type: "stt_open_helper",
      requestId: "voice-1",
      provider: "native",
    })

    assert.equal(missingRequest.ok, false)
    assert.equal(invalidProvider.ok, false)
  })

})
