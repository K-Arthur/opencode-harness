import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ModelManager.ts"), "utf8")

describe("ModelManager.ts", () => {
  it("exports ModelInfo interface", () => {
    assert.ok(source.includes("export interface ModelInfo"))
  })

  it("exports ModelManager class", () => {
    assert.ok(source.includes("export class ModelManager"))
  })

  it("ModelInfo has id, provider, displayName", () => {
    assert.ok(source.includes("id: string"))
    assert.ok(source.includes("provider: string"))
    assert.ok(source.includes("displayName: string"))
  })

  it("has model getter", () => {
    assert.ok(source.includes("get model():"))
  })

  it("has models getter", () => {
    assert.ok(source.includes("get models():"))
  })

  it("has setModel method", () => {
    assert.ok(source.includes("setModel("))
  })

  it("has refreshModels method", () => {
    assert.ok(source.includes("async refreshModels("))
  })

  it("has fetchModelsFromServer private method", () => {
    assert.ok(source.includes("private async fetchModelsFromServer("))
  })

  it("has fetchModelsFromCli private method", () => {
    assert.ok(source.includes("private async fetchModelsFromCli("))
  })

  it("has pickModel method", () => {
    assert.ok(source.includes("async pickModel("))
  })

  it("has loadCachedModels method", () => {
    assert.ok(source.includes("loadCachedModels("))
  })

  it("has saveCachedModels method", () => {
    assert.ok(source.includes("saveCachedModels("))
  })

  it("caches models to globalState", () => {
    assert.ok(source.includes("globalState"))
  })

  it("groups models by provider in pickModel", () => {
    assert.ok(source.includes("Separator") || source.includes("grouped"))
  })

  it("ModelInfo has variantNames field", () => {
    assert.ok(source.includes("variantNames?: string[]"))
  })

  it("extracts variant names from server model variants object", () => {
    assert.ok(source.includes("Object.keys(m.variants)"), "must read variant keys from server response")
  })

  it("filters disabled variants", () => {
    assert.ok(source.includes("v.disabled !== true"), "must exclude variants with disabled=true")
  })

  it("preserves model fields when spreading from object-map models", () => {
    assert.ok(source.includes("...m"), "must spread model object to preserve variants and other fields")
  })

  it("persists recent models to globalState", () => {
    assert.ok(source.includes("_recentModels"), "must track recent models in-memory")
    assert.ok(source.includes("opencode-harness.recentModels"), "must persist recent models to globalState")
    assert.ok(source.includes("RECENT_MODELS_CAP"), "must cap recent models")
  })

  it("has touchRecentModel method that dedupes and caps", () => {
    assert.ok(source.includes("touchRecentModel("), "must expose touchRecentModel")
    assert.ok(source.includes("this._recentModels.indexOf(modelId)"), "must dedupe existing entries")
    assert.ok(source.includes("this._recentModels.unshift(modelId)"), "must prepend new entries")
    assert.ok(source.includes("this._recentModels.splice(ModelManager.RECENT_MODELS_CAP)"), "must cap at RECENT_MODELS_CAP")
  })

  it("has getRecentModels getter", () => {
    assert.ok(source.includes("getRecentModels("), "must expose getRecentModels")
  })

  it("savePreferences persists favorites, disabled, and recent models", () => {
    assert.ok(source.includes("private savePreferences("), "must have savePreferences")
    assert.ok(source.includes("opencode-harness.favoriteModels"), "must persist favorites")
    assert.ok(source.includes("opencode-harness.disabledModels"), "must persist disabled")
    assert.ok(source.includes("opencode-harness.recentModels"), "must persist recents")
  })

  it("safeReadStringArray provides malformed-state fallback", () => {
    assert.ok(source.includes("safeReadStringArray("), "must have safeReadStringArray helper")
    assert.ok(source.includes("Malformed state at"), "must log malformed state warnings")
    assert.ok(source.includes("filter((v): v is string =>"), "must filter non-string entries")
  })
})
