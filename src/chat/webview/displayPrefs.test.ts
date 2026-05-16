import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { getThinkingVisible, setThinkingVisible } from "./displayPrefs"

describe("displayPrefs — thinking visibility (Batch 3a)", () => {
  beforeEach(() => {
    // Reset to default before each test
    setThinkingVisible(true)
  })

  it("defaults thinking visibility to true (the safer/more discoverable default)", () => {
    assert.equal(getThinkingVisible(), true)
  })

  it("setThinkingVisible(false) flips the cached preference", () => {
    setThinkingVisible(false)
    assert.equal(getThinkingVisible(), false)
  })

  it("setThinkingVisible(true) restores the cached preference", () => {
    setThinkingVisible(false)
    setThinkingVisible(true)
    assert.equal(getThinkingVisible(), true)
  })
})
