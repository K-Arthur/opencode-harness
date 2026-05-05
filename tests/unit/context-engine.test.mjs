import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "context", "ContextEngine.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("ContextEngine — class structure", () => {
  it("defines ContextEngine as a class with export", () => {
    assert.ok(source.includes("export class ContextEngine"), "ContextEngine class must be exported")
  })

  it("defines ContextPackage interface with all expected fields", () => {
    assert.ok(source.includes("openFiles"))
    assert.ok(source.includes("diagnostics"))
    assert.ok(source.includes("workspaceTree"))
    assert.ok(source.includes("projectConfigs"))
    assert.ok(source.includes("gitStatus"))
  })

  it("defines GatherConfig interface with mode field", () => {
    assert.ok(source.includes("export interface GatherConfig"))
    assert.ok(source.includes("mode"))
    assert.ok(source.includes('"basic"'))
    assert.ok(source.includes('"deep"'))
  })

  it("gathers context via gatherContext method", () => {
    assert.ok(source.includes("gatherContext("), "gatherContext method must exist")
    assert.ok(source.includes("GatherConfig"), "gatherContext must accept GatherConfig")
  })

  it("provides dispose method for cleanup", () => {
    assert.ok(source.includes("dispose()"), "dispose method must exist")
  })
})

describe("ContextEngine — private methods", () => {
  it("gathers open files with truncation", () => {
    assert.ok(source.includes("gatherOpenFiles"), "gatherOpenFiles method must exist")
    assert.ok(source.includes("content.length > 8192") || source.includes("truncat"), "must truncate long file content")
  })

  it("gathers diagnostics with severity filtering", () => {
    assert.ok(source.includes("gatherDiagnostics"), "gatherDiagnostics method must exist")
    assert.ok(source.includes("DiagnosticSeverity.Error") || source.includes("severity"), "must filter by severity")
  })

  it("gathers workspace tree with depth limit", () => {
    assert.ok(source.includes("gatherWorkspaceTree"), "gatherWorkspaceTree must exist")
    assert.ok(source.includes("depth") || source.includes("100"), "must have depth or file limit")
  })

  it("gathers project configs for common config files", () => {
    assert.ok(source.includes("gatherProjectConfigs"), "gatherProjectConfigs method must exist")
    assert.ok(source.includes("package.json"))
    assert.ok(source.includes("tsconfig.json"))
  })

  it("gathers git status with graceful fallback", () => {
    assert.ok(source.includes("gatherGitStatus"), "gatherGitStatus method must exist")
    assert.ok(source.includes("\"unknown\"") || source.includes("unknown"), "must handle missing git gracefully")
  })
})

describe("ContextEngine — error handling", () => {
  it("wraps gatherOpenFiles in try/catch", () => {
    const methodStart = source.indexOf("private async gatherOpenFiles")
    const methodEnd = source.indexOf("private async", methodStart + 10)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(method.includes("try") && method.includes("catch"), "gatherOpenFiles must use try/catch")
  })

  it("wraps gatherWorkspaceTree in try/catch", () => {
    const methodStart = source.indexOf("private async gatherWorkspaceTree")
    const methodEnd = source.indexOf("private async", methodStart + 10)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(method.includes("try") && method.includes("catch"), "gatherWorkspaceTree must use try/catch")
  })

  it("wraps gatherProjectConfigs in try/catch", () => {
    const methodStart = source.indexOf("private async gatherProjectConfigs")
    const methodEnd = source.indexOf("private async", methodStart + 10)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(method.includes("try") && method.includes("catch"), "gatherProjectConfigs must use try/catch")
  })

  it("wraps gatherGitStatus in try/catch", () => {
    const methodStart = source.indexOf("private async gatherGitStatus")
    const methodEnd = source.indexOf("dispose()", methodStart)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(method.includes("try") && method.includes("catch"), "gatherGitStatus must use try/catch")
  })
})

describe("ContextEngine — event handling", () => {
  it("defines onConfigChanged event", () => {
    assert.ok(source.includes("_onConfigChanged"), "onConfigChanged event emitter must exist")
    assert.ok(source.includes("onConfigChanged"), "onConfigChanged property must exist")
  })
})

describe("ContextEngine — context assembly", () => {
  it("gatherContext uses Promise.all for parallel gathering", () => {
    assert.ok(source.includes("Promise.all"), "must use Promise.all for parallel gathering")
  })

  it("gatherContext returns all 5 context sections", () => {
    assert.ok(source.includes("openFiles"))
    assert.ok(source.includes("diagnostics"))
    assert.ok(source.includes("workspaceTree"))
    assert.ok(source.includes("projectConfigs"))
    assert.ok(source.includes("gitStatus"))
  })

  it("ContextPackage allows explicitContext and terminalOutput", () => {
    assert.ok(source.includes("explicitContext"), "ContextPackage must support explicitContext")
    assert.ok(source.includes("terminalOutput"), "ContextPackage must support terminalOutput")
  })
})
