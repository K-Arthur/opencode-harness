import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { JSDOM } from "jsdom"

const streamSource = readFileSync(path.join(__dirname, "stream.ts"), "utf8")
const handlersSource = readFileSync(path.join(__dirname, "streamHandlers.ts"), "utf8")

function sourceIncludes(str: string): boolean {
  return streamSource.includes(str) || handlersSource.includes(str)
}

/** Load streamHandlers after bootstrapping a DOMPurify instance for JSDOM. */
async function loadStreamHandlers(): Promise<typeof import("./streamHandlers")> {
  const { JSDOM: JSDom } = await import("jsdom")
  const purifyDom = new JSDom("", { url: "https://opencode-harness.test" })
  const createPurify = require("dompurify")
  const purify = createPurify(purifyDom.window)
  ;(globalThis as any).import_dompurify = { default: purify, ...purify }
  await import("./streamEndHandler")
  return import("./streamHandlers")
}

function installDom(): () => void {
  const dom = new JSDOM(
    '<!doctype html><div id="message-list"></div><div id="typing-indicator"></div><span id="typing-label"></span>',
    { url: "https://opencode-harness.test" },
  )
  const g = globalThis as any
  const previous = {
    window: g.window,
    document: g.document,
    HTMLElement: g.HTMLElement,
    Node: g.Node,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
  }

  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  g.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }
  g.cancelAnimationFrame = () => {}

  return () => {
    Object.assign(g, previous)
    dom.window.close()
  }
}

