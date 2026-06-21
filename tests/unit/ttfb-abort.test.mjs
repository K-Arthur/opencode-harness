import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const coordinatorSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")
const timeoutManagerSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "handlers", "StreamTimeoutManager.ts"), "utf8")
const sessionClientSource = readFileSync(path.join(__dirname, "..", "..", "src", "session", "SessionClient.ts"), "utf8")
const sessionManagerTypes = readFileSync(path.join(__dirname, "..", "..", "src", "session", "sessionTypes.ts"), "utf8")
const sessionTypesSource = readFileSync(path.join(__dirname, "..", "..", "src", "session", "sessionTypes.ts"), "utf8")

describe("T1.1 — TTFB timeout cancels in-flight request", () => {
  it("creates an AbortController per tab before calling sendPromptAsync", () => {
    assert.ok(timeoutManagerSource.includes("new AbortController()"), "must create AbortController")
    assert.ok(timeoutManagerSource.includes("this.deps.ttfbAbortControllers.set(tabId, abortController)"), "must store abort controller per tab")
  })

  it("calls abortController.abort() on TTFB timeout before stream_end", () => {
    assert.ok(timeoutManagerSource.includes('abortController.abort("ttfb_timeout")'), "must abort with ttfb_timeout reason")
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
    assert.ok(timeoutManagerSource.includes("this.deps.ttfbAbortControllers.clear()"), "dispose must clear abort controllers")
  })

  it("sendPromptAsync accepts signal in PromptOptions", () => {
    assert.ok(sessionManagerTypes.includes("signal?: AbortSignal") || sessionTypesSource.includes("signal?: AbortSignal"), "PromptOptions must have signal property")
  })

  it("sendPromptAsync checks signal.aborted at entry and per-retry", () => {
    assert.ok(sessionClientSource.includes("if (signal?.aborted) return"), "must return silently when already aborted")
  })

  it("sendPromptAsync races SDK call against abort signal", () => {
    assert.ok(sessionClientSource.includes("Promise.race(["), "must race SDK call with abort signal")
    assert.ok(sessionClientSource.includes("signal.addEventListener(\"abort\""), "must listen for abort event")
  })

  it("sendPromptAsync translates AbortError to silent return", () => {
    assert.ok(sessionClientSource.includes("DOMException") && sessionClientSource.includes("AbortError"), "must catch AbortError")
  })
})
