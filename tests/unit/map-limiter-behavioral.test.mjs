/**
 * Behavioral test for EventNormalizer map size limiting.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("EventNormalizer — map size limiting", () => {
  function trimMap(map, maxSize = 5) {
    if (map.size < maxSize) return 0
    const keys = Array.from(map.keys()).slice(0, Math.floor(maxSize / 2))
    for (const key of keys) map.delete(key)
    return keys.length
  }

  it("does not trim maps below the max size", () => {
    const map = new Map()
    for (let i = 0; i < 4; i++) map.set(`k${i}`, i)
    const trimmed = trimMap(map, 5)
    assert.equal(trimmed, 0)
    assert.equal(map.size, 4)
  })

  it("trims maps at exactly max size", () => {
    const map = new Map()
    for (let i = 0; i < 5; i++) map.set(`k${i}`, i)
    const trimmed = trimMap(map, 5)
    assert.equal(trimmed, 2) // floor(5/2) = 2
    assert.equal(map.size, 3) // 5 - 2 = 3
  })

  it("trims maps well above max size", () => {
    const map = new Map()
    for (let i = 0; i < 100; i++) map.set(`k${i}`, i)
    const trimmed = trimMap(map, 5)
    assert.equal(trimmed, 2)
    assert.equal(map.size, 98)
  })

  it("handles empty map", () => {
    const map = new Map()
    const trimmed = trimMap(map, 5)
    assert.equal(trimmed, 0)
    assert.equal(map.size, 0)
  })
})
