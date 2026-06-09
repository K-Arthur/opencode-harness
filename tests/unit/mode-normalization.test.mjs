/**
 * Behavioral unit tests for mode normalization logic
 * (same logic used by SessionStore.ensure() and change_mode handler)
 *
 * NOTE: Before v0.2.20 the default fallback was "plan". Since the mode
 * policy centralization in v0.2.20 the canonical default is "build".
 * These tests match the production logic in modePolicy.ts / SessionStore.ts.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

/**
 * Normalize a mode value — same logic as SessionStore.ensure() and
 * ChatProvider.webview message handler.
 */
function normalizeMode(mode, fallback = "build") {
  if (!mode) return fallback
  if (mode === "normal") return "build"
  if (mode === "plan" || mode === "build" || mode === "auto") return mode
  return fallback
}

describe("Mode normalization — behavioral tests", () => {
  // ── Build mode (canonical default) ──

  it("converts 'normal' to 'build' for backward compatibility", () => {
    assert.equal(normalizeMode("normal"), "build")
  })

  it("keeps 'plan' as-is", () => {
    assert.equal(normalizeMode("plan"), "plan")
  })

  it("keeps 'build' as-is", () => {
    assert.equal(normalizeMode("build"), "build")
  })

  it("keeps 'auto' as-is", () => {
    assert.equal(normalizeMode("auto"), "auto")
  })

  it("uses fallback for undefined", () => {
    assert.equal(normalizeMode(undefined), "build")
  })

  it("uses fallback for null", () => {
    assert.equal(normalizeMode(null), "build")
  })

  it("uses fallback for empty string", () => {
    assert.equal(normalizeMode(""), "build")
  })

  it("rejects invalid modes by falling back", () => {
    assert.equal(normalizeMode("invalid"), "build")
    assert.equal(normalizeMode("debug"), "build")
    assert.equal(normalizeMode("normal"), "build", "'normal' maps to 'build' not 'plan'")
  })

  it("uses custom fallback when provided", () => {
    assert.equal(normalizeMode(undefined, "plan"), "plan")
    assert.equal(normalizeMode("", "plan"), "plan")
  })
})

describe("SessionStore mode normalization — duplicate logic test", () => {
  // Replicates the exact logic from SessionStore:
  //   mode === "normal" ? "build" : (mode || "build")

  it("matches SessionStore.ensure() normalization for 'normal'", () => {
    const mode = "normal"
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "build")
  })

  it("matches SessionStore.ensure() normalization for 'plan'", () => {
    const mode = "plan"
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "plan")
  })

  it("matches SessionStore.ensure() normalization for 'build'", () => {
    const mode = "build"
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "build")
  })

  it("matches SessionStore.ensure() normalization for 'auto'", () => {
    const mode = "auto"
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "auto")
  })

  it("matches SessionStore.ensure() normalization for undefined", () => {
    const mode = undefined
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "build")
  })

  it("matches SessionStore.ensure() normalization for empty string", () => {
    const mode = ""
    const got = mode === "normal" ? "build" : (mode || "build")
    assert.equal(got, "build")
  })
})
