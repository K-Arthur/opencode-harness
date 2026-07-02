/**
 * Behavioral tests for createQueueRenderer (JSDOM harness, following the
 * streamOrchestrator.test.ts pattern).
 *
 * RED phase for the 2026-07-02 queue/steer frontend fixes:
 *  1. Alt+Arrow keyboard reorder used to post `reorder_queue` with
 *     fromIndex === toIndex (both computed AFTER the local move) — a host
 *     no-op, so the user's reorder silently reverted on the next queue_state.
 *  2. "Send Now" optimistically removed the item locally; when the host
 *     deferred (busy tab → moveToFront) the chip vanished while the prompt
 *     stayed queued — ghost send later. The webview must not mutate locally;
 *     the host always answers with an authoritative queue_state.
 *  3. The queue hint claimed "auto-sends when current response completes"
 *     even when the session was idle (post-abort / post-reload), where
 *     nothing would ever drain. Idle + queued now shows a paused hint with a
 *     "Send next" button posting resume_queue (host handler already exists).
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createPromptQueue, type PromptQueue } from "./queue"
import { createQueueRenderer, type QueueRendererAPI } from "./queueRenderer"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body>
    <div id="input-area"><div id="input-wrapper"></div></div>
  </body></html>`)
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.KeyboardEvent = dom.window.KeyboardEvent
  // Synchronous rAF so no callback outlives the test (teardown deletes `document`).
  g.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0 }
  // JSDOM has no scrollIntoView; the container keyboard-nav handler calls it.
  ;(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
}

function teardownDom() {
  const g = globalThis as Record<string, unknown>
  delete g.window
  delete g.document
  delete g.HTMLElement
  delete g.KeyboardEvent
  delete g.requestAnimationFrame
}

interface Harness {
  api: QueueRendererAPI
  queue: PromptQueue
  posted: Array<Record<string, unknown>>
  setStreaming: (streaming: boolean) => void
}

function makeHarness(): Harness {
  const posted: Array<Record<string, unknown>> = []
  const promptQueues = new Map<string, PromptQueue>()
  const queue = createPromptQueue()
  promptQueues.set("s1", queue)
  let streaming = false

  const api = createQueueRenderer({
    els: {
      inputArea: document.getElementById("input-area") as HTMLDivElement,
      inputWrapper: document.getElementById("input-wrapper") as HTMLDivElement,
    },
    vscode: {
      getState: <T>() => ({} as T),
      setState: () => {},
      postMessage: (msg: Record<string, unknown>) => { posted.push(msg) },
    },
    stateManager: {
      getActiveSession: () => ({ id: "s1", isStreaming: streaming }),
    },
    promptQueues,
  })

  return { api, queue, posted, setStreaming: (v) => { streaming = v } }
}

function seedQueue(queue: PromptQueue, texts: string[]): void {
  const items = texts.map((text, i) => ({
    id: `qp-${i}`,
    text,
    attachments: [],
    state: "queued" as const,
    createdAt: Date.now(),
    position: i,
  }))
  queue.syncFromHost(items)
}

describe("queueRenderer — keyboard reorder posts real indices", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  it("Alt+ArrowUp posts reorder_queue with fromIndex !== toIndex", () => {
    const h = makeHarness()
    seedQueue(h.queue, ["a", "b", "c"])
    h.api.renderQueue("s1")

    const chip = document.querySelector('.queue-chip[data-queue-id="qp-1"]') as HTMLElement
    assert.ok(chip, "chip for item b must render")
    chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }))

    const reorder = h.posted.find(m => m.type === "reorder_queue")
    assert.ok(reorder, "reorder_queue must be posted")
    assert.equal(reorder!.fromIndex, 1, "fromIndex must be the position BEFORE the move")
    assert.equal(reorder!.toIndex, 0, "toIndex must be the position AFTER the move")
  })

  it("Alt+End posts reorder_queue moving the item to the back", () => {
    const h = makeHarness()
    seedQueue(h.queue, ["a", "b", "c"])
    h.api.renderQueue("s1")

    const chip = document.querySelector('.queue-chip[data-queue-id="qp-0"]') as HTMLElement
    chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", altKey: true, bubbles: true }))

    const reorder = h.posted.find(m => m.type === "reorder_queue")
    assert.ok(reorder, "reorder_queue must be posted")
    assert.equal(reorder!.fromIndex, 0)
    assert.equal(reorder!.toIndex, 2)
  })
})

describe("queueRenderer — Send Now is host-authoritative", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  it("posts send_queue_item WITHOUT locally removing the chip", () => {
    const h = makeHarness()
    seedQueue(h.queue, ["a", "b"])
    h.api.renderQueue("s1")

    const sendBtn = document.querySelector('.queue-chip[data-queue-id="qp-1"] .queue-chip-send') as HTMLButtonElement
    assert.ok(sendBtn, "send-now button must render")
    sendBtn.click()

    assert.ok(h.posted.some(m => m.type === "send_queue_item" && m.itemId === "qp-1"))
    // The item must remain until the host's queue_state answers — the host
    // may have deferred (busy tab → moved to front) instead of sending.
    assert.equal(h.queue.getItems().length, 2, "local queue must not be mutated optimistically")
  })
})

describe("queueRenderer — paused queue hint and Send next", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  it("shows the auto-send hint while the session is streaming", () => {
    const h = makeHarness()
    h.setStreaming(true)
    seedQueue(h.queue, ["a"])
    h.api.renderQueue("s1")

    const hint = document.querySelector(".queue-hint")
    assert.ok(hint, "hint must render")
    assert.match(hint!.textContent || "", /auto-sends/i)
  })

  it("shows a paused hint with a Send next button when the session is idle", () => {
    const h = makeHarness()
    h.setStreaming(false)
    seedQueue(h.queue, ["a"])
    h.api.renderQueue("s1")

    const hint = document.querySelector(".queue-hint")
    assert.ok(hint, "hint must render")
    assert.match(hint!.textContent || "", /paused/i, "idle sessions never auto-drain — the hint must say so")

    const resumeBtn = document.querySelector(".queue-resume-btn") as HTMLButtonElement
    assert.ok(resumeBtn, "Send next button must render when idle with queued items")
    resumeBtn.click()
    assert.ok(
      h.posted.some(m => m.type === "resume_queue" && m.sessionId === "s1"),
      "Send next must post resume_queue"
    )
  })
})
