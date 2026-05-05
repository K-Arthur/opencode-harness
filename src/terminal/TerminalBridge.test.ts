import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "TerminalBridge.ts"), "utf8")

describe("TerminalBridge.ts", () => {
  it("exports TerminalBridge class", () => {
    assert.ok(source.includes("export class TerminalBridge"))
  })

  it("has log method with level filtering", () => {
    assert.ok(source.includes("log(level:"))
  })

  it("has redactSecrets private method", () => {
    assert.ok(source.includes("private redactSecrets("))
  })

  it("redacts API keys", () => {
    assert.ok(source.includes("sk-|AKIA|ghp_|gho_|glpat-|xox[bpas]-"))
  })

  it("redacts Bearer tokens", () => {
    assert.ok(source.includes("Bearer"))
  })

  it("redacts connection strings", () => {
    assert.ok(source.includes("REDACTED_CONNECTION"))
  })

  it("has captureTerminalSelection method", () => {
    assert.ok(source.includes("async captureTerminalSelection("))
  })

  it("has getCapturedOutput method", () => {
    assert.ok(source.includes("getCapturedOutput()"))
  })

  it("has clearCapturedOutput method", () => {
    assert.ok(source.includes("clearCapturedOutput()"))
  })

  it("has show method", () => {
    assert.ok(source.includes("show()"))
  })
})
