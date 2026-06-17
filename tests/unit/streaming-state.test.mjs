import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS = path.join(__dirname, "..", "..", "src", "chat", "webview", "css")
const TS = path.join(__dirname, "..", "..", "src", "chat", "webview")

const blocks = readFileSync(path.join(CSS, "blocks.css"), "utf8")
const messages = readFileSync(path.join(CSS, "messages.css"), "utf8")
const streamHandlers = readFileSync(path.join(TS, "streamHandlers.ts"), "utf8")
const renderer = readFileSync(path.join(TS, "messageRenderer.ts"), "utf8")

describe("Streaming state transitions — structural", () => {
  it("streamHandlers removes .streaming class from messages on finalize", () => {
    assert.ok(
      streamHandlers.includes(`el.classList.remove("streaming")`),
      "finalizeStreamingText must remove .streaming class"
    )
  })

  it("streamHandlers removes .streaming-text class from text elements", () => {
    assert.ok(
      streamHandlers.includes(`el.classList.remove("streaming-text")`) ||
      streamHandlers.includes(`classList.remove("streaming-text")`),
      "demoteStreamingText must remove .streaming-text class"
    )
  })

  it("CSS has no animation on .message element", () => {
    assert.ok(
      !messages.match(/\.message\s*\{[^}]*animation:/),
      ".message must not have any animation property"
    )
  })

  it("CSS has no bubble-stream-pulse anywhere", () => {
    assert.ok(!messages.includes("bubble-stream-pulse"), "no bubble-stream-pulse in messages.css")
    assert.ok(!blocks.includes("bubble-stream-pulse"), "no bubble-stream-pulse in blocks.css")
  })

  it("messageRenderer adds .message--new on initial render (skipHeader falsy)", () => {
    assert.ok(
      renderer.includes(`div.classList.add("message--new")`) ||
      renderer.includes(`classList.add("message--new")`),
      "renderMessage must add .message--new class"
    )
  })

  it("messageRenderer only adds .message--new when skipHeader is falsy", () => {
    assert.ok(
      renderer.includes(`!opts?.skipHeader`) && renderer.includes(`message--new`),
      ".message--new must be conditional on !opts?.skipHeader"
    )
  })
})
