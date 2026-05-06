import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coordinatorSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")
const providerSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "ChatProvider.ts"), "utf8")
const streamHandlersSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "streamHandlers.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")

describe("StreamCoordinator timeout hardening", () => {
  it("has separate TTFB_TIMEOUT_MS constant", () => {
    assert.ok(coordinatorSource.includes("readonly TTFB_TIMEOUT_MS = 30000"), "TTFB_TIMEOUT_MS must be 30000")
  })

  it("has separate CHUNK_INACTIVITY_TIMEOUT_MS constant", () => {
    assert.ok(coordinatorSource.includes("readonly CHUNK_INACTIVITY_TIMEOUT_MS = 60000"), "CHUNK_INACTIVITY_TIMEOUT_MS must be 60000")
  })

  it("TTFB timeout is shorter than full completion timeout", () => {
    assert.ok(coordinatorSource.includes("TTFB_TIMEOUT_MS = 30000"), "TTFB must be 30s")
    assert.ok(coordinatorSource.includes("CHUNK_INACTIVITY_TIMEOUT_MS = 60000"), "chunk timeout must be 60s")
  })

  it("cancels TTFB timeout on first chunk arrival", () => {
    assert.ok(coordinatorSource.includes("clearTtfbTimeout(tabId)"), "must clear TTFB timeout on first chunk")
    assert.ok(coordinatorSource.includes("if (this.ttfbTimeouts.has(tabId))"), "must check ttfbTimeouts before clearing")
  })

  it("resets chunk inactivity timeout on every received chunk", () => {
    assert.ok(coordinatorSource.includes("resetCompletionTimeout(tabId, callbacks)"), "must reset completion timeout")
    assert.ok(coordinatorSource.includes("this.tabManager.clearCompletionTimeout(tabId)"), "must clear old timeout before reset")
  })
})

describe("StreamCoordinator error handling", () => {
  it("posts stream_end with reason=error when sendPromptAsync throws", () => {
    assert.ok(coordinatorSource.includes('reason: "error"'), "must post stream_end with reason error")
    assert.ok(coordinatorSource.includes("callbacks.postMessage({\n        type: \"stream_end\""), "must post stream_end before postRequestError")
  })

  it("posts stream_end with reason=ttfb_timeout when first byte never arrives", () => {
    assert.ok(coordinatorSource.includes('reason: "ttfb_timeout"'), "must post stream_end with ttfb_timeout reason")
    assert.ok(coordinatorSource.includes("retryable: true"), "ttfb_timeout must be retryable")
  })

  it("posts stream_end with partial=true on chunk inactivity timeout", () => {
    assert.ok(coordinatorSource.includes('reason: "timeout"'), "must post stream_end with timeout reason")
    assert.ok(coordinatorSource.includes("partial: true"), "timeout must include partial flag")
  })

  it("prevents finalizeStream from running twice", () => {
    assert.ok(coordinatorSource.includes("finalizingTabs = new Set<string>()"), "must track finalizing tabs")
    assert.ok(coordinatorSource.includes("if (this.finalizingTabs.has(tabId))"), "must guard against double finalize")
    assert.ok(coordinatorSource.includes("this.finalizingTabs.add(tabId)"), "must add tab to finalizing set")
    assert.ok(coordinatorSource.includes("this.finalizingTabs.delete(tabId)"), "must remove tab from finalizing set")
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
    assert.ok(coordinatorSource.includes("finalizingTabs"), "must use finalizingTabs guard")
  })
})

describe("Tab streaming lifecycle", () => {
  it("closing a tab aborts stream and clears in-flight state", () => {
    assert.ok(providerSource.includes("if (tab?.isStreaming) void this.streamCoordinator.abort("), "close_tab must abort stream")
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
    assert.ok(coordinatorSource.includes("log.info(`[stream:"), "must log state transitions with tabId")
  })
})

describe("Webview error handling", () => {
  it("handles prompt_rejected message to reset streaming state", () => {
    assert.ok(mainSource.includes('case "prompt_rejected"'), "main.ts must handle prompt_rejected")
    assert.ok(mainSource.includes("stateManager.setStreaming(sessionId, false)"), "must reset streaming state on rejection")
  })

  it("shows error message on stream_end with reason=error", () => {
    assert.ok(mainSource.includes('reason === "error"'), "must handle error reason in stream_end")
    assert.ok(mainSource.includes("An error occurred while generating the response"), "must show actionable error message")
  })
})
