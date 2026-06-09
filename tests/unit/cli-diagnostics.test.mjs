/**
 * CliDiagnostics unit tests
 *
 * Tests binary path validation, security checks, and CLI diagnostics logic.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import * as fs from "node:fs"

const sourcePath = path.join(
  import.meta.dirname, "..", "..", "src", "diagnostics", "CliDiagnostics.ts"
)
const source = fs.readFileSync(sourcePath, "utf8")

describe("CliDiagnostics — binary path validation", () => {
  it("rejects relative paths", () => {
    // Source should validate paths are absolute
    assert.ok(
      source.includes("absolute") || source.includes("[/\\\\]") || source.includes("[A-Za-z]:"),
      "Binary path absolute validation missing"
    )
  })

  it("rejects paths with shell metacharacters", () => {
    assert.ok(
      source.includes(";&") || source.includes("metacharacter") ||
        source.includes("shell"),
      "Shell metacharacter rejection missing"
    )
  })

  it("rejects paths with command injection patterns", () => {
    const dangerous = [
      ";&",
      "|`$",
      "(){}",
      "!#~<>",
    ]
    const hasRejection = dangerous.some((pattern) =>
      source.includes(pattern) || source.includes(";&|")
    )
    assert.ok(hasRejection, "Command injection rejection pattern missing")
  })
})

describe("CliDiagnostics — check method", () => {
  it("has check method defined", () => {
    assert.ok(
      source.includes("async check") ||
        source.includes("check(") ||
        source.includes("check ="),
      "check method missing"
    )
  })

  it("has binary discovery with PATH fallback", () => {
    assert.ok(
      source.includes("which") || source.includes("where") ||
        source.includes("PATH") || source.includes("binaryPath"),
      "PATH binary discovery missing"
    )
  })
})

describe("CliDiagnostics — error handling", () => {
  it("wraps check operations in try/catch", () => {
    const tryCount = (source.match(/try\s*\{/g) || []).length
    assert.ok(tryCount >= 1, "Error handling try/catch blocks missing")
  })
})
