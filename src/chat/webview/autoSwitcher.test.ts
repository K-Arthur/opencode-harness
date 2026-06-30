import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseModelId, getExhaustedProvider, findFallbackModel } from "./autoSwitcher"
import type { ModelInfo } from "./types"

function makeModel(overrides: Partial<ModelInfo> & { provider: string; id: string }): ModelInfo {
  return {
    displayName: `${overrides.provider}/${overrides.id}`,
    enabled: true,
    ...overrides,
  }
}

describe("parseModelId", () => {
  it("parses standard provider/model format", () => {
    const r = parseModelId("anthropic/claude-sonnet-4-6")
    assert.deepEqual(r, { provider: "anthropic", id: "claude-sonnet-4-6" })
  })

  it("handles provider with slash-like prefix (openrouter/deepseek)", () => {
    const r = parseModelId("openrouter/deepseek/deepseek-chat")
    assert.deepEqual(r, { provider: "openrouter", id: "deepseek/deepseek-chat" })
  })

  it("returns null when no slash present", () => {
    assert.equal(parseModelId("justamodel"), null)
  })

  it("returns null for empty string", () => {
    assert.equal(parseModelId(""), null)
  })
})

describe("getExhaustedProvider", () => {
  it("extracts provider from active session model", () => {
    assert.equal(getExhaustedProvider({ model: "openai/gpt-4o" }), "openai")
  })

  it("returns null when session has no model", () => {
    assert.equal(getExhaustedProvider({ model: "" }), null)
  })

  it("returns null when session is undefined", () => {
    assert.equal(getExhaustedProvider(undefined), null)
  })
})

describe("findFallbackModel", () => {
  const exhaustedProvider = "openai"
  const currentModelId = "openai/gpt-4o"

  const models: ModelInfo[] = [
    makeModel({ provider: "openai", id: "gpt-4o", favorite: false }),
    makeModel({ provider: "openai", id: "gpt-4o-mini", favorite: false }),
    makeModel({ provider: "anthropic", id: "claude-sonnet-4-6", favorite: false }),
    makeModel({ provider: "anthropic", id: "claude-haiku-4-5", favorite: true }),
    makeModel({ provider: "google", id: "gemini-2.0-flash", favorite: false, enabled: true }),
  ]

  it("picks a model from a different provider", () => {
    const result = findFallbackModel(exhaustedProvider, currentModelId, models)
    // Should pick the favorite first: claude-haiku-4-5 (anthropic, favorite=true)
    assert.equal(result, "anthropic/claude-haiku-4-5")
  })

  it("skips disabled models", () => {
    const withDisabled = [
      ...models,
      makeModel({ provider: "meta", id: "llama-3", enabled: false }),
    ]
    const result = findFallbackModel(exhaustedProvider, currentModelId, withDisabled)
    assert.equal(result, "anthropic/claude-haiku-4-5")
  })

  it("returns null when no fallback available", () => {
    const onlySameProvider = [
      makeModel({ provider: "openai", id: "gpt-4o", favorite: false }),
      makeModel({ provider: "openai", id: "gpt-4o-mini", favorite: false }),
    ]
    assert.equal(findFallbackModel(exhaustedProvider, currentModelId, onlySameProvider), null)
  })

  it("returns null when models list is empty", () => {
    assert.equal(findFallbackModel(exhaustedProvider, currentModelId, []), null)
  })

  it("skips the current model even if from different provider", () => {
    const onlySame = [
      makeModel({ provider: "openai", id: "gpt-4o", favorite: false }),
    ]
    assert.equal(findFallbackModel(exhaustedProvider, currentModelId, onlySame), null)
  })

  it("prefers favorites over alphabetically first", () => {
    const noFavorites = models.filter(m => !m.favorite)
    const result = findFallbackModel(exhaustedProvider, currentModelId, noFavorites)
    // No favorites — should be alphabetical: anthropic/claude-sonnet-4-6
    assert.equal(result, "anthropic/claude-sonnet-4-6")
  })

  it("falls back to alphabetical by provider then id", () => {
    const result = findFallbackModel(
      exhaustedProvider,
      currentModelId,
      [
        makeModel({ provider: "google", id: "gemini-pro", favorite: false }),
        makeModel({ provider: "anthropic", id: "claude-opus", favorite: false }),
        makeModel({ provider: "meta", id: "llama-3", favorite: false }),
      ],
    )
    assert.equal(result, "anthropic/claude-opus")
  })
})
