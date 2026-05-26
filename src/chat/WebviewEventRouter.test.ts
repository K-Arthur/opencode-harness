import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { validateWebviewMessage } from "./WebviewMessageValidator"

const source = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist`)
  const end = source.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return source.slice(start, end)
}

describe("WebviewEventRouter prompt validation", () => {
  it("allows attachment-only send_prompt payloads", () => {
    const handler = blockBetween('[\"send_prompt\"', '[\"change_mode\"')

    assert.ok(handler.includes("hasPromptContent"), "send_prompt handler must accept text or attachments")
    assert.equal(validate({ attachments: [{ data: "abc", mimeType: "image/png" }] }, "send_prompt"), true)
    assert.equal(validate({ text: "   " }, "send_prompt"), false)
  })

  it("allows attachment-only steer prompts", () => {
    assert.equal(validate({ attachments: [{ data: "abc", mimeType: "image/png" }] }, "send_steer_prompt"), true)
    assert.equal(validate({ text: "   " }, "send_steer_prompt"), false)
  })

  it("allows fork_session at turnIndex 0", () => {
    assert.equal(validate({ turnIndex: 0 }, "fork_session"), true)
    assert.equal(validate({ turnIndex: -1 }, "fork_session"), false)
  })

  it("allows show_diff to resolve pending edits by diffId", () => {
    assert.equal(validate({ diffId: "diff-1" }, "show_diff"), true)
    assert.equal(validate({ filePath: "a.ts", proposedContent: "next" }, "show_diff"), true)
    assert.equal(validate({ filePath: "a.ts" }, "show_diff"), false)
  })
})

function validate(msg: Record<string, unknown>, msgType: string): boolean {
  return validateWebviewMessage(msg, msgType, {
    hasPromptContent: (payload) => {
      const text = typeof payload.text === "string" ? payload.text : ""
      return text.trim().length > 0 || (Array.isArray(payload.attachments) && payload.attachments.length > 0)
    },
    isValidThemeConfigPayload: (theme) => theme !== null,
    warn: () => {},
  })
}
