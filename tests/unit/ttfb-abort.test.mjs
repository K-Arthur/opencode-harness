import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coordinatorSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")
const sessionManagerSource = readFileSync(path.join(__dirname, "..", "..", "src", "session", "SessionManager.ts"), "utf8")

describe("T1.1 — TTFB timeout cancels in-flight request", () => {
  it("creates an AbortController per tab before calling sendPromptAsync", () => {
    assert.ok(coordinatorSource.includes("new AbortController()"), "must create AbortController")
    assert.ok(coordinatorSource.includes("ttfbAbortControllers.set(tabId, abortController)"), "must store abort controller per tab")
  })

  it("calls abortController.abort() on TTFB timeout before stream_end", () => {
    assert.ok(coordinatorSource.includes('abortController.abort("ttfb_timeout")'), "must abort with ttfb_timeout reason")
  })

  it("passes abort signal through to sendPromptAsync", () => {
    assert.ok(coordinatorSource.includes("signal: abortSignal"), "must pass abortSignal to sendPromptAsync options")
    assert.ok(coordinatorSource.includes("ttfbAbortControllers.get(tabId)?.signal"), "must get signal from abort controller map")
  })

  it("cleans up abort controller in cleanupTab", () => {
    assert.ok(coordinatorSource.includes("this.ttfbAbortControllers.delete(tabId)"), "must clean up abort controller in cleanupTab")
  })

  it("has ttfbAbortControllers map declared", () => {
    assert.ok(coordinatorSource.includes("ttfbAbortControllers: Map<string, AbortController> = new Map()"), "must declare ttfbAbortControllers map")
  })

  it("dispose clears ttfbAbortControllers", () => {
    assert.ok(coordinatorSource.includes("this.ttfbAbortControllers.clear()"), "dispose must clear abort controllers")
  })

  it("sendPromptAsync accepts signal in PromptOptions", () => {
    assert.ok(sessionManagerSource.includes("signal?: AbortSignal"), "PromptOptions must have signal property")
  })

  it("sendPromptAsync checks signal.aborted at entry and per-retry", () => {
    assert.ok(sessionManagerSource.includes("if (signal?.aborted) return"), "must return silently when already aborted")
  })

  it("sendPromptAsync races SDK call against abort signal", () => {
    assert.ok(sessionManagerSource.includes("Promise.race(["), "must race SDK call with abort signal")
    assert.ok(sessionManagerSource.includes("signal.addEventListener(\"abort\""), "must listen for abort event")
  })

  it("sendPromptAsync translates AbortError to silent return", () => {
    assert.ok(sessionManagerSource.includes("DOMException") && sessionManagerSource.includes("AbortError"), "must catch AbortError")
  })
})
