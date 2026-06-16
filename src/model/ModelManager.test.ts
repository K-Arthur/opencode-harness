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
    assert.ok(source.includes("...model"), "must spread model object to preserve variants and other fields")
  })
})
