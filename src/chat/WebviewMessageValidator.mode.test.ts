import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { validateWebviewMessage } from "./WebviewMessageValidator"

const deps = {
  hasPromptContent: () => true,
  isValidThemeConfigPayload: () => true,
  warn: () => {},
}

function validateChangeMode(msg: Record<string, unknown>): boolean {
  return validateWebviewMessage(msg, "change_mode", deps)
}

void describe("WebviewMessageValidator change_mode", () => {
  void it("rejects missing or unknown mode values", () => {
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1" }), false)
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1", mode: "oops" }), false)
  })

  void it("accepts supported modes and legacy normal mode", () => {
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1", mode: "plan" }), true)
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1", mode: "build" }), true)
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1", mode: "auto" }), true)
    assert.equal(validateChangeMode({ type: "change_mode", sessionId: "s1", mode: "normal" }), true)
  })
})
