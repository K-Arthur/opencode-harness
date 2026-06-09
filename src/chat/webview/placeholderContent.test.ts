import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"
import { placeholderHasRenderedContent } from "./placeholderContent"

/**
 * M7 — stream_end placeholder removal must not nuke a bubble that holds tool /
 * diff / skill blocks just because it has no text. The original check only
 * looked at text length > 2 and ignored non-text blocks.
 */
describe("M7: placeholder content detection", () => {
  it("treats a tool-only placeholder (no text) as having content", () => {
    const dom = installDom()
    try {
      const ph = document.createElement("div")
      ph.innerHTML = '<div class="message-bubble"><details class="tool-call"><summary>read</summary></details></div>'
      assert.equal(placeholderHasRenderedContent(ph), true, "tool block counts as content")
    } finally {
      dom.restore()
    }
  })

  it("treats a diff-only placeholder as having content", () => {
    const dom = installDom()
    try {
      const ph = document.createElement("div")
      ph.innerHTML = '<div class="message-bubble"><div class="diff-block"></div></div>'
      assert.equal(placeholderHasRenderedContent(ph), true)
    } finally {
      dom.restore()
    }
  })

  it("treats a truly empty placeholder as having no content", () => {
    const dom = installDom()
    try {
      const ph = document.createElement("div")
      ph.innerHTML = '<div class="message-bubble"><div class="streaming-text"></div></div>'
      assert.equal(placeholderHasRenderedContent(ph), false)
    } finally {
      dom.restore()
    }
  })

  it("treats a placeholder with real streamed text as having content", () => {
    const dom = installDom()
    try {
      const ph = document.createElement("div")
      ph.innerHTML = '<div class="message-bubble"><div class="msg-text">Hello world</div></div>'
      assert.equal(placeholderHasRenderedContent(ph), true)
    } finally {
      dom.restore()
    }
  })
})
