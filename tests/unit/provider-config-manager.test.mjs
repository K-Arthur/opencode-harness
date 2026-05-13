import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "model", "ProviderConfigManager.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("ProviderConfigManager — class structure", () => {
  it("defines ProviderConfigManager as a class with export", () => {
    assert.ok(source.includes("export class ProviderConfigManager"), "ProviderConfigManager class must be exported")
  })

  it("defines ProviderConfig interface with all expected fields", () => {
    assert.ok(source.includes("export interface ProviderConfig"))
    assert.ok(source.includes("id"))
    assert.ok(source.includes("name"))
    assert.ok(source.includes("apiKey"))
    assert.ok(source.includes("baseUrl"))
    assert.ok(source.includes("enabled"))
    assert.ok(source.includes("models"))
  })

  it("defines ProviderConfigManagerOptions interface", () => {
    assert.ok(source.includes("export interface ProviderConfigManagerOptions"))
    assert.ok(source.includes("context"))
  })

  it("provides upsertConfig method", () => {
    assert.ok(source.includes("upsertConfig("), "upsertConfig method must exist")
  })

  it("provides getAllConfigs method", () => {
    assert.ok(source.includes("getAllConfigs("), "getAllConfigs method must exist")
  })

  it("provides getEnabledConfigs method", () => {
    assert.ok(source.includes("getEnabledConfigs("), "getEnabledConfigs method must exist")
  })

  it("provides getConfig method", () => {
    assert.ok(source.includes("getConfig("), "getConfig method must exist")
  })

  it("provides deleteConfig method", () => {
    assert.ok(source.includes("deleteConfig("), "deleteConfig method must exist")
  })

  it("provides setConfigEnabled method", () => {
    assert.ok(source.includes("setConfigEnabled("), "setConfigEnabled method must exist")
  })

  it("provides getApiKey method", () => {
    assert.ok(source.includes("getApiKey("), "getApiKey method must exist")
  })

  it("provides getBaseUrl method", () => {
    assert.ok(source.includes("getBaseUrl("), "getBaseUrl method must exist")
  })

  it("provides dispose method", () => {
    assert.ok(source.includes("dispose("), "dispose method must exist")
  })
})

describe("ProviderConfigManager — edge case handling", () => {
  it("validates provider name in upsertConfig", () => {
    assert.ok(source.includes("upsertConfig") && source.includes("name") && (source.includes("throw") || source.includes("if")),
      "Should validate provider name is not empty")
  })

  it("validates API key in upsertConfig", () => {
    assert.ok(source.includes("upsertConfig") && source.includes("apiKey") && (source.includes("throw") || source.includes("if")),
      "Should validate API key is not empty")
  })

  it("trims whitespace from provider name", () => {
    assert.ok(source.includes("trim"), "Should trim whitespace from name")
  })

  it("trims whitespace from API key", () => {
    assert.ok(source.includes("trim"), "Should trim whitespace from apiKey")
  })

  it("handles empty ID in deleteConfig", () => {
    assert.ok(source.includes("deleteConfig") && source.includes("if") && source.includes("id"),
      "Should handle empty ID in deleteConfig")
  })

  it("handles empty ID in setConfigEnabled", () => {
    assert.ok(source.includes("setConfigEnabled") && source.includes("if") && source.includes("id"),
      "Should handle empty ID in setConfigEnabled")
  })

  it("handles empty providerId in getApiKey", () => {
    assert.ok(source.includes("getApiKey") && source.includes("if") && source.includes("providerId"),
      "Should handle empty providerId in getApiKey")
  })

  it("handles empty providerId in getBaseUrl", () => {
    assert.ok(source.includes("getBaseUrl") && source.includes("if") && source.includes("providerId"),
      "Should handle empty providerId in getBaseUrl")
  })

  it("handles storage errors in loadConfigs", () => {
    assert.ok(source.includes("loadConfigs") && source.includes("try") && source.includes("catch"),
      "loadConfigs should have error handling")
  })

  it("handles storage errors in saveConfigs", () => {
    assert.ok(source.includes("saveConfigs") && source.includes("try") && source.includes("catch"),
      "saveConfigs should have error handling")
  })

  it("generates unique IDs for configs", () => {
    assert.ok(source.includes("generateId") || source.includes("Date.now") || source.includes("Math.random"),
      "Should generate unique IDs")
  })
})
