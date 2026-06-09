/**
 * Integration tests for the `question_answer` route in WebviewEventRouter.
 *
 * Verifies the host-side handler that surfaces a user's answer to an opencode
 * `question` tool back into the stream. The handler must:
 *   - be a valid webview message type
 *   - drop empty values
 *   - reuse send_prompt's in-flight guard so double-submits don't fire twice
 *   - prefer the v2 question reply/reject API when requestID is present
 *   - keep the legacy no-requestID fallback through streamCoordinator.startPrompt
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist in WebviewEventRouter.ts`)
  const end = source.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return source.slice(start, end)
}

describe("WebviewEventRouter — question_answer routing", () => {
  it("registers question_answer in VALID_WEBVIEW_TYPES", () => {
    const block = blockBetween("VALID_WEBVIEW_TYPES = new Set([", "])")
    assert.ok(block.includes(`"question_answer"`), "question_answer must be a recognized webview type")
  })

  it("registers a question_answer handler in webviewHandlers map", () => {
    assert.ok(source.includes(`["question_answer",`), "handler must be registered")
  })

  const handler = blockBetween(`["question_answer",`, `["change_mode",`)

  it("rejects messages without sessionId", () => {
    assert.ok(handler.includes("if (!sessionId)"), "must guard missing sessionId")
    assert.ok(handler.includes("missing sessionId"), "must log the drop reason")
  })

  it("rejects empty values (trimmed)", () => {
    assert.ok(handler.includes(`msg.value === "string" ? msg.value.trim() : ""`),
      "must trim and string-check value")
    assert.ok(handler.includes("if (!value)"), "must drop empty value")
  })

  it("reuses send_prompt's in-flight guard to prevent double-submits", () => {
    assert.ok(handler.includes("this.promptsInFlight.has(sessionId)"),
      "must check promptsInFlight before sending")
    assert.ok(handler.includes("this.promptsInFlight.add(sessionId)"),
      "must mark in-flight before sending")
    assert.ok(handler.includes("this.promptsInFlight.delete(sessionId)"),
      "must release the in-flight slot in finally")
  })

  it("appends the user message and forwards to streamCoordinator.startPrompt", () => {
    assert.ok(handler.includes("this.opts.sessionStore.appendMessage(sessionId, userMsg)"),
      "must record the answer as a user message")
    assert.ok(handler.includes("this.opts.streamCoordinator.startPrompt(sessionId, value,"),
      "must forward via startPrompt so opencode can resolve the pending question tool")
  })

  it("uses question reply/reject API for v2 requestID answers before the legacy prompt fallback", () => {
    assert.ok(handler.includes("const requestID"), "must read requestID from question_answer")
    assert.ok(handler.includes("if (requestID)"), "must branch before the legacy startPrompt fallback")
    assert.ok(handler.includes("this.opts.sessionManager.replyToQuestion(requestID"), "must use the v2 question reply API")
    assert.ok(handler.includes("this.opts.sessionManager.rejectQuestion(requestID"), "must use the v2 question reject API for skipped answers")
    assert.ok(handler.indexOf("if (requestID)") < handler.indexOf("this.promptsInFlight.has(sessionId)"),
      "v2 replies must not consume a prompt stream slot")
  })

  it("stores toolCallId in the user message block for downstream correlation", () => {
    assert.ok(handler.includes("toolCallId,") || handler.includes("toolCallId:"),
      "must include toolCallId in user message block metadata so opencode can resolve the correct pending tool")
  })

  it("passes toolCallId in the startPrompt callbacks for stream-level correlation", () => {
    assert.ok(
      handler.includes("toolCallId,") && handler.includes("postRequestError:"),
      "must include toolCallId in the StreamCallbacks passed to startPrompt"
    )
  })

  it("requires a selected model before sending (preserves send_prompt's contract)", () => {
    assert.ok(handler.includes("No model selected"), "must error when no model selected")
  })

  it("threads toolCallId into the log for observability", () => {
    assert.ok(handler.includes("toolCallId"), "must log toolCallId for cross-correlation with the originating tool")
  })

  it("error path posts a request error so the webview can recover", () => {
    assert.ok(handler.includes("this.opts.postRequestError("),
      "must surface failures so the UI doesn't spin")
  })
})
