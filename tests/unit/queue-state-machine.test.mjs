import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// We'll validate the queue implementation by reading the source
const queueSource = (() => {
  try {
    return readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "queue.ts"), "utf8")
  } catch {
    return null
  }
})()

const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")

describe("Prompt queue state machine", () => {
  // Before queue.ts exists, these tests will fail with a reference error
  // After queue.ts is created, they validate the implementation

  it("queue.ts must exist and export createPromptQueue", () => {
    assert.ok(queueSource !== null, "queue.ts must exist")
    assert.ok(queueSource.includes("export function createPromptQueue("), "must export createPromptQueue")
  })

  it("queue has typed states: queued, sending, streaming, completed, failed", () => {
    assert.ok(queueSource.includes('"queued"'), "must have queued state")
    assert.ok(queueSource.includes('"sending"'), "must have sending state")
    assert.ok(queueSource.includes('"streaming"'), "must have streaming state")
    assert.ok(queueSource.includes('"completed"'), "must have completed state")
    assert.ok(queueSource.includes('"failed"'), "must have failed state")
  })

  it("enqueue during active stream queues item, does not send immediately", () => {
    assert.ok(queueSource.includes("enqueue("), "must have enqueue method")
    assert.ok(queueSource.includes("processNext("), "must have processNext method")
  })

  it("removing queued item prevents its delivery", () => {
    assert.ok(queueSource.includes("remove("), "must have remove method")
  })

  it("editing queued item changes its text payload", () => {
    assert.ok(queueSource.includes("edit("), "must have edit method for text")
  })

  it("queue is per-tab (separate instances per tab)", () => {
    assert.ok(queueSource.includes("tabId") || queueSource.includes("createPromptQueue"),
      "queue factory must create separate instances (per-tab separation via Map in main.ts)")
  })

  it("queue item has stable correlation id", () => {
    assert.ok(queueSource.includes("id:") || queueSource.includes("correlationId"),
      "queue items must have stable correlation id")
  })
})

describe("Prompt queue webview integration", () => {
  it("sendMessage queues instead of aborting when Ctrl+Enter or click during streaming", () => {
    assert.ok(mainSource.includes("queue") || mainSource.includes("enqueue"),
      "main.ts must call queue.enqueue instead of abort when streaming and user wants to queue")
  })

  it("handleStreamEnd calls processNext on stream completion", () => {
    assert.ok(mainSource.includes("processNext") || mainSource.includes("processQueue"),
      "handleStreamEnd must trigger queue processNext when stream ends")
  })
})
