import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (f: string) => readFileSync(path.join(__dirname, "css", f), "utf8")
const messages = read("messages.css")
const layout = read("layout.css")

describe("streaming-css conventions", () => {
  it("assistant streaming bubble does not contain pulse animations or box-shadow glows", () => {
    // Locate the assistant streaming bubble class rule block
    const startIndex = messages.indexOf(".message.assistant.streaming .message-bubble")
    assert.ok(startIndex !== -1, "assistant streaming bubble rule must exist")
    const block = messages.slice(startIndex, startIndex + 350)

    assert.ok(!block.includes("animation:"), "streaming bubble must not use animations")
    assert.ok(!block.includes("box-shadow:"), "streaming bubble must not use glows/box-shadows")
  })

  it("streaming cursor utilizes step-end blinking without ease-in-out fade or accent glow", () => {
    const startIndex = messages.indexOf(".streaming-text::after")
    assert.ok(startIndex !== -1, "streaming-text::after rule must exist")
    const block = messages.slice(startIndex, startIndex + 350)

    assert.ok(block.includes("animation: cursor-blink 1s step-end infinite;"), "streaming cursor must use step-end animation")
    assert.ok(!block.includes("box-shadow:"), "streaming cursor must not have box-shadow glows")

    const streamCursorStart = messages.indexOf(".stream-cursor")
    assert.ok(streamCursorStart !== -1, ".stream-cursor rule must exist")
    const scBlock = messages.slice(streamCursorStart, streamCursorStart + 350)
    assert.ok(scBlock.includes("animation: cursor-blink 1s step-end infinite;"), "stream-cursor must use step-end animation")
    assert.ok(!scBlock.includes("box-shadow:"), "stream-cursor must not have box-shadow glows")
  })

  it("message bubble does not transition background or border-color during streaming shifts", () => {
    const startIndex = messages.indexOf(".message.assistant .message-bubble")
    assert.ok(startIndex !== -1, ".message.assistant .message-bubble rule must exist")
    const block = messages.slice(startIndex, startIndex + 350)

    // Verify transition doesn't animate background/border-color dynamically
    assert.ok(!/transition:\s*[^;]*?(background|border-color)/.test(block), "must not transition background or border-color")
  })

  it("status LEDs do not use pulsing animations or glowing shadows", () => {
    const thinkingStart = layout.indexOf(".status-led.thinking")
    assert.ok(thinkingStart !== -1, ".status-led.thinking rule must exist")
    const thinkingBlock = layout.slice(thinkingStart, thinkingStart + 200)
    assert.ok(!thinkingBlock.includes("animation:"), "thinking status-led must not animate")
    assert.ok(!thinkingBlock.includes("box-shadow:"), "thinking status-led must not have shadows")

    const executingStart = layout.indexOf(".status-led.executing")
    assert.ok(executingStart !== -1, ".status-led.executing rule must exist")
    const executingBlock = layout.slice(executingStart, executingStart + 200)
    assert.ok(!executingBlock.includes("animation:"), "executing status-led must not animate")
    assert.ok(!executingBlock.includes("box-shadow:"), "executing status-led must not have shadows")
  })

  it("active streaming tab button does not use pulsing indicator", () => {
    const tabStart = layout.indexOf(".tab-btn.streaming .tab-indicator")
    assert.ok(tabStart !== -1, "tab-btn streaming indicator rule must exist")
    const tabBlock = layout.slice(tabStart, tabStart + 200)
    assert.ok(!tabBlock.includes("animation:"), "tab-indicator must not use animation while streaming")
  })
})
