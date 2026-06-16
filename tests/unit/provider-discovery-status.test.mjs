import { describe, it } from "node:test"
import assert from "node:assert/strict"

function computeProviderStatus({ source, hasLocalKey, hasOauth, envVars }) {
  const isEnvProvider = source === "env" && envVars.length > 0
  if (isEnvProvider && !hasLocalKey) return "connected"
  if (!hasLocalKey && hasOauth) return "needs_oauth"
  if (!hasLocalKey && !hasOauth) return "needs_key"
  return "connected"
}

describe("provider discovery status logic", () => {
  it("marks env providers as connected (not needs_key)", () => {
    const status = computeProviderStatus({
      source: "env",
      hasLocalKey: false,
      hasOauth: false,
      envVars: ["ANTHROPIC_API_KEY"],
    })
    assert.equal(status, "connected", "env providers with env vars should be connected")
  })

  it("marks providers with local API key as connected", () => {
    const status = computeProviderStatus({
      source: "config",
      hasLocalKey: true,
      hasOauth: false,
      envVars: [],
    })
    assert.equal(status, "connected")
  })

  it("marks providers with OAuth available but no key as needs_oauth", () => {
    const status = computeProviderStatus({
      source: "config",
      hasLocalKey: false,
      hasOauth: true,
      envVars: [],
    })
    assert.equal(status, "needs_oauth")
  })

  it("marks providers with no key and no OAuth as needs_key", () => {
    const status = computeProviderStatus({
      source: "config",
      hasLocalKey: false,
      hasOauth: false,
      envVars: [],
    })
    assert.equal(status, "needs_key")
  })

  it("marks api-source providers as connected when they have a key field", () => {
    const status = computeProviderStatus({
      source: "api",
      hasLocalKey: true,
      hasOauth: false,
      envVars: [],
    })
    assert.equal(status, "connected")
  })

  it("marks custom providers without key as needs_key", () => {
    const status = computeProviderStatus({
      source: "custom",
      hasLocalKey: false,
      hasOauth: false,
      envVars: [],
    })
    assert.equal(status, "needs_key")
  })

  it("prefers connected when both key and OAuth are available", () => {
    const status = computeProviderStatus({
      source: "config",
      hasLocalKey: true,
      hasOauth: true,
      envVars: [],
    })
    assert.equal(status, "connected")
  })

  it("handles env provider with no env vars as needing key", () => {
    // Edge case: source is "env" but no env vars listed
    const status = computeProviderStatus({
      source: "env",
      hasLocalKey: false,
      hasOauth: false,
      envVars: [],
    })
    assert.equal(status, "needs_key", "env provider with no env vars should need key")
  })
})
