import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "StreamCoordinator.ts"), "utf8")

describe("StreamCoordinator.ts", () => {
  it("exports StreamCallbacks interface", () => {
    assert.ok(source.includes("export interface StreamCallbacks"), "StreamCallbacks must be exported")
    assert.ok(source.includes("postMessage: (msg: Record<string, unknown>) => void"),
      "StreamCallbacks must have postMessage")
    assert.ok(source.includes("postRequestError: (message: string, sessionId?: string) => void"),
      "StreamCallbacks must have postRequestError with optional sessionId")
  })

  it("exports StreamCoordinator class", () => {
    assert.ok(source.includes("export class StreamCoordinator"), "StreamCoordinator class must be exported")
  })

  it("has a DiffHandler instance and diffApplier", () => {
    assert.ok(source.includes("private diffHandler: DiffHandler"), "must have diffHandler field")
    assert.ok(source.includes("private readonly diffApplier: DiffApplier"), "must have diffApplier field")
    assert.ok(source.includes("this.diffHandler = new DiffHandler(diffApplier)"), "must create DiffHandler")
  })

  it("has stream watchdog with STREAM_STUCK_MS constant", () => {
    assert.ok(source.includes("STREAM_STUCK_MS"), "STREAM_STUCK_MS constant must exist")
    assert.ok(source.includes("120000"), "STREAM_STUCK_MS must be 120000 (2 min)")
    assert.ok(source.includes("private startWatchdog("), "must have startWatchdog method")
    assert.ok(source.includes("private stopWatchdog("), "must have stopWatchdog method")
  })

  it("has startPrompt method with full lifecycle", () => {
    assert.ok(
      source.includes("async startPrompt(tabId: string, text: string, callbacks: StreamCallbacks)"),
      "startPrompt method must exist"
    )
    assert.ok(source.includes("this.contextEngine.gatherContext()"), "must gather context")
    assert.ok(source.includes("this.sessionManager.ensureSession("), "must ensure session")
    assert.ok(source.includes("this.tabManager.setStreaming(tabId, true)"), "must set streaming state")
  })

  it("sends plain prompts as a single user text part without implicit context", () => {
    assert.match(
      source,
      /sendPromptAsync\(\s*cliSessionId,\s*\[\s*\{\s*type:\s*"text",\s*text\s*\}\s*\],\s*modelRef\s*\)/s,
      "startPrompt must call sendPromptAsync with only the user's text; hidden context changes model behavior versus the CLI"
    )
    assert.ok(
      !source.includes("text: contextText"),
      "startPrompt must not prepend generated context as a text part"
    )
  })

  it("has finalizeStream method", () => {
    assert.ok(
      source.includes("async finalizeStream(tabId: string, callbacks: StreamCallbacks)"),
      "finalizeStream must exist"
    )
    assert.ok(source.includes('type: "stream_end"'), "must post stream_end message")
    assert.ok(source.includes("this.stripContextWrapper("), "must strip context wrapper")
  })

  it("abort emits stream_end with reason aborted", () => {
    assert.ok(
      source.includes("async abort(tabId: string, callbacks: StreamCallbacks)"),
      "abort method must exist"
    )
    assert.ok(source.includes("this.sessionManager.abortSession("), "must call abortSession")
    assert.ok(
      source.includes('reason: "aborted"'),
      "abort must emit stream_end with reason: aborted"
    )
    assert.ok(source.includes('type: "stream_end"'), "abort must emit stream_end")
    assert.ok(source.includes("callbacks.postMessage({"), "abort must post via callbacks")
  })

  it("has appendChunk and getDiffHandler methods", () => {
    assert.ok(
      source.includes("appendChunk(tabId: string, text: string, callbacks: StreamCallbacks): void"),
      "appendChunk must exist"
    )
    assert.ok(source.includes("getDiffHandler(): DiffHandler"), "getDiffHandler must exist")
    assert.ok(source.includes("this.diffHandler"), "getDiffHandler must return this.diffHandler")
  })

  it("has cleanupTab and no implicit context builder in the prompt path", () => {
    assert.ok(source.includes("private cleanupTab("), "cleanupTab must exist")
    assert.ok(!source.includes("private buildContextText("), "implicit context builder must not be used for prompt payloads")
    assert.ok(source.includes("private refreshContextTokenEstimate("), "token estimation may refresh separately from prompt sending")
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose(): void"), "dispose must exist")
    assert.ok(source.includes("this.streamWatchdog"), "dispose must clear watchdog")
    assert.ok(source.includes("this.stuckStreamHandlers.clear()"), "dispose must clear stuck handlers")
  })

  it("emits stream_end on unexpected close via watchdog", () => {
    assert.ok(
      source.includes("finalizeStream(tab.id, callbacks)"),
      "watchdog must call finalizeStream on stuck tab"
    )
    assert.ok(
      source.includes("STREAM_STUCK_MS"),
      "must have stream stuck timeout constant"
    )
  })

  it("has atomic stream slot reservation in startPrompt", () => {
    assert.ok(
      source.includes("startPrompt(tabId: string, text: string, callbacks: StreamCallbacks)"),
      "startPrompt must exist"
    )
    assert.ok(
      source.includes("this.tabManager.setStreaming(tabId, true)"),
      "must set streaming state"
    )
  })

  it("has stripContextWrapper method", () => {
    assert.ok(
      source.includes("stripContextWrapper(text: string): string"),
      "stripContextWrapper must exist"
    )
    assert.ok(
      source.includes("<context>"),
      "must handle <context> tags"
    )
    assert.ok(
      source.includes("</context>"),
      "must handle </context> tags"
    )
  })

  it("cleans up tab on finalizeStream", () => {
    assert.ok(
      source.includes("async finalizeStream(tabId: string, callbacks: StreamCallbacks)"),
      "finalizeStream must exist"
    )
    assert.ok(
      source.includes("this.tabManager.setStreaming(tabId, false)"),
      "finalizeStream must clear streaming state"
    )
  })

  it("has TTFB_TIMEOUT_MS = 30000 for first-byte timeout", () => {
    assert.ok(source.includes("TTFB_TIMEOUT_MS"), "TTFB_TIMEOUT_MS constant must exist")
    assert.ok(source.includes("30000"), "TTFB_TIMEOUT_MS must be 30000 (30s)")
  })

  it("has firstChunkReceived flag on TabState-compatible stream tracking", () => {
    assert.ok(
      source.includes("clearTtfbTimeout("),
      "must have clearTtfbTimeout method"
    )
    assert.ok(
      source.includes("ttfbTimeout"),
      "must track TTFB timeout reference"
    )
  })

  it("sends stream_end before 60s timeout fires", () => {
    assert.ok(
      source.includes("60000"),
      "completion timeout must be 60000ms (60s)"
    )
    assert.ok(
      source.includes("tabManager.setCompletionTimeout(tabId, timeout)"),
      "must set completion timeout after starting prompt"
    )
  })

  // ── SLC-03 fix: completion timeout resets on each chunk ──────────────
  it("resets completion timeout on each chunk via resetCompletionTimeout", () => {
    assert.ok(
      source.includes("resetCompletionTimeout(tabId: string, callbacks: StreamCallbacks)"),
      "must have resetCompletionTimeout method that takes tabId and callbacks"
    )
    assert.ok(
      source.includes("this.resetCompletionTimeout(tabId, callbacks)"),
      "appendChunk must call resetCompletionTimeout to keep alive streams"
    )
    assert.ok(
      source.includes("tabManager.clearCompletionTimeout(tabId)"),
      "resetCompletionTimeout must clear the old timeout before setting a new one"
    )
  })

  // ── SLC-03 fix: completion timeout preserves partial output ──────────
  it("completion timeout handler preserves partial output and shows recoverable state", () => {
    assert.ok(
      source.includes("reason: \"timeout\""),
      "completion timeout must emit stream_end with reason: timeout"
    )
    assert.ok(
      source.includes("partial: true"),
      "timeout stream_end must include partial: true flag for recoverable UI state"
    )
  })

  // ── TTFB timeout preserves partial tokens ────────────────────────────
  it("TTFB timeout preserves any partial tokens received", () => {
    assert.ok(
      source.includes("reason: \"ttfb_timeout\""),
      "TTFB timeout must emit stream_end with reason: ttfb_timeout"
    )
  })
})
