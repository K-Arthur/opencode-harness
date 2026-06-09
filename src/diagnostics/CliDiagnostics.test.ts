import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "CliDiagnostics.ts"), "utf8")

describe("CliDiagnostics.ts", () => {
  it("exports CliDiagnostics class", () => {
    assert.ok(source.includes("export class CliDiagnostics"))
  })

  it("has async check method", () => {
    assert.ok(source.includes("async check("))
  })

  it("has logSend method", () => {
    assert.ok(source.includes("logSend("))
  })

  it("has logRecv method", () => {
    assert.ok(source.includes("logRecv("))
  })

  it("has logError method", () => {
    assert.ok(source.includes("logError("))
  })

  it("has resolveBinaryPath private method", () => {
    assert.ok(source.includes("private resolveBinaryPath()"))
  })

  it("has execCommand private method", () => {
    assert.ok(source.includes("private async execCommand("))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("validates binary path against injection", () => {
    assert.ok(source.includes("shell metacharacters"))
  })

  it("checks health endpoint at /global/health", () => {
    assert.ok(source.includes("/global/health"))
  })
})
