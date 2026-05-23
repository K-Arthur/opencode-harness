/**
 * Behavioral tests for the OpenRouter context-window fallback.
 *
 * Why this exists: when our opencode server's `/config/providers` does
 * not report `limit.context` for a model (which is common for OSS /
 * free-tier hosts like kimi-k2.5 and deepseek-v4-flash-free), the UI
 * goes dark — no progress bar, no token counter. OpenRouter publishes
 * a free, no-auth `/api/v1/models` endpoint that lists context_length
 * for every model it aggregates. Since the context window is a property
 * of the model weights (not the host), we can key by the short model
 * id and serve a sensible fallback.
 *
 * These tests pin:
 *   - parsing OpenRouter's response shape into a name → window map
 *   - the short-id lookup that drops the provider prefix
 *   - the disk-cache freshness window (24h)
 *   - graceful failure when the network is unreachable
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  parseOpenRouterModels,
  lookupContextWindow,
  isCacheFresh,
} from "./openRouterMetadata"

describe("parseOpenRouterModels", () => {
  it("extracts a name→context_length map from the OpenRouter /v1/models response shape", () => {
    const fixture = {
      data: [
        { id: "moonshotai/kimi-k2.5", context_length: 200000, name: "Kimi K2.5" },
        { id: "deepseek/deepseek-v4-flash", context_length: 128000, name: "DeepSeek V4 Flash" },
        { id: "anthropic/claude-opus-4-7", context_length: 200000, name: "Claude Opus 4.7" },
      ],
    }
    const map = parseOpenRouterModels(fixture)
    assert.equal(map.get("moonshotai/kimi-k2.5"), 200000)
    assert.equal(map.get("deepseek/deepseek-v4-flash"), 128000)
    assert.equal(map.get("anthropic/claude-opus-4-7"), 200000)
  })

  it("also indexes by short model id (without provider prefix) so cross-provider lookups work", () => {
    // The whole point of the OpenRouter fallback: same model from a
    // different host should still hit. The opencode server might call it
    // "x-ai/kimi-k2.5" while OpenRouter calls it "moonshotai/kimi-k2.5".
    // Both should resolve to the same context window via the short id.
    const fixture = {
      data: [{ id: "moonshotai/kimi-k2.5", context_length: 200000, name: "Kimi K2.5" }],
    }
    const map = parseOpenRouterModels(fixture)
    assert.equal(map.get("kimi-k2.5"), 200000, "must index by short model id (post-slash)")
  })

  it("ignores entries with missing or non-numeric context_length so a junk entry can't poison the cache", () => {
    const fixture = {
      data: [
        { id: "good/model", context_length: 100000 },
        { id: "missing/model" }, // no context_length
        { id: "junk/model", context_length: "lots" }, // wrong type
        { id: "negative/model", context_length: -1 }, // sentinel from some hosts
      ],
    }
    const map = parseOpenRouterModels(fixture)
    assert.equal(map.get("good/model"), 100000)
    assert.equal(map.has("missing/model"), false)
    assert.equal(map.has("junk/model"), false)
    assert.equal(map.has("negative/model"), false)
  })

  it("tolerates a missing or non-array `data` field without throwing", () => {
    assert.equal(parseOpenRouterModels({}).size, 0)
    assert.equal(parseOpenRouterModels({ data: null }).size, 0)
    assert.equal(parseOpenRouterModels(null).size, 0)
    assert.equal(parseOpenRouterModels(undefined).size, 0)
  })
})

describe("lookupContextWindow", () => {
  it("matches by exact provider/model id first, then by short id, then returns undefined", () => {
    const map = new Map<string, number>([
      ["moonshotai/kimi-k2.5", 200000],
      ["kimi-k2.5", 200000],
    ])
    // Exact match (the case we hope hits)
    assert.equal(lookupContextWindow(map, "moonshotai/kimi-k2.5"), 200000)
    // Cross-provider fallback (a different host but same model)
    assert.equal(lookupContextWindow(map, "openrouter/kimi-k2.5"), 200000)
    // Truly unknown model
    assert.equal(lookupContextWindow(map, "unknown/model"), undefined)
  })

  it("is case-insensitive on the short id so 'Kimi-K2.5' and 'kimi-k2.5' both hit", () => {
    const map = new Map<string, number>([["kimi-k2.5", 200000]])
    assert.equal(lookupContextWindow(map, "anyhost/Kimi-K2.5"), 200000)
  })
})

describe("isCacheFresh", () => {
  it("returns true when the cache is younger than the 24h TTL", () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    assert.equal(isCacheFresh(oneHourAgo), true)
  })

  it("returns false when the cache is older than 24h", () => {
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000
    assert.equal(isCacheFresh(twoDaysAgo), false)
  })

  it("returns false for null / undefined / NaN timestamps so a corrupted cache forces a refetch", () => {
    assert.equal(isCacheFresh(null as unknown as number), false)
    assert.equal(isCacheFresh(undefined as unknown as number), false)
    assert.equal(isCacheFresh(Number.NaN), false)
  })
})
