import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coordinatorSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")
const finalizerSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamFinalizerService.ts"), "utf8")
const providerSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "ChatProvider.ts"), "utf8")
const eventRouterSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "WebviewEventRouter.ts"), "utf8")
const streamHandlersSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "streamHandlers.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")

describe("StreamCoordinator timeout hardening", () => {
  it("has separate TTFB_TIMEOUT_MS constant", () => {
    assert.ok(/readonly TTFB_TIMEOUT_MS = \d+/.test(coordinatorSource), "TTFB_TIMEOUT_MS must be defined")
  })

  it("does not restore the removed chunk-inactivity timeout", () => {
    assert.ok(!coordinatorSource.includes("CHUNK_INACTIVITY_TIMEOUT_MS"), "chunk inactivity timeout must stay removed")
    assert.ok(!coordinatorSource.includes("resetCompletionTimeout"), "per-chunk completion timeout must stay removed")
  })

  it("uses STREAM_STUCK_MS as the single inactivity hard cap", () => {
    const ttfbMatch = coordinatorSource.match(/TTFB_TIMEOUT_MS = (\d+)/)
    const stuckMatch = coordinatorSource.match(/STREAM_STUCK_MS = (\d+)/)
    assert.ok(ttfbMatch && stuckMatch, "TTFB and stuck watchdog timeouts must be defined")
    assert.ok(
      Number(stuckMatch[1]) >= 600000,
      `STREAM_STUCK_MS (${stuckMatch[1]}ms) must allow long-running tool calls`
    )
  })

  it("cancels TTFB timeout on first chunk arrival", () => {
    assert.ok(coordinatorSource.includes("clearTtfbTimeout(tabId)"), "must clear TTFB timeout on first chunk")
    assert.ok(coordinatorSource.includes("if (this.ttfbTimeouts.has(tabId))"), "must check ttfbTimeouts before clearing")
  })

  it("updates watchdog activity instead of resetting a chunk timer on every chunk", () => {
    assert.ok(coordinatorSource.includes("this.tabManager.touchActivity(tabId)"), "chunks must update server activity")
    assert.ok(!coordinatorSource.includes("Chunk inactivity timeout"), "must not log chunk inactivity finalization")
  })
})

describe("StreamCoordinator error handling", () => {
  it("posts stream_end with reason=error when sendPromptAsync throws", () => {
    assert.ok(coordinatorSource.includes('reason: "error"'), "must post stream_end with reason error")
    assert.ok(coordinatorSource.includes("callbacks.postMessage({\n        type: \"stream_end\""), "must post stream_end before postRequestError")
  })

  it("posts stream_end with retryable TTFB or transport timeout when first byte never arrives", () => {
    assert.ok(coordinatorSource.includes('"event_stream_disconnected"'), "must distinguish transport disconnect from model TTFB")
    assert.ok(coordinatorSource.includes('"ttfb_timeout"'), "must still preserve model TTFB reason when transport is connected")
    assert.ok(coordinatorSource.includes("retryable: true"), "ttfb_timeout must be retryable")
  })

  it("server terminal events and watchdog replace chunk inactivity finalization", () => {
    assert.ok(coordinatorSource.includes("maybeFinalizeStream"), "server events must drive normal finalization")
    assert.ok(coordinatorSource.includes('reason: "hard_timeout"'), "watchdog must emit hard_timeout for total silence")
    assert.ok(!coordinatorSource.includes("resetCompletionTimeout"), "chunk inactivity finalization must stay removed")
  })

  it("prevents finalizeStream from running twice", () => {
    assert.ok(coordinatorSource.includes("finalizingTabs = new Set<string>()"), "must track finalizing tabs")
    assert.ok(finalizerSource.includes("this.deps.finalizingTabs.has(tabId)"), "must guard against double finalize")
    assert.ok(finalizerSource.includes("this.deps.finalizingTabs.add(tabId)"), "must add tab to finalizing set")
    assert.ok(finalizerSource.includes("this.deps.finalizingTabs.delete(tabId)"), "must remove tab from finalizing set")
  })

  it("cleans up assistant placeholder on early error", () => {
    assert.ok(streamHandlersSource.includes("emptyEl.remove()"), "must remove empty assistant placeholder")
    assert.ok(streamHandlersSource.includes("messages.splice(idx, 1)"), "must remove empty message from array")
  })
})

describe("ChatProvider event routing", () => {
  it("postRequestError includes sessionId for tab-scoped errors", () => {
    assert.ok(providerSource.includes("private postRequestError(message: string, sessionId?: string)"), "postRequestError must accept sessionId")
    assert.ok(providerSource.includes("sessionId,"), "must pass sessionId in postMessage")
  })

  it("routes server_error to active tab when sessionId is unknown", () => {
    assert.ok(providerSource.includes("const activeTab = this.tabManager.getActiveTab()"), "must fall back to active tab")
    assert.ok(providerSource.includes("this.postRequestError(errorMsg, activeTab.id)"), "must post error to active tab")
  })

  it("prevents double finalizeStream from message_complete + idle", () => {
    assert.ok(finalizerSource.includes("finalizingTabs") || coordinatorSource.includes("finalizingTabs"), "must use finalizingTabs guard")
  })
})

describe("Tab streaming lifecycle", () => {
  it("closing a tab aborts stream and clears in-flight state", () => {
    assert.ok(providerSource.includes("if (tab?.isStreaming) void this.streamCoordinator.abort(") || eventRouterSource.includes("if (tab?.isStreaming) void this.opts.streamCoordinator.abort("), "close_tab must abort stream")
    assert.ok(coordinatorSource.includes("clearTtfbTimeout(tabId)"), "cleanup must clear TTFB timeout")
  })

  it("concurrency limit rejection sends message to webview to reset state", () => {
    assert.ok(coordinatorSource.includes('type: "prompt_rejected"'), "must send prompt_rejected message")
    assert.ok(coordinatorSource.includes("reason: canStream.reason"), "must include rejection reason")
  })
})

describe("Stream state machine", () => {
  it("tracks stream lifecycle with explicit states", () => {
    assert.ok(coordinatorSource.includes('type StreamLifecycleState = "idle" | "sending" | "streaming" | "completing" | "error" | "timeout"'), "must define StreamLifecycleState")
    assert.ok(coordinatorSource.includes("setStreamState"), "must have setStreamState method")
  })

  it("logs state transitions with context (tabId, sessionId, modelId)", () => {
    assert.ok(coordinatorSource.includes("setStreamState"), "must have setStreamState method")
    assert.ok(coordinatorSource.includes("[stream:"), "must include tabId in log")
    assert.ok(coordinatorSource.includes("→"), "must log state transitions")
  })
})

describe("Webview error handling", () => {
  it("handles prompt_rejected message to reset streaming state", () => {
    assert.ok(mainSource.includes('"prompt_rejected"'), "main.ts must handle prompt_rejected")
    assert.ok(mainSource.includes("stateManager.setStreaming(sessionId, false)"), "must reset streaming state on rejection")
  })

  it("shows error message on stream_end with reason=error", () => {
    assert.ok(mainSource.includes('reason === "error"'), "must handle error reason in stream_end")
    assert.ok(mainSource.includes("An error occurred while generating the response"), "must show actionable error message")
  })
})