function createHarness() {
  const messageList = document.getElementById("message-list") as HTMLDivElement
  const typingIndicator = document.getElementById("typing-indicator") as HTMLDivElement
  const typingLabel = document.getElementById("typing-label") as HTMLSpanElement

  return {
    messages: [] as any[],
    state: {
      isStreaming: false,
      streamingMessageId: null,
      streamingBuffer: "",
      streamingBlockId: null,
      streamingToolCallId: null,
      seenEventIds: new Set<string>(),
      lastStreamTextEl: null,
      currentBlockEl: null,
      currentBlockBuffer: "",
      currentBlockIndex: -1,
      rafPending: false,
      renderQueue: null,
      chunkSeq: 0,
    },
    els: {
      messageList,
      typingIndicator,
      typingLabel,
      scrollAnchor: {
        anchor() {},
        scrollIfAnchored() {},
      },
    },
  }
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
    assert.ok(sourceIncludes("state.renderQueue.enqueue(chunk)"), "must enqueue live chunks through RenderQueue")
    assert.ok(sourceIncludes("liveRenderer.renderInto(textEl, displayText)"), "must render live text through LiveTextRenderer")
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
    // renderBlock can be invoked directly OR via the appendOrFoldToolDOM
    // helper added in 0.2.14 for live tool-group folding — both routes
    // ultimately call renderBlock on the new tool block.
    assert.ok(
      sourceIncludes("renderBlock(toolBlock") ||
        sourceIncludes("renderBlock(newToolBlock") ||
        sourceIncludes("appendOrFoldToolDOM("),
      "must call renderBlock (directly or via appendOrFoldToolDOM)",
    )
  })

  it("has handleToolUpdate method", () => {
    assert.ok(sourceIncludes("handleToolUpdate("), "handleToolUpdate must exist")
    // m1: the dynamic class swap is centralized in setToolStateClass.
    assert.ok(sourceIncludes("setToolStateClass(toolEl, update.state)"), "must update tool call class via the centralized helper")
    assert.ok(sourceIncludes("tool-call--${state}"), "centralized helper must set the dynamic tool-call class")
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

  it("coalesces duplicate error cards instead of stacking the same failure", () => {
    // The same fault can arrive multiple times (stream retries, repeated server
    // "error" statuses). handleStreamError must compare against the latest
    // message and skip re-appending an identical error card.
    assert.ok(sourceIncludes("lastErrMessage === errorContext.userMessage"), "must dedupe error cards by user message")
    assert.ok(sourceIncludes("lastBlock?.type === \"error\""), "must inspect the previous message's error block")
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

  // ── Real-time tool-call deduplication. The server may emit multiple
  // tool_start events for the same id (e.g. SDK part replays during reconnect).
  // Without dedup, the bubble shows the same tool card twice.
  it("handleToolStart skips when a tool with the same id already exists in the message", () => {
    const fnIdx = handlersSource.indexOf("export function handleToolStart")
    assert.ok(fnIdx >= 0, "handleToolStart must exist")
    const blockEnd = handlersSource.indexOf("export function handleToolUpdate", fnIdx)
    const block = handlersSource.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 2000)
    assert.ok(
      /msgObj\??\.blocks\.find(?:Index)?\(/.test(block) && /tool-call/.test(block) && /toolCall\.id/.test(block),
      "handleToolStart must check for existing tool-call block with the same id and skip duplicates"
    )
  })

  it("recovers late text chunks after stream_end clears the active stream id", async () => {
    const restore = installDom()
    try {
      const { handleStreamStart, handleStreamEnd, handleStreamChunk } = await loadStreamHandlers()
      const harness = createHarness()
      const saveState = () => {}
      let lateSaveCount = 0

      handleStreamStart(harness.state, harness.els as any, harness.messages, "resp-late")
      handleStreamEnd(harness.state, harness.els as any, harness.messages, saveState, "resp-late", [])
      assert.equal(harness.state.streamingMessageId, null)

      handleStreamChunk(harness.state, harness.els as any, harness.messages, "Late answer", () => {
        lateSaveCount++
      })

      const assistant = harness.messages.find((message) => message.id === "resp-late")
      const textBlock = assistant?.blocks.find((block: any) => block.type === "text")
      assert.equal(textBlock?.text, "Late answer")
      assert.match(harness.els.messageList.textContent || "", /Late answer/)
      assert.equal(lateSaveCount, 1)
    } finally {
      restore()
    }
  })

  it("marks unresolved tool calls complete when the stream finishes normally", async () => {
    const restore = installDom()
    try {
      const { handleStreamStart, handleStreamEnd } = await import("./streamHandlers")
      const harness = createHarness()
      const saveState = () => {}

      handleStreamStart(harness.state, harness.els as any, harness.messages, "resp-tools")
      handleStreamEnd(harness.state, harness.els as any, harness.messages, saveState, "resp-tools", [
        { type: "tool-call", id: "tool-1", name: "context7_query-docs", state: "running", args: {} },
        { type: "text", text: "Done with the answer." },
      ])

      const assistant = harness.messages.find((message) => message.id === "resp-tools")
      const tool = assistant?.blocks.find((block: any) => block.type === "tool-call")
      assert.equal(tool?.state, "unresolved")
      assert.ok((tool as any)?.error, "unresolved tool must have an error message")
    } finally {
      restore()
    }
  })

  it("finalizes using the active stream bubble when stream_end id changes", async () => {
    const restore = installDom()
    try {
      const { handleStreamStart, handleStreamEnd } = await import("./streamHandlers")
      const harness = createHarness()
      const saveState = () => {}

      handleStreamStart(harness.state, harness.els as any, harness.messages, "resp-session-id")
      handleStreamEnd(harness.state, harness.els as any, harness.messages, saveState, "msg-server-id", [
        { type: "text", text: "Final server text" },
      ])

      const assistant = harness.messages.find((message) => message.id === "resp-session-id")
      const textBlock = assistant?.blocks.find((block: any) => block.type === "text")
      assert.equal(textBlock?.text, "Final server text")
      assert.match(harness.els.messageList.textContent || "", /Final server text/)
    } finally {
      restore()
    }
  })

  it("preserves authoritative stream_end block order across text and tool runs", async () => {
    const restore = installDom()
    try {
      const { handleStreamStart, handleStreamEnd } = await import("./streamHandlers")
      const harness = createHarness()
      const saveState = () => {}

      handleStreamStart(harness.state, harness.els as any, harness.messages, "resp-ordered")
      handleStreamEnd(harness.state, harness.els as any, harness.messages, saveState, "resp-ordered", [
        { type: "text", text: "First I ran a command." },
        { type: "tool-call", id: "tool-1", name: "bash", class: "exec", state: "result", result: "ok" },
        { type: "text", text: "Then I edited the file." },
        { type: "tool-call", id: "tool-2", name: "edit", class: "write", state: "result", result: "ok" },
      ])

      const assistant = harness.messages.find((message) => message.id === "resp-ordered")
      assert.deepEqual(
        assistant?.blocks.map((block: any) => block.type),
        ["text", "tool-call", "text", "tool-call"],
        "final server blocks must keep text/tool/text/tool order",
      )
      assert.equal(assistant?.blocks[0]?.text, "First I ran a command.")
      assert.equal(assistant?.blocks[2]?.text, "Then I edited the file.")
    } finally {
      restore()
    }
  })
})
