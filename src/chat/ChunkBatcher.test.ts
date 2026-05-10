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
})
