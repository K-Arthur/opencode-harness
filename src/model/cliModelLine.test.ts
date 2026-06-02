import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseCliModelLine } from "./cliModelLine"

describe("parseCliModelLine", () => {
  it("parses Ollama model IDs that include tags", () => {
    const model = parseCliModelLine("ollama/qwen3.5:4b")

    assert.ok(model)
    assert.equal(model.provider, "ollama")
    assert.equal(model.id, "qwen3.5:4b")
    assert.equal(model.displayName, "qwen3.5:4b")
  })

  it("preserves provider model IDs that contain slashes", () => {
    const model = parseCliModelLine("openrouter/~anthropic/claude-sonnet-latest")

    assert.ok(model)
    assert.equal(model.provider, "openrouter")
    assert.equal(model.id, "~anthropic/claude-sonnet-latest")
  })
})
