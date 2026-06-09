import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "model.ts"), "utf8")

describe("model.ts", () => {
  it("exports registerSelectModelCommand", () => {
    assert.ok(source.includes("export function registerSelectModelCommand"))
  })

  it("exports registerSetContextWindowOverrideCommand", () => {
    assert.ok(source.includes("export function registerSetContextWindowOverrideCommand"))
  })

  it("registers opencode-harness.setContextWindowOverride command", () => {
    assert.ok(source.includes('registerCommand("opencode-harness.setContextWindowOverride"'))
  })

  it("validates input is non-negative number", () => {
    assert.ok(source.includes("Must be a non-negative number"))
  })

  it("reads opencode.contextWindowOverride configuration", () => {
    assert.ok(source.includes('getConfiguration("opencode")'))
    assert.ok(source.includes('get<number>("contextWindowOverride"'))
  })

  it("updates global configuration", () => {
    assert.ok(source.includes("ConfigurationTarget.Global"))
  })
})
