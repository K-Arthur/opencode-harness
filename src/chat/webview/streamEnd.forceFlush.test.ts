import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom, createHarness } from "./streamHarness"

/**
 * M3 — stream_end must not force-flush the RenderQueue when the server provides
 * authoritative blocks. mergeServerBlocks + reRenderMessage rebuild the whole
 * bubble a tick later, so a forceFlush is pure wasted parse/sanitize work on
 * the heaviest message of the stream.
 */
describe("M3: stream_end skips wasted queue flush when blocks are provided", () => {
  it("does not flush the queue when non-empty blocks are supplied", async () => {
    const dom = installDom({ manualRaf: true })
    try {
      const { handleStreamStart, handleStreamChunk, handleStreamEnd } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m1")
      handleStreamChunk(h.state, h.els, h.messages, "buffered but not yet flushed")
      const queue = h.state.renderQueue!
      assert.equal(queue.getStats().flushCount, 0, "precondition: nothing flushed yet (manual RAF)")

      handleStreamEnd(h.state, h.els, h.messages, () => {}, "m1", [
        { type: "text", text: "authoritative server text" },
      ])

      assert.equal(
        queue.getStats().flushCount,
        0,
        "queue must NOT be force-flushed when server blocks will overwrite the bubble",
      )
      assert.match(
        h.els.messageList.textContent || "",
        /authoritative server text/,
        "final render must reflect the server blocks",
      )
    } finally {
      dom.restore()
    }
  })

  it("still force-flushes when blocks are empty (live text is authoritative)", async () => {
    const dom = installDom({ manualRaf: true })
    try {
      const { handleStreamStart, handleStreamChunk, handleStreamEnd } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m2")
      handleStreamChunk(h.state, h.els, h.messages, "live tail text")
      const queue = h.state.renderQueue!

      handleStreamEnd(h.state, h.els, h.messages, () => {}, "m2", [])

      assert.ok(queue.getStats().flushCount >= 1, "empty-blocks path must flush live text")
      assert.match(h.els.messageList.textContent || "", /live tail text/)
    } finally {
      dom.restore()
    }
  })
})
