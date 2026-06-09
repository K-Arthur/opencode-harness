import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { shouldIncludeStoreActiveFallback } from "./restorablePolicy"

describe("shouldIncludeStoreActiveFallback", () => {
  it("always includes the active session during cold-start hydration", () => {
    assert.equal(shouldIncludeStoreActiveFallback({ hydrating: true, activeHasOpenTab: false }), true)
  })

  it("includes the active session on refresh when it still has an open tab", () => {
    assert.equal(shouldIncludeStoreActiveFallback({ hydrating: false, activeHasOpenTab: true }), true)
  })

  it("does NOT resurrect a closed-but-still-active session on a live refresh", () => {
    assert.equal(shouldIncludeStoreActiveFallback({ hydrating: false, activeHasOpenTab: false }), false)
  })
})
