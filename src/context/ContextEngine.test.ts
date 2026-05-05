import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ContextEngine.ts"), "utf8")

describe("ContextEngine.ts", () => {
  it("exports GatherConfig interface", () => {
    assert.ok(source.includes("export interface GatherConfig"))
  })

  it("exports ContextPackage interface", () => {
    assert.ok(source.includes("export interface ContextPackage"))
  })

  it("exports ContextEngine class", () => {
    assert.ok(source.includes("export class ContextEngine"))
  })

  it("GatherConfig has mode field", () => {
    assert.ok(source.includes('mode: "basic" | "deep"'))
  })

  it("has gatherContext method", () => {
    assert.ok(source.includes("async gatherContext("))
  })

  it("has gatherOpenFiles private method", () => {
    assert.ok(source.includes("private async gatherOpenFiles("))
  })

  it("has gatherDiagnostics private method", () => {
    assert.ok(source.includes("private gatherDiagnostics("))
  })

  it("has gatherWorkspaceTree private method", () => {
    assert.ok(source.includes("private async gatherWorkspaceTree("))
  })

  it("has gatherGitStatus private method", () => {
    assert.ok(source.includes("private async gatherGitStatus("))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })
})
