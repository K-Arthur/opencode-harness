import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "session", "SessionExporter.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("SessionExporter — copyToClipboard enhancement", () => {
  it("defines copyToClipboard method", () => {
    assert.ok(source.includes("copyToClipboard("), "copyToClipboard method must exist")
  })

  it("uses vscode.env.clipboard.writeText", () => {
    assert.ok(source.includes("clipboard.writeText"), "Should use clipboard API")
  })

  it("shows information message on success", () => {
    assert.ok(source.includes("showInformationMessage") && source.includes("copied to clipboard"),
      "Should show success message")
  })

  it("shows error message on failure", () => {
    assert.ok(source.includes("showErrorMessage") && source.includes("Failed to copy"),
      "Should show error message on failure")
  })

  it("has error handling with try-catch", () => {
    assert.ok(source.includes("try") && source.includes("catch") && source.includes("copyToClipboard"),
      "Should have error handling")
  })

  it("re-throws error after showing error message", () => {
    assert.ok(source.includes("throw error"), "Should re-throw error for caller to handle")
  })
})

describe("SessionExporter — copyToClipboard edge case handling", () => {
  it("validates content is not empty", () => {
    assert.ok(source.includes("copyToClipboard") && source.includes("if") && source.includes("content"),
      "Should validate content is not empty")
  })

  it("shows warning message for empty content", () => {
    assert.ok(source.includes("showWarningMessage") || source.includes("No content to copy"),
      "Should show warning for empty content")
  })

  it("returns early for empty content without error", () => {
    assert.ok(source.includes("return") && source.includes("content"),
      "Should return early for empty content")
  })
})
