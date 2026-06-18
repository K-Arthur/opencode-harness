import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ui", "providerPanel.ts"), "utf8")

describe("providerPanel.ts", () => {
  it("exports setupProviderPanel", () => {
    assert.ok(source.includes("export function setupProviderPanel"))
  })

  it("exports openProviderPanel and closeProviderPanel", () => {
    assert.ok(source.includes("export function openProviderPanel"))
    assert.ok(source.includes("export function closeProviderPanel"))
  })

  it("exports renderProviderDiscoveryList", () => {
    assert.ok(source.includes("export function renderProviderDiscoveryList"))
  })

  it("exports renderProviderCredentialList", () => {
    assert.ok(source.includes("export function renderProviderCredentialList"))
  })

  it("exports handleOAuthStarted with polling", () => {
    assert.ok(source.includes("export function handleOAuthStarted"))
    assert.ok(source.includes("oauthPollTimer"), "must poll for OAuth completion")
    assert.ok(source.includes("discover_providers"), "must re-discover providers during polling")
  })

  it("exports handleOAuthCompleted", () => {
    assert.ok(source.includes("export function handleOAuthCompleted"))
  })

  it("has API key modal support", () => {
    assert.ok(source.includes("api-key-modal"), "must reference API key modal")
    assert.ok(source.includes("openApiKeyModal"), "must have openApiKeyModal function")
    assert.ok(source.includes("closeApiKeyModal"), "must have closeApiKeyModal function")
  })

  it("supports tab switching between discover and credentials", () => {
    assert.ok(source.includes("switchTab"), "must have switchTab function")
    assert.ok(source.includes("discover"), "must reference discover tab")
    assert.ok(source.includes("credentials"), "must reference credentials tab")
  })

  it("renders status badges for provider connection states", () => {
    assert.ok(source.includes("STATUS_LABELS"), "must define status labels")
    assert.ok(source.includes("STATUS_CLASSES"), "must define status classes")
    assert.ok(source.includes("Connected"), "must have Connected label")
    assert.ok(source.includes("Needs API Key"), "must have Needs API Key label")
    assert.ok(source.includes("Needs OAuth"), "must have Needs OAuth label")
  })

  it("handles Enter key in API key input", () => {
    assert.ok(source.includes('e.key === "Enter"'), "must handle Enter key")
  })

  it("uses trapFocus for accessibility", () => {
    assert.ok(source.includes("trapFocus"), "must use focus trapping")
  })

  it("has provider search input filtering", () => {
    assert.ok(source.includes("provider-search-input"), "must reference search input element")
    assert.ok(source.includes("filterProviders"), "must have filterProviders function")
    assert.ok(source.includes('addEventListener("input"'), "must listen for input events on search")
  })

  it("caches provider data for search filtering", () => {
    assert.ok(source.includes("cachedProviders"), "must cache providers list")
    assert.ok(source.includes("cachedAuthMethods"), "must cache auth methods")
    assert.ok(source.includes("cachedPostMessage"), "must cache postMessage callback")
  })

  it("clears search input when opening provider panel", () => {
    assert.ok(source.includes('searchInput.value = ""'), "must clear search on open")
    assert.ok(source.includes("searchInput.focus()"), "must focus search input on open")
  })

  it("shows contextual empty message when search has no results", () => {
    assert.ok(source.includes("No providers matching"), "must show search-specific empty message")
  })

  it("skips cache update when rendering filtered results", () => {
    assert.ok(source.includes("skipCache"), "must support skipCache parameter to avoid overwriting cached data during filtering")
  })
})
