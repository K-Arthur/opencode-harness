import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom, createHarness } from "./streamHarness"

/**
 * C3 — RenderQueue byte-loss between two consecutive tools.
 *
 * After tool1, prepareForToolBlock sets state.currentBlockEl = null. A text
 * chunk arriving before the next RAF flush is buffered but its DOM element is
 * not yet re-established. If tool2 then starts before the flush,
 * finalizeCurrentTextBlock early-returns (currentBlockEl === null) and the
 * buffer is zeroed — the inter-tool text is silently lost.
 *
 * The fix: drain (flush) the RenderQueue before zeroing the buffer so queued
 * bytes land in a finalized text block first.
 */
describe("C3: inter-tool text is not dropped when buffer DOM is not yet established", () => {
  it("preserves a chunk that arrives between two consecutive tools", async () => {
    const dom = installDom({ manualRaf: true })
    try {
      const { handleStreamStart, handleStreamChunk, handleToolStart } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m1")
      // First tool finalizes & clears the initial text block, sets currentBlockEl=null.
      handleToolStart(h.state, h.els, h.messages, { id: "t1", name: "read", args: {} })
      // Inter-tool text: buffered + enqueued, but DOM element not yet recreated
      // (that only happens on a RAF flush, which has not fired in manual mode).
      handleStreamChunk(h.state, h.els, h.messages, "Between the two tools")
      // Second tool starts before the queue drains.
      handleToolStart(h.state, h.els, h.messages, { id: "t2", name: "write", args: {} })
      dom.flushRafs()

      const bubble = h.els.messageList.querySelector('[data-message-id="m1"]') as HTMLElement
      assert.ok(bubble, "stream bubble must exist")
      assert.match(
        bubble.textContent || "",
        /Between the two tools/,
        "inter-tool text must be flushed into a finalized text block, not dropped",
      )
    } finally {
      dom.restore()
    }
  })
})
