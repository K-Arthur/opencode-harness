import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { ChunkBatcher } from "./ChunkBatcher"

void describe("ChunkBatcher", () => {
  let received: Record<string, unknown>[]
  let batcher: ChunkBatcher

  beforeEach(() => {
    received = []
    batcher = new ChunkBatcher((msg) => { received.push(msg) })
  })

  afterEach(() => {
    batcher.dispose()
  })

  void it("buffers chunks and flushes via delegate", () => {
    batcher.add("session-1", "Hello ")
    batcher.add("session-1", "World")
    batcher.flush()

    assert.equal(received.length, 1)
    assert.equal(received[0]!.type, "stream_chunk")
    assert.equal(received[0]!.sessionId, "session-1")
    assert.equal(received[0]!.text, "Hello World")
  })

  void it("buffers multiple sessions separately", () => {
    batcher.add("s1", "foo")
    batcher.add("s2", "bar")
    batcher.flush()

    assert.equal(received.length, 2)
    const texts = received.map((m) => m.text)
    assert.ok(texts.includes("foo"))
    assert.ok(texts.includes("bar"))
  })

  void it("flush with empty buffer does nothing", () => {
    batcher.flush()
    assert.equal(received.length, 0)
  })

  void it("clear discards buffered data", () => {
    batcher.add("s1", "data")
    batcher.clear()
    batcher.flush()
    assert.equal(received.length, 0)
  })

  void it("dispose flushes pending chunks", () => {
    batcher.add("s1", "pending")
    batcher.dispose()
    assert.equal(received.length, 1)
    assert.equal(received[0]!.text, "pending")
  })

  void it("forwards messageId from add() to flushed delegate", () => {
    batcher.add("s1", "hello", "msg_abc")
    batcher.add("s1", " world", "msg_abc")
    batcher.flush()
    assert.equal(received.length, 1)
    assert.equal(received[0]!.messageId, "msg_abc")
    assert.equal(received[0]!.text, "hello world")
  })

  void it("uses latest messageId per session when it changes mid-batch", () => {
    batcher.add("s1", "a", "msg_old")
    batcher.add("s1", "b", "msg_new")
    batcher.flush()
    assert.equal(received[0]!.messageId, "msg_new")
  })

  void it("flushes an existing session batch when configured size limit is exceeded", () => {
    batcher.dispose()
    received = []
    batcher = new ChunkBatcher((msg) => { received.push(msg) }, undefined, { maxBatchSize: 5 })

    batcher.add("s1", "1234")
    batcher.add("s1", "56")
    batcher.flush()

    assert.equal(received.length, 2)
    assert.equal(received[0]!.text, "1234")
    assert.equal(received[1]!.text, "56")
  })

  void it("retains buffered chunks when delegate returns false", () => {
    batcher.dispose()
    received = []
    let accepting = false
    batcher = new ChunkBatcher((msg) => {
      if (!accepting) return false
      received.push(msg)
      return true
    })

    batcher.add("s1", "retry me")
    batcher.flush()
    assert.equal(received.length, 0)

    accepting = true
    batcher.flush()
    assert.equal(received.length, 1)
    assert.equal(received[0]!.text, "retry me")
  })

  void it("uses adaptive high-velocity flush timing", () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const delays: number[] = []
    ;(globalThis as any).setTimeout = (_fn: () => void, ms?: number) => {
      delays.push(Number(ms))
      return 1
    }
    ;(globalThis as any).clearTimeout = () => {}

    try {
      batcher.dispose()
      let now = 0
      batcher = new ChunkBatcher((msg) => { received.push(msg) }, undefined, {
        now: () => now,
        minFlushMs: 35,
        maxFlushMs: 150,
      })
      batcher.add("s1", "x".repeat(500))
      assert.ok(delays.some((delay) => delay >= 100), "high velocity chunks should schedule a longer flush")
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})
