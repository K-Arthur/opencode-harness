/**
 * Structural tests for the reinstall-extension script (VSCodium support).
 *
 * The script is a Node CLI, not a module, so these tests read its source and
 * assert the expected shapes without executing it.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "reinstall-extension.mjs"), "utf8")

describe("reinstall-extension.mjs — VS Code-based editor support", () => {
  it("accepts a --code=... CLI flag", () => {
    assert.ok(source.includes('a.startsWith("--code=")'), "parses --code flag")
    assert.ok(source.includes('codeArg.split("=")[1]'), "extracts CLI name from flag")
  })

  it("falls back to codium when code is not available", () => {
    // Must contain a function that resolves the CLI by probing available binaries.
    assert.ok(source.includes("resolveCodeCli"), "defines resolveCodeCli helper")
    const block = source.slice(source.indexOf("resolveCodeCli"), source.indexOf("resolveCodeCli") + 600)
    assert.ok(block.includes("code") && block.includes("codium"), "probes code and codium CLIs")
  })

  it("prunes VSCodium extension directories", () => {
    assert.ok(source.includes(".vscode-oss"), "includes VSCodium OSS extension root")
    assert.ok(source.includes(".vscode"), "includes VS Code extension root")
  })
})
