import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  selectDisplayedUsage,
  shouldRefreshOnUpdate,
} from "./tokenDisplayPolicy"
import type { SessionState } from "./types"

function mkSession(id: string, partial: Partial<SessionState> = {}): SessionState {
  return {
    id,
    name: `Session ${id}`,
    model: "anthropic/claude-sonnet-4-5-20250514",
    mode: "build",
    messages: [],
    isStreaming: false,
    ...partial,
  }
}

describe("tokenDisplayPolicy", () => {
  describe("shouldRefreshOnUpdate", () => {
    it("returns true when the updated session is the active tab", () => {
      assert.equal(shouldRefreshOnUpdate("A", "A"), true)
    })

    it("returns false when a background tab updated", () => {
      assert.equal(shouldRefreshOnUpdate("B", "A"), false)
    })

    it("returns false when activeSessionId is null/undefined", () => {
      assert.equal(shouldRefreshOnUpdate("A", null), false)
      assert.equal(shouldRefreshOnUpdate("A", undefined), false)
    })

    it("returns false on empty session id", () => {
      assert.equal(shouldRefreshOnUpdate("", "A"), false)
    })
  })

  describe("selectDisplayedUsage", () => {
    it("returns null when there is no active session", () => {
      const sessions = { A: mkSession("A", { tokenUsage: { prompt: 1, completion: 1, total: 2 } }) }
      assert.equal(selectDisplayedUsage(sessions, null), null)
    })

    it("returns null when the active session has no token usage yet", () => {
      const sessions = { A: mkSession("A") }
      assert.equal(selectDisplayedUsage(sessions, "A"), null)
    })

    it("returns the active session's usage when present, regardless of other sessions", () => {
      const sessions = {
        A: mkSession("A", { tokenUsage: { prompt: 10, completion: 5, total: 15 }, cost: 0.01 }),
        B: mkSession("B", { tokenUsage: { prompt: 99, completion: 99, total: 198 }, cost: 9.99 }),
      }
      const result = selectDisplayedUsage(sessions, "A")
      assert.ok(result, "expected a result for the active session")
      assert.equal(result.sessionId, "A")
      assert.equal(result.usage.total, 15)
      assert.equal(result.cost, 0.01)
      assert.equal(result.model, "anthropic/claude-sonnet-4-5-20250514")
    })

    it("two sessions accumulate independently without leaking into each other's display", () => {
      const sessions: Record<string, SessionState> = {
        A: mkSession("A", { tokenUsage: { prompt: 100, completion: 50, total: 150 }, cost: 0.02 }),
        B: mkSession("B", { tokenUsage: { prompt: 200, completion: 100, total: 300 }, cost: 0.04 }),
      }
      const active = selectDisplayedUsage(sessions, "A")
      assert.equal(active?.usage.total, 150)

      const switched = selectDisplayedUsage(sessions, "B")
      assert.equal(switched?.usage.total, 300)
    })

    it("when a background tab streams, the active tab's displayed value is unaffected", () => {
      // Simulate B streaming while A is active: B's tokenUsage grows, but
      // selectDisplayedUsage("A") still reports A's frozen value.
      const sessions: Record<string, SessionState> = {
        A: mkSession("A", { tokenUsage: { prompt: 10, completion: 0, total: 10 } }),
        B: mkSession("B", { tokenUsage: { prompt: 0, completion: 0, total: 0 } }),
      }
      const before = selectDisplayedUsage(sessions, "A")
      // background-tab accumulate
      sessions.B!.tokenUsage = { prompt: 1000, completion: 500, total: 1500 }
      const after = selectDisplayedUsage(sessions, "A")
      assert.equal(before?.usage.total, 10)
      assert.equal(after?.usage.total, 10)
    })
  })
})
