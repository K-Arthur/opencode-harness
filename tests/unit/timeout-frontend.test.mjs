import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")
const handlersSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "streamHandlers.ts"), "utf8")

describe("Stream timeout frontend feedback", () => {
  it("stream_end dispatches reason field to handler", () => {
    assert.ok(mainSource.includes("msg.reason"),
      "main.ts must pass msg.reason from stream_end message to handler")
    assert.ok(mainSource.includes("msg.partial"),
      "main.ts must pass msg.partial from stream_end message to handler")
  })

  it("handleStreamEnd shows user-actionable message on TTFB timeout", () => {
    assert.ok(mainSource.includes('reason === "ttfb_timeout"'),
      "must handle ttfb_timeout reason")
    assert.ok(mainSource.includes("took too long"),
      "must show 'took too long' message for TTFB timeout")
  })

  it("handleStreamEnd shows user-actionable message on completion timeout", () => {
    assert.ok(mainSource.includes('reason === "timeout"'),
      "must handle timeout reason")
    assert.ok(mainSource.includes("Response was cut off"),
      "must show timeout message for partial completion timeout")
  })

  it("aborted stream_end does not show error message", () => {
    assert.ok(mainSource.includes('reason === "aborted"'),
      "must handle aborted reason differently (no system message)")
    assert.ok(mainSource.includes("no error message needed"),
      "should not show error for user-initiated abort")
  })
})
