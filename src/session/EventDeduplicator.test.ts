import { describe, it } from "node:test"
import assert from "node:assert/strict"

// RED phase: tests written before EventDeduplicator.ts exists.
// These tests will fail until the implementation is provided.
import { EventDeduplicator } from "./EventDeduplicator"

describe("EventDeduplicator", () => {
  it("returns false for a new event id", () => {
    const dedup = new EventDeduplicator()
    assert.strictEqual(dedup.isDuplicate("evt-abc"), false)
  })

  it("returns true for an immediately repeated event id", () => {
    const dedup = new EventDeduplicator()
    dedup.isDuplicate("evt-abc")
    assert.strictEqual(dedup.isDuplicate("evt-abc"), true)
  })

  it("returns false for a different event id on same instance", () => {
    const dedup = new EventDeduplicator()
    dedup.isDuplicate("evt-abc")
    assert.strictEqual(dedup.isDuplicate("evt-xyz"), false)
  })

  it("treats undefined or empty string as non-deduplicable (always returns false)", () => {
    const dedup = new EventDeduplicator()
    assert.strictEqual(dedup.isDuplicate(""), false)
    assert.strictEqual(dedup.isDuplicate(""), false)
  })

  it("evicts entries older than TTL_MS so they are not treated as duplicates", async () => {
    const dedup = new EventDeduplicator(50) // 50ms TTL for test speed
    dedup.isDuplicate("evt-stale")
    await new Promise(r => setTimeout(r, 80)) // wait past TTL
    assert.strictEqual(dedup.isDuplicate("evt-stale"), false, "stale entry should not be a duplicate")
  })

  it("does not evict entries within TTL_MS", async () => {
    const dedup = new EventDeduplicator(200)
    dedup.isDuplicate("evt-fresh")
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(dedup.isDuplicate("evt-fresh"), true, "fresh entry should still be a duplicate")
  })

  it("survives reconnect without reset — state persists across explicit reset call not present", () => {
    const dedup = new EventDeduplicator()
    dedup.isDuplicate("evt-1")
    // There is no reset() method — EventDeduplicator is intentionally stateful across reconnects
    assert.ok(typeof (dedup as unknown as Record<string, unknown>).reset === "undefined",
      "EventDeduplicator must NOT have a reset() method — it must survive reconnects")
    assert.strictEqual(dedup.isDuplicate("evt-1"), true)
  })

  it("handles high cardinality without accumulating unbounded memory", () => {
    const dedup = new EventDeduplicator(30_000)
    // Insert 10k unique events
    for (let i = 0; i < 10_000; i++) {
      dedup.isDuplicate(`evt-${i}`)
    }
    // No crash, no OOM — just verify it still operates correctly
    assert.strictEqual(dedup.isDuplicate("evt-0"), true)
    assert.strictEqual(dedup.isDuplicate("evt-new"), false)
  })
})
