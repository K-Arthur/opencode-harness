import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ContextMonitor.ts"), "utf8")

describe("ContextMonitor.ts", () => {
  it("exports ContextUsage interface", () => {
    assert.ok(source.includes("export interface ContextUsage"))
  })

  it("exports ContextMonitor class", () => {
    assert.ok(source.includes("export class ContextMonitor"))
  })

  it("ContextUsage has percent, tokens, maxTokens", () => {
    assert.ok(source.includes("percent: number"))
    assert.ok(source.includes("tokens: number"))
    assert.ok(source.includes("maxTokens: number"))
  })

  it("has onContextChanged event", () => {
    assert.ok(source.includes("onContextChanged"))
  })

  it("has updateTokens method", () => {
    assert.ok(source.includes("updateTokens("))
  })

  it("has showWarning method", () => {
    assert.ok(source.includes("showWarning("))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("uses token limit of 100000", () => {
    assert.ok(source.includes("100000"))
  })

  it("has setTokenLimit method", () => {
    assert.ok(source.includes("setTokenLimit("))
  })

  it("reads autoCompact setting", () => {
    assert.ok(source.includes("autoCompact"))
  })

  it("has getAutoCompactSetting method", () => {
    assert.ok(source.includes("getAutoCompactSetting("))
  })
})
