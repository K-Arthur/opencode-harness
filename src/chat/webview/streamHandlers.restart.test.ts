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

  it("restarting drops the prior EMPTY placeholder from the array and DOM (no remnant)", async () => {
    const dom = installDom()
    try {
      const { handleStreamStart } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m-A") // empty placeholder
      assert.ok(h.els.messageList.querySelector('[data-message-id="m-A"]'), "m-A rendered")

      handleStreamStart(h.state, h.els, h.messages, "m-B") // restart before any content

      assert.equal(
        h.messages.filter((m) => m.id === "m-A").length,
        0,
        "empty prior placeholder must be removed from the messages array",
      )
      assert.equal(
        h.els.messageList.querySelector('[data-message-id="m-A"]'),
        null,
        "empty prior placeholder must be removed from the DOM (no stuck live dot)",
      )
    } finally {
      dom.restore()
    }
  })

  it("restarting KEEPS a prior bubble that already has content (re-rendered, not orphaned)", async () => {
    const dom = installDom()
    try {
      const { handleStreamStart, handleStreamToken } = await import("./streamHandlers")
      const h = createHarness()

      handleStreamStart(h.state, h.els, h.messages, "m-A")
      handleStreamToken(h.state, h.els, h.messages, "real content", () => {}, "m-A")

      handleStreamStart(h.state, h.els, h.messages, "m-B")

      assert.equal(
        h.messages.filter((m) => m.id === "m-A").length,
        1,
        "a prior bubble with content must be preserved",
      )
      const priorEl = h.els.messageList.querySelector('[data-message-id="m-A"]')
      assert.ok(priorEl, "prior content bubble stays in the DOM")
      assert.equal(
        priorEl?.classList.contains("streaming"),
        false,
        "prior bubble must no longer carry the streaming class (live dot stopped)",
      )
    } finally {
      dom.restore()
    }
  })

  it("isEmptyStreamingMessage detects blank vs content messages", async () => {
    const { isEmptyStreamingMessage } = await import("./streamHandlers")
    assert.equal(isEmptyStreamingMessage({ role: "assistant", blocks: [] } as any), true)
    assert.equal(
      isEmptyStreamingMessage({ role: "assistant", blocks: [{ type: "text", text: "   " }] } as any),
      true,
    )
    assert.equal(
      isEmptyStreamingMessage({ role: "assistant", blocks: [{ type: "text", text: "hi" }] } as any),
      false,
    )
    assert.equal(
      isEmptyStreamingMessage({ role: "assistant", blocks: [{ type: "tool-call", name: "read" }] } as any),
      false,
    )
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
