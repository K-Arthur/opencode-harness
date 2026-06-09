import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "StreamCoordinator.ts"), "utf8")

describe("StreamCoordinator transport awareness", () => {
  it("waits for the event stream before sending async prompts", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const sendIdx = source.indexOf("sendPromptAsync", startIdx)
    const block = source.slice(startIdx, sendIdx > startIdx ? sendIdx : startIdx + 3000)

    assert.ok(block.includes("waitForEventStreamReady(5_000)"), "must wait briefly for SSE readiness")
    assert.ok(block.includes("eventStreamStatus"), "must inspect transport state on readiness failure")
    assert.ok(block.includes("cannot send a prompt until extension communication is connected"), "must fail with transport-specific copy")
  })

  it("maps first-byte timeout to event_stream_disconnected when transport drops", () => {
    assert.ok(source.includes('reason = eventStreamDisconnected ? "event_stream_disconnected" : "ttfb_timeout"'))
    assert.ok(source.includes("OpenCode event stream disconnected before any response events arrived."))
  })

  it("uses a single stream watchdog and no chunk-inactivity completion timer", () => {
    assert.ok(source.includes("STREAM_STUCK_MS = 600000"), "watchdog must be at least 10 minutes")
    assert.ok(!source.includes("CHUNK_INACTIVITY_TIMEOUT_MS"), "chunk inactivity timeout must not return")
    assert.ok(!source.includes("resetCompletionTimeout"), "per-chunk completion timeout must not return")
    assert.ok(!source.includes("startHardWatchdog"), "hard watchdog must remain folded into startWatchdog")
  })

  it("forwards image attachments as file parts to the opencode SDK prompt body", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const sendIdx = source.indexOf("sendPromptAsync", startIdx)
    const block = source.slice(startIdx, sendIdx > startIdx ? sendIdx : startIdx + 5000)

    assert.ok(block.includes("attachments:"), "startPrompt must accept attachments")
    assert.ok(block.includes('type: "file"'), "image attachments must be emitted as file parts")
    assert.ok(block.includes("mime:"), "file parts must carry the image MIME type")
    // File parts must point at a materialised file:// URL (via
    // attachmentStorage) rather than an inline data: URL. data: URLs trigger
    // the opencode server's clipboard probe (which fails on Linux without
    // wl-clipboard/xclip) and have documented failures with some
    // MCP/non-vision models.
    assert.ok(block.includes("this.attachmentStorage.materialize"), "file parts must materialise via attachmentStorage")
    assert.ok(block.includes("result.url"), "file parts must use the materialised URL")
    assert.ok(!block.includes("data:${attachment.mimeType};base64,${attachment.data}"), "inline data: URLs must not be used anymore")
  })

  it("uses the local first-message title when creating the SDK session", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const sendIdx = source.indexOf("sendPromptAsync", startIdx)
    const block = source.slice(startIdx, sendIdx > startIdx ? sendIdx : startIdx + 5000)

    assert.ok(block.includes("this.sessionStore.get(tabId)?.name"), "SDK session creation should use the local first-message title")
    assert.ok(!block.includes("`Tab ${tabId.slice(0, 8)}`"), "SDK session creation should not persist synthetic tab ids as titles")
  })

  it("reconnect reconciliation replays a resumed stream_start instead of force_rerender", () => {
    const idx = source.indexOf("async reconcileAfterReconnect")
    assert.ok(idx >= 0, "reconcileAfterReconnect must exist")
    const end = source.indexOf("\n  async retryFromHere", idx)
    const block = source.slice(idx, end > idx ? end : idx + 2200)

    assert.ok(block.includes("this.partsToBlocks(lastAssistant.parts)"), "must rebuild blocks from server snapshot")
    assert.ok(block.includes("this.replayLiveStreamToWebview(tabId, callbacks)"), "must replay via resumed stream_start")
    assert.ok(!block.includes('type: "force_rerender"'), "reconnect replay must not depend on force_rerender")
  })
})
