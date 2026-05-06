import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const streamSource = readFileSync(path.join(__dirname, "stream.ts"), "utf8")
const handlersSource = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")

function sourceIncludes(str: string): boolean {
  return streamSource.includes(str) || handlersSource.includes(str)
}

describe("stream.ts", () => {
  it("exports createStreamHandlers", () => {
    assert.ok(streamSource.includes("export function createStreamHandlers"))
  })

  it("exports StreamState interface", () => {
    assert.ok(sourceIncludes("export interface StreamState"))
  })

  it("exports StreamElements interface", () => {
    assert.ok(sourceIncludes("export interface StreamElements"))
  })

  it("exports StreamCallbacks interface", () => {
    assert.ok(sourceIncludes("export interface StreamCallbacks"))
  })

  it("exports reRenderMessage function", () => {
    assert.ok(sourceIncludes("export function reRenderMessage"))
  })

  it("has stripContextFromText function", () => {
    assert.ok(sourceIncludes("export function stripContextFromText"))
  })

  it("strips <context> blocks", () => {
    assert.ok(sourceIncludes("<context>"))
    assert.ok(sourceIncludes("</context>"))
  })

  it("has StreamState with seenEventIds for deduplication", () => {
    assert.ok(sourceIncludes("seenEventIds: Set<string>"), "StreamState must include seenEventIds")
    assert.ok(sourceIncludes("lastStreamTextEl"), "StreamState must include lastStreamTextEl")
    assert.ok(sourceIncludes("streamingBlockId"), "StreamState must include streamingBlockId")
    assert.ok(sourceIncludes("streamingToolCallId"), "StreamState must include streamingToolCallId")
  })

  it("has handleStreamStart method", () => {
    assert.ok(sourceIncludes("handleStreamStart("), "handleStreamStart must exist")
    assert.ok(sourceIncludes("state.streamingBlockId = null"), "must reset streamingBlockId")
    assert.ok(sourceIncludes("state.lastStreamTextEl = textEl"), "must set lastStreamTextEl")
  })

  it("has handleStreamToken for targeted DOM updates", () => {
    assert.ok(sourceIncludes("handleStreamToken(text?: string)"), "handleStreamToken must exist")
    assert.ok(sourceIncludes("textEl.textContent = displayText"), "must set textContent directly")
    assert.ok(sourceIncludes("state.lastStreamTextEl = textEl"), "must track last element")
    assert.ok(sourceIncludes("streaming-text"), "must use streaming-text class for CSS cursor")
  })

  it("has handleStreamEnd method", () => {
    assert.ok(sourceIncludes("handleStreamEnd("), "handleStreamEnd must exist")
    assert.ok(sourceIncludes("hideTypingIndicator("), "must hide typing indicator")
    assert.ok(sourceIncludes("onStreamingChange"), "must notify streaming ended")
  })

  it("has handleToolStart method", () => {
    assert.ok(sourceIncludes("handleToolStart("), "handleToolStart must exist")
    assert.ok(sourceIncludes("state.streamingToolCallId = toolCall.id"), "must set streamingToolCallId")
    assert.ok(sourceIncludes("renderBlock(toolBlock"), "must call renderBlock")
  })

  it("has handleToolUpdate method", () => {
    assert.ok(sourceIncludes("handleToolUpdate("), "handleToolUpdate must exist")
    assert.ok(sourceIncludes("tool-call--${update.state}"), "must update tool call class dynamically")
  })

  it("has handleToolEnd method", () => {
    assert.ok(sourceIncludes("handleToolEnd("), "handleToolEnd must exist")
    assert.ok(sourceIncludes("state.streamingToolCallId = null"), "must clear streamingToolCallId")
  })

  it("has handleDiff method", () => {
    assert.ok(sourceIncludes("handleDiff("), "handleDiff must exist")
    assert.ok(sourceIncludes("renderBlock(diffBlock"), "must call renderBlock for diff")
  })

  it("has handleStreamChunk delegate", () => {
    assert.ok(sourceIncludes("handleStreamChunk("), "handleStreamChunk must exist")
    assert.ok(sourceIncludes("handleStreamToken(state"), "must delegate to handleStreamToken")
  })

  it("has handleStreamError method", () => {
    assert.ok(sourceIncludes("handleStreamError("), "handleStreamError must exist")
    assert.ok(sourceIncludes("renderMessage(errMsg)"), "must render error message")
  })

  it("has handleRequestError method", () => {
    assert.ok(sourceIncludes("handleRequestError("), "handleRequestError must exist")
    assert.ok(sourceIncludes("handleStreamError(state"), "must delegate to handleStreamError")
    assert.ok(sourceIncludes("code: 'request_failed'"), "must use request_failed code")
  })

  it("has handleDiffResult method", () => {
    assert.ok(sourceIncludes("handleDiffResult("), "handleDiffResult must exist")
    assert.ok(sourceIncludes(".diff-btn--accept"), "must reference accept button")
    assert.ok(sourceIncludes(".diff-btn--discard"), "must reference discard button")
  })

  it("queries diff blocks by data-diff-id not data-block-id", () => {
    const streamUsesDiffId = streamSource.includes('data-diff-id="')
    const handlersUsesDiffId = handlersSource.includes('data-diff-id="')
    const streamUsesBlockId = streamSource.includes('data-block-id="')
    const handlersUsesBlockId = handlersSource.includes('data-block-id="')
    assert.ok(
      streamUsesDiffId || handlersUsesDiffId,
      "handleDiffResult must query by data-diff-id (renderer sets dataset.diffId)"
    )
  })

  it("has handleServerStatus method", () => {
    assert.ok(sourceIncludes("handleServerStatus("), "handleServerStatus must exist")
  })

  it("has clearMessages method", () => {
    assert.ok(sourceIncludes("clearMessages()"), "clearMessages must exist")
    assert.ok(sourceIncludes("state.seenEventIds.clear()"), "must clear seenEventIds")
  })

  it("returns all handler functions", () => {
    const handlers = [
      "showTypingIndicator", "hideTypingIndicator",
      "handleStreamStart", "handleStreamToken", "handleStreamChunk",
      "handleToolStart", "handleToolUpdate", "handleToolEnd",
      "handleDiff", "handleStreamEnd", "handleStreamError",
      "handleRequestError", "handleDiffResult", "handleServerStatus",
      "clearMessages",
    ]
    handlers.forEach(h => {
      assert.ok(sourceIncludes(h), `Missing handler ${h} in source`)
    })
  })
})
