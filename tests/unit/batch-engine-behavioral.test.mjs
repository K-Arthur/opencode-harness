import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

const { BatchEngine } = await import("../../src/chat/BatchEngine.js")

void describe("BatchEngine behavioral", () => {
  let received
  let engine

  beforeEach(() => {
    received = []
    engine = new BatchEngine(
      (existing, value) => [...(existing ?? []), value],
      (key, values) => { received.push({ key, values }); return true },
      undefined,
      { flushMs: 1000, maxBatchSize: 10 },
    )
  })

  afterEach(() => {
    engine.dispose()
  })

  void it("adds items and flushes them via delegate", () => {
    engine.add("k1", "a")
    engine.add("k1", "b")
    engine.flush()
    assert.equal(received.length, 1)
    assert.equal(received[0].key, "k1")
    assert.deepEqual(received[0].values, ["a", "b"])
  })

  void it("buffers multiple keys separately", () => {
    engine.add("k1", "x")
    engine.add("k2", "y")
    engine.flush()
    assert.equal(received.length, 2)
    const keys = received.map((r) => r.key).sort()
    assert.deepEqual(keys, ["k1", "k2"])
  })

  void it("flush with empty buffer does nothing", () => {
    engine.flush()
    assert.equal(received.length, 0)
  })

  void it("clearing discards buffered data", () => {
    engine.add("k1", "data")
    engine.clear()
    engine.flush()
    assert.equal(received.length, 0)
  })

  void it("dispose flushes pending data", () => {
    engine.add("k1", "pending")
    engine.dispose()
    assert.equal(received.length, 1)
    assert.equal(received[0].key, "k1")
  })

  void it("retains entries when flushEach returns false", () => {
    let accepting = false
    const localReceived = []
    const localEngine = new BatchEngine(
      (existing, value) => [...(existing ?? []), value],
      (key, values) => {
        if (!accepting) return false
        localReceived.push({ key, values })
        return true
      },
    )
    localEngine.add("k1", "retry me")
    localEngine.flush()
    assert.equal(localReceived.length, 0)

    accepting = true
    localEngine.flush()
    assert.equal(localReceived.length, 1)
    assert.equal(localReceived[0].key, "k1")
    localEngine.dispose()
  })

  void it("supports maxBatchSize trigger flush", () => {
    const smallEngine = new BatchEngine(
      (existing, value) => [...(existing ?? []), value],
      (key, values) => { received.push({ key, values }); return true },
      undefined,
      { maxBatchSize: 2 },
    )
    smallEngine.add("k1", "a")
    assert.equal(received.length, 0)
    smallEngine.add("k2", "b")
    assert.equal(received.length, 2, "buffer size >= maxBatchSize should auto-flush (one call per key)")
    smallEngine.dispose()
  })

  void it("exposes size and has methods", () => {
    assert.equal(engine.size, 0)
    engine.add("k1", "a")
    assert.equal(engine.size, 1)
    assert.ok(engine.has("k1"))
    assert.ok(!engine.has("k2"))
    engine.flush()
    assert.equal(engine.size, 0)
  })

  void it("flush fires exactly once per key", () => {
    engine.add("k1", "a")
    engine.add("k1", "b")
    engine.add("k2", "c")
    engine.flush()
    assert.equal(received.length, 2)
    const k1Entry = received.find((r) => r.key === "k1")
    assert.ok(k1Entry)
    assert.deepEqual(k1Entry.values, ["a", "b"])
  })
})
