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

function validate(msg: Record<string, unknown>, type: string): boolean {
  return validateWebviewMessage(msg, type, deps)
}

void describe("WebviewMessageValidator plan_complete", () => {
  void it("rejects missing sessionId", () => {
    assert.equal(validate({ type: "plan_complete" }, "plan_complete"), false)
  })
  void it("accepts valid plan_complete", () => {
    assert.equal(validate({ type: "plan_complete", sessionId: "s1" }, "plan_complete"), true)
  })
})

void describe("WebviewMessageValidator mode_switch_request", () => {
  void it("rejects missing sessionId", () => {
    assert.equal(validate({ type: "mode_switch_request", targetMode: "build" }, "mode_switch_request"), false)
  })
  void it("rejects invalid targetMode", () => {
    assert.equal(validate({ type: "mode_switch_request", sessionId: "s1", targetMode: "invalid" }, "mode_switch_request"), false)
  })
  void it("rejects missing targetMode", () => {
    assert.equal(validate({ type: "mode_switch_request", sessionId: "s1" }, "mode_switch_request"), false)
  })
  void it("accepts valid mode_switch_request to build", () => {
    assert.equal(validate({ type: "mode_switch_request", sessionId: "s1", targetMode: "build" }, "mode_switch_request"), true)
  })
  void it("accepts valid mode_switch_request to plan", () => {
    assert.equal(validate({ type: "mode_switch_request", sessionId: "s1", targetMode: "plan" }, "mode_switch_request"), true)
  })
  void it("accepts valid mode_switch_request to auto", () => {
    assert.equal(validate({ type: "mode_switch_request", sessionId: "s1", targetMode: "auto" }, "mode_switch_request"), true)
  })
})
