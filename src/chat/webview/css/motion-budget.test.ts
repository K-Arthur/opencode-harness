import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const blocks = readFileSync(path.join(__dirname, "blocks.css"), "utf8")
const messages = readFileSync(path.join(__dirname, "messages.css"), "utf8")
const animations = readFileSync(path.join(__dirname, "animations.css"), "utf8")
const accessibility = readFileSync(path.join(__dirname, "accessibility.css"), "utf8")
const layout = readFileSync(path.join(__dirname, "layout.css"), "utf8")

describe("Streaming motion budget — structural CSS guards", () => {
  it("blocks.css has no box-shadow in @keyframes", () => {
    const keyframeBlocks = blocks.match(/@keyframes\s+\w+\s*\{[^}]*\}/g) || []
    for (const kf of keyframeBlocks) {
      assert.ok(
        !kf.includes("box-shadow"),
        `@keyframes in blocks.css must not use box-shadow: ${kf.slice(0, 80)}`
      )
    }
  })

  it("blocks.css has no infinite pulse/shake/spin animations", () => {
    const forbidden = [
      "thinking-pulse",
      "thinking-pulse-fade",
      "tool-border-pulse",
      "tool-elapsed-pulse",
      "badge-pulse",
      "tool-live-spin",
      "tool-group-active-pulse",
      "error-shake-in",
      "subagent-badge-pulse",
      "subagent-highlight-pulse",
      "bubble-stream-pulse",
    ]
    for (const name of forbidden) {
      assert.ok(
        !blocks.includes(`animation: ${name}`),
        `blocks.css must not reference removed animation: ${name}`
      )
    }
  })

  it("messages.css .message has no entrance animation", () => {
    assert.ok(
      !messages.match(/\.message\s*\{[^}]*animation:\s*message-enter/),
      ".message must not have message-enter animation"
    )
  })

  it("messages.css has no bubble-stream-pulse", () => {
    assert.ok(
      !messages.includes("bubble-stream-pulse"),
      "messages.css must not reference bubble-stream-pulse"
    )
  })

  it("animations.css has no thinking-pulse or error-shake-in keyframes", () => {
    assert.ok(!animations.includes("@keyframes thinking-pulse"), "must not define thinking-pulse")
    assert.ok(!animations.includes("@keyframes error-shake-in"), "must not define error-shake-in")
  })

  it("animations.css still has cursor-blink", () => {
    assert.ok(animations.includes("@keyframes cursor-blink"), "must keep cursor-blink")
  })

  it("animations.css has no stagger-children utilities", () => {
    assert.ok(!animations.includes(".stagger-children"), "must not define stagger-children")
  })

  it("layout.css tab indicator has no streaming-pulse animation", () => {
    assert.ok(
      !layout.includes("streaming-pulse"),
      "layout.css must not reference streaming-pulse"
    )
  })

  it("accessibility.css reduced-motion covers streaming caret", () => {
    assert.ok(
      accessibility.includes(".streaming-text::after"),
      "accessibility.css must override streaming-text::after for reduced-motion"
    )
  })

  it("blocks.css .diff-block has contain: layout paint", () => {
    assert.match(blocks, /\.diff-block\s*\{[^}]*contain:\s*layout\s*paint/)
  })

  it("messages.css .message-content has contain: layout", () => {
    assert.match(messages, /\.message-content\s*\{[^}]*contain:\s*layout/)
  })
})
