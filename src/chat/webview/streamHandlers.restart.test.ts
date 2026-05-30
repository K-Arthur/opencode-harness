import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom, createHarness } from "./streamHarness"

/**
 * C2 — stream_start must be restartable for a NEW messageId.
 *
 * The original guard early-returned on any isStreaming, conflating an
 * idempotent re-emit (same id) with a genuine restart (new id, e.g. after an
 * error-recovered resume). A dropped restart routed msg-B's chunks into
 * msg-A's bubble.
 */
describe("C2: restartable stream_start", () => {
  it("starting a NEW messageId while streaming switches to a fresh bubble", async () => {
    const dom = installDom()
    try {
      const { handleStreamStart } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m-A")
      handleStreamStart(h.state, h.els, h.messages, "m-B")

      assert.equal(h.state.streamingMessageId, "m-B", "active stream must be the new id")
      assert.ok(
        h.messages.some((m) => m.id === "m-B"),
        "a message for the restarted id must exist",
      )
    } finally {
      dom.restore()
    }
  })

  it("re-emitting the SAME messageId while streaming is an idempotent no-op", async () => {
    const dom = installDom()
    try {
      const { handleStreamStart } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m-A")
      const countAfterFirst = h.messages.filter((m) => m.id === "m-A").length
      handleStreamStart(h.state, h.els, h.messages, "m-A")
      const countAfterSecond = h.messages.filter((m) => m.id === "m-A").length

      assert.equal(countAfterFirst, 1)
      assert.equal(countAfterSecond, 1, "duplicate start for same id must not add a second message")
    } finally {
      dom.restore()
    }
  })
})
