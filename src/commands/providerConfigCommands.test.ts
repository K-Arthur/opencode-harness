import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const addProviderSource = readFileSync(path.join(__dirname, "addProvider.ts"), "utf8")
const ollamaSource = readFileSync(path.join(__dirname, "ollama.ts"), "utf8")

describe("provider config commands", () => {
  it("does not call a nonexistent SessionManager.updateConfig API", () => {
    assert.ok(!addProviderSource.includes(".updateConfig("), "add provider must not call SessionManager.updateConfig")
    assert.ok(!ollamaSource.includes(".updateConfig("), "configure Ollama must not call SessionManager.updateConfig")
  })

  it("warns when a running local server may need restart after local config writes", () => {
    assert.ok(addProviderSource.includes("Restart or reconnect OpenCode"), "add provider must warn about running local server refresh limits")
    assert.ok(ollamaSource.includes("Restart or reconnect OpenCode"), "configure Ollama must warn about running local server refresh limits")
  })
})
