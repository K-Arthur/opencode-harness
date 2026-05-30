import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (f: string) => readFileSync(path.join(__dirname, f), "utf8")
const main = read("main.ts")
const handlers = read("streamHandlers.ts")
const endHandler = read("streamEndHandler.ts")
const orchestrator = read("streamOrchestrator.ts")

/**
 * Wiring guards — lock the integration points that the behavioral tests cannot
 * reach directly (e.g. main.ts is an un-importable IIFE).
 */
describe("stream fix wiring", () => {
  it("C1: addMessage upserts by id instead of bare push", () => {
    assert.ok(main.includes("upsertMessageById(session.messages, msg)"), "must use upsertMessageById")
    assert.ok(!/\bsession\.messages\.push\(msg\)/.test(main), "must not bare-push the message")
  })

  it("C3: tool/diff boundaries drain the queue before zeroing the buffer", () => {
    const prepare = handlers.indexOf("function prepareForToolBlock(")
    const flush = handlers.indexOf("state.renderQueue?.forceFlush()", prepare)
    const zero = handlers.indexOf('state.currentBlockBuffer = ""', prepare)
    assert.ok(flush > prepare && flush < zero, "forceFlush must precede buffer zeroing")
  })

  it("P1/A: live render path uses the frozen-tail LiveTextRenderer", () => {
    assert.ok(handlers.includes("new LiveTextRenderer()"), "must instantiate LiveTextRenderer")
    assert.ok(handlers.includes("liveRenderer.renderInto(textEl, displayText)"), "must render via renderInto")
  })

  it("M3: stream_end destroys the queue when server blocks will overwrite", () => {
    assert.ok(endHandler.includes("else state.renderQueue.destroy()"), "non-empty blocks → destroy, not flush")
  })

  it("M7: placeholder removal goes through placeholderHasRenderedContent", () => {
    assert.ok(orchestrator.includes("placeholderHasRenderedContent(placeholder)"))
  })

  it("C2: handleStreamStart only short-circuits for the SAME id", () => {
    assert.ok(
      handlers.includes("state.streamingMessageId === messageId"),
      "restart guard must compare the incoming id",
    )
  })
})
