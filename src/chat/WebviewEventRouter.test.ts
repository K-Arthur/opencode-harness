import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

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
    const validation = blockBetween('case \"send_prompt\"', 'case \"mention_search\"')

    assert.ok(handler.includes("hasPromptContent"), "send_prompt handler must accept text or attachments")
    assert.ok(validation.includes("hasPromptContent"), "send_prompt validation must accept text or attachments")
    assert.ok(!validation.includes("if (!text || typeof text !== \"string\""), "attachments must not require text")
  })

  it("allows attachment-only steer prompts", () => {
    const validation = blockBetween('case \"send_steer_prompt\"', "default:")

    assert.ok(validation.includes("hasPromptContent"), "steer prompt validation must accept text or attachments")
    assert.ok(!validation.includes("if (!msg.text || typeof msg.text !== \"string\""), "steer attachments must not require text")
  })
})
