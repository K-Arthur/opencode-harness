/**
 * Tests for resolveEventSessionTarget — the fix for multi-session state bleed.
 *
 * Per-session host events (question_asked, context_usage, …) must be attributed
 * to the session they belong to, NOT the session the user happens to be viewing.
 * Precedence: explicit msg.sessionId → envelope sid → active (last resort).
 * The active-session fallback was the bug: a background session's event landed
 * on the viewed tab whenever the explicit id was missing.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveEventSessionTarget } from "./sessionTarget"

const isValid = (s: unknown): s is string => typeof s === "string" && s.length > 0

describe("resolveEventSessionTarget", () => {
  it("prefers the explicit message sessionId", () => {
    assert.equal(resolveEventSessionTarget("explicit", "envelope", "active", isValid), "explicit")
  })

  it("falls back to the envelope sid when explicit is missing/invalid", () => {
    assert.equal(resolveEventSessionTarget(undefined, "envelope", "active", isValid), "envelope")
    assert.equal(resolveEventSessionTarget("", "envelope", "active", isValid), "envelope")
  })

  it("falls back to active only when neither explicit nor envelope is valid", () => {
    assert.equal(resolveEventSessionTarget(undefined, undefined, "active", isValid), "active")
    assert.equal(resolveEventSessionTarget("", "", "active", isValid), "active")
  })

  it("never returns the viewed session when the event names another session", () => {
    // The reported bug: viewing 'A', a 'B' event must resolve to 'B', not 'A'.
    assert.equal(resolveEventSessionTarget("B", undefined, "A", isValid), "B")
    assert.equal(resolveEventSessionTarget(undefined, "B", "A", isValid), "B")
  })

  it("returns null when nothing is resolvable", () => {
    assert.equal(resolveEventSessionTarget(undefined, undefined, null, isValid), null)
  })
})
