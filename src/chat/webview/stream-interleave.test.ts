import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const handlersSource = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")

describe("streaming text-tool interleave", () => {
  it("handleToolStart calls finalizeCurrentTextBlock before clearing buffer", () => {
    const handleToolStartIdx = handlersSource.indexOf("export function handleToolStart(")
    const finalizeInTool = handlersSource.indexOf("finalizeCurrentTextBlock(state, els, messages)", handleToolStartIdx)
    const toolCallIdAfterFinalize = handlersSource.indexOf("state.streamingToolCallId = toolCall.id", finalizeInTool)
    assert.ok(
      finalizeInTool > handleToolStartIdx && toolCallIdAfterFinalize > finalizeInTool,
      "finalizeCurrentTextBlock must be called before clearing streaming state in handleToolStart"
    )
  })

  it("finalizeCurrentTextBlock removes streaming-text class and adds markdown-content", () => {
    assert.ok(
      handlersSource.includes('textEl.classList.remove("streaming-text")'),
      "finalize must remove streaming-text class"
    )
    assert.ok(
      handlersSource.includes('textEl.classList.add("msg-text", "markdown-content")'),
      "finalize must add msg-text and markdown-content classes"
    )
    assert.ok(
      handlersSource.includes("renderMarkdown(displayText, false)"),
      "finalize must render markdown (not streaming mode)"
    )
  })

  it("insertStreamingTextAfterLastBlock finds last tool/diff block for insertion", () => {
    assert.ok(
      handlersSource.includes('child.matches("details.tool-call, details.tool-group, .diff-block, .skill-badge")'),
      "insertStreamingTextAfterLastBlock must look for tool/diff/skill elements"
    )
    assert.ok(
      handlersSource.includes("insertStreamingTextAfterLastBlock(bubble, state, messages)"),
      "insertStreamingTextAfterLastBlock must be called with correct args"
    )
  })

  it("insertStreamingTextAfterLastBlock inserts after last block, not at bubble tail", () => {
    const insertAfterIdx = handlersSource.indexOf("insertAfter && insertAfter.nextSibling")
    const appendChildIdx = handlersSource.indexOf("bubble.appendChild(textEl)", insertAfterIdx)
    assert.ok(insertAfterIdx > 0, "must check for insertAfter")
    assert.ok(
      handlersSource.includes("bubble.insertBefore(textEl, insertAfter.nextSibling)"),
      "must use insertBefore for correct positioning"
    )
  })

  it("handleDiff finalizes current text block before inserting diff", () => {
    const diffFinalizeIdx = handlersSource.indexOf("finalizeCurrentTextBlock(state, els, messages)")
    const lastFinalizeIdx = handlersSource.lastIndexOf("finalizeCurrentTextBlock(state, els, messages)")
    assert.ok(lastFinalizeIdx > diffFinalizeIdx, "finalizeCurrentTextBlock must be called in at least 2 places (handleToolStart and handleDiff)")

    const handleDiffIdx = handlersSource.indexOf("export function handleDiff(")
    const diffFinalizeCall = handlersSource.indexOf("finalizeCurrentTextBlock(state, els, messages)", handleDiffIdx)
    assert.ok(diffFinalizeCall > handleDiffIdx, "handleDiff must call finalizeCurrentTextBlock")
  })

  it("handleStreamToken doUpdate uses insertStreamingTextAfterLastBlock for recovery", () => {
    const doUpdateIdx = handlersSource.indexOf("const doUpdate = () => {")
    assert.ok(doUpdateIdx > 0)

    const insertInDoUpdate = handlersSource.indexOf("insertStreamingTextAfterLastBlock(bubble, state, messages)", doUpdateIdx)
    assert.ok(insertInDoUpdate > doUpdateIdx, "doUpdate must use insertStreamingTextAfterLastBlock")
  })

  it("renderQueue callback in handleStreamStart uses insertStreamingTextAfterLastBlock", () => {
    const renderQueueIdx = handlersSource.indexOf("state.renderQueue = new RenderQueue(")
    assert.ok(renderQueueIdx > 0)

    const insertInQueue = handlersSource.indexOf("insertStreamingTextAfterLastBlock(bubble, state, messages)", renderQueueIdx)
    assert.ok(insertInQueue > renderQueueIdx, "renderQueue callback must use insertStreamingTextAfterLastBlock")
  })

  it("new text block after tool preserves correct block index", () => {
    assert.ok(
      handlersSource.includes("msgObj.blocks.push(createTextBlock(\"\"))") &&
      handlersSource.includes("state.currentBlockIndex = msgObj.blocks.length - 1"),
      "insertStreamingTextAfterLastBlock must create new text block and update block index"
    )
  })

  it("finalize skips when no buffer content", () => {
    assert.ok(
      handlersSource.includes("if (!state.currentBlockEl || !state.currentBlockBuffer.trim()) return"),
      "finalize must bail early when no content accumulated"
    )
  })
})

describe("streaming text rendering during active stream", () => {
  it("uses renderMarkdown with streaming=true during live updates", () => {
    assert.ok(
      handlersSource.includes("renderMarkdown(displayText, true)"),
      "live streaming must use renderMarkdown with isStreaming=true"
    )
  })

  it("uses renderMarkdown with streaming=false during finalize", () => {
    assert.ok(
      handlersSource.includes("renderMarkdown(displayText, false)"),
      "finalized text must use renderMarkdown with isStreaming=false"
    )
  })
})
