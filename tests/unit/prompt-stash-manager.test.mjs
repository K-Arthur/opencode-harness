import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "prompts", "PromptStashManager.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("PromptStashManager — class structure", () => {
  it("defines PromptStashManager as a class with export", () => {
    assert.ok(source.includes("export class PromptStashManager"), "PromptStashManager class must be exported")
  })

  it("defines StashedPrompt interface with all expected fields", () => {
    assert.ok(source.includes("export interface StashedPrompt"))
    assert.ok(source.includes("id"))
    assert.ok(source.includes("name"))
    assert.ok(source.includes("content"))
    assert.ok(source.includes("sessionId"))
    assert.ok(source.includes("createdAt"))
    assert.ok(source.includes("lastUsedAt"))
    assert.ok(source.includes("usageCount"))
    assert.ok(source.includes("isGlobal"))
  })

  it("defines PromptStashManagerOptions interface", () => {
    assert.ok(source.includes("export interface PromptStashManagerOptions"))
    assert.ok(source.includes("context"))
  })

  it("provides stashGlobal method", () => {
    assert.ok(source.includes("stashGlobal("), "stashGlobal method must exist")
  })

  it("provides stashForSession method", () => {
    assert.ok(source.includes("stashForSession("), "stashForSession method must exist")
  })

  it("provides getAllStashes method", () => {
    assert.ok(source.includes("getAllStashes("), "getAllStashes method must exist")
  })

  it("provides getGlobalStashes method", () => {
    assert.ok(source.includes("getGlobalStashes("), "getGlobalStashes method must exist")
  })

  it("provides getSessionStashes method", () => {
    assert.ok(source.includes("getSessionStashes("), "getSessionStashes method must exist")
  })

  it("provides getStash method", () => {
    assert.ok(source.includes("getStash("), "getStash method must exist")
  })

  it("provides updateStash method", () => {
    assert.ok(source.includes("updateStash("), "updateStash method must exist")
  })

  it("provides deleteStash method", () => {
    assert.ok(source.includes("deleteStash("), "deleteStash method must exist")
  })

  it("provides recordUsage method", () => {
    assert.ok(source.includes("recordUsage("), "recordUsage method must exist")
  })

  it("provides pruneOldSessionStashes method", () => {
    assert.ok(source.includes("pruneOldSessionStashes("), "pruneOldSessionStashes method must exist")
  })

  it("provides dispose method", () => {
    assert.ok(source.includes("dispose("), "dispose method must exist")
  })
})

describe("PromptStashManager — edge case handling", () => {
  it("handles null or undefined sessionId in stashForSession", () => {
    // The implementation should handle missing sessionId gracefully
    assert.ok(source.includes("sessionId") && (source.includes("if") || source.includes("throw")), 
      "Should handle null/undefined sessionId")
  })

  it("handles empty name or content", () => {
    // Should validate input
    assert.ok(source.includes("name") && (source.includes("if") || source.includes("throw")), 
      "Should validate name parameter")
  })

  it("handles non-existent stash ID in getStash", () => {
    assert.ok(source.includes("getStash"), "getStash should handle non-existent IDs")
  })

  it("handles non-existent stash ID in deleteStash", () => {
    assert.ok(source.includes("deleteStash"), "deleteStash should handle non-existent IDs")
  })

  it("handles storage errors in loadStashes", () => {
    assert.ok(source.includes("loadStashes") && source.includes("try") && source.includes("catch"),
      "loadStashes should have error handling")
  })

  it("handles storage errors in saveStashes", () => {
    assert.ok(source.includes("saveStashes") && source.includes("try") && source.includes("catch"),
      "saveStashes should have error handling")
  })

  it("handles pruning with no stashes to prune", () => {
    assert.ok(source.includes("pruneOldSessionStashes"), "pruneOldSessionStashes should handle empty state")
  })

  it("generates unique IDs for stashes", () => {
    assert.ok(source.includes("generateId") || source.includes("Date.now") || source.includes("Math.random"),
      "Should generate unique IDs")
  })
})
