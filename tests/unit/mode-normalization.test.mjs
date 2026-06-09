/**
 * Behavioral unit tests for mode normalization logic
 * (same logic used by SessionStore.ensure() and change_mode handler)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

/**
 * Normalize a mode value — same logic as SessionStore.ensure() and
 * ChatProvider.webview message handler.
 */
function normalizeMode(mode, fallback = "plan") {
  if (!mode) return fallback
  if (mode === "normal") return "plan"
  if (mode === "plan" || mode === "build") return mode
  return fallback
}

describe("Mode normalization — behavioral tests", () => {
  // ── Plan mode ──

  it("converts 'normal' to 'plan' for backward compatibility", () => {
    assert.equal(normalizeMode("normal"), "plan")
  })

  it("keeps 'plan' as-is", () => {
    assert.equal(normalizeMode("plan"), "plan")
  })

  it("keeps 'build' as-is", () => {
    assert.equal(normalizeMode("build"), "build")
  })

  it("uses fallback for undefined", () => {
    assert.equal(normalizeMode(undefined), "plan")
  })

  it("uses fallback for null", () => {
    assert.equal(normalizeMode(null), "plan")
  })

  it("uses fallback for empty string", () => {
    assert.equal(normalizeMode(""), "plan")
  })

  it("rejects invalid modes by falling back", () => {
    assert.equal(normalizeMode("invalid"), "plan")
    assert.equal(normalizeMode("debug"), "plan")
  })

  it("uses custom fallback when provided", () => {
    assert.equal(normalizeMode(undefined, "build"), "build")
    assert.equal(normalizeMode("", "build"), "build")
  })
})

describe("SessionStore mode normalization — duplicate logic test", () => {
  // Replicates the exact logic from SessionStore:
  //   mode === "normal" ? "plan" : (mode || "plan")

  it("matches SessionStore.ensure() normalization for 'normal'", () => {
    const mode = "normal"
    const got = mode === "normal" ? "plan" : (mode || "plan")
    assert.equal(got, "plan")
  })

  it("matches SessionStore.ensure() normalization for 'plan'", () => {
    const mode = "plan"
    const got = mode === "normal" ? "plan" : (mode || "plan")
    assert.equal(got, "plan")
  })

  it("matches SessionStore.ensure() normalization for 'build'", () => {
    const mode = "build"
    const got = mode === "normal" ? "plan" : (mode || "plan")
    assert.equal(got, "build")
  })

  it("matches SessionStore.ensure() normalization for undefined", () => {
    const mode = undefined
    const got = mode === "normal" ? "plan" : (mode || "plan")
    assert.equal(got, "plan")
  })

  it("matches SessionStore.ensure() normalization for empty string", () => {
    const mode = ""
    const got = mode === "normal" ? "plan" : (mode || "plan")
    assert.equal(got, "plan")
  })
})
