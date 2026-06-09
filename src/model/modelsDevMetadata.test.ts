/**
 * Behavioral tests for the models.dev context-window fallback.
 *
 * Why this exists: when our opencode server's `/config/providers` does
 * not report `limit.context` for a model (which is common for opencode
 * free-tier models like deepseek-v4-flash-free and kimi-k2.5-free),
 * the UI goes dark — no progress bar, no token counter. models.dev
 * publishes a free, no-auth `/api.json` endpoint that lists every model
 * opencode knows about, including the opencode-only free SKUs that
 * OpenRouter never sees. Since models.dev is what opencode itself uses
 * as its model catalogue, it is the authoritative fallback source.
 *
 * These tests pin:
 *   - parsing models.dev's provider→models→limit response shape
 *   - the short-id lookup that drops the provider prefix
 *   - the disk-cache freshness window (24h)
 *   - graceful failure when the network is unreachable
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  parseModelsDevModels,
  lookupModelsDevEntry,
  isCacheFresh,
  type ModelsDevEntry,
} from "./modelsDevMetadata"

describe("parseModelsDevModels", () => {
  it("extracts provider/model→{contextWindow,outputLimit} from the models.dev /api.json response shape", () => {
    const fixture = {
      opencode: {
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          "deepseek-v4-flash-free": {
            id: "deepseek-v4-flash-free",
            name: "DeepSeek V4 Flash Free",
            limit: { context: 200000, output: 128000 },
          },
          "kimi-k2.5-free": {
            id: "kimi-k2.5-free",
            name: "Kimi K2.5 Free",
            limit: { context: 262144, output: 262144 },
          },
        },
      },
      "opencode-go": {
        id: "opencode-go",
        name: "OpenCode Go",
        models: {
          "deepseek-v4-flash": {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            limit: { context: 1000000, output: 384000 },
          },
        },
      },
    }
    const map = parseModelsDevModels(fixture)
    assert.deepEqual(map.get("opencode/deepseek-v4-flash-free"), { contextWindow: 200000, outputLimit: 128000 })
    assert.deepEqual(map.get("opencode/kimi-k2.5-free"), { contextWindow: 262144, outputLimit: 262144 })
    assert.deepEqual(map.get("opencode-go/deepseek-v4-flash"), { contextWindow: 1000000, outputLimit: 384000 })
  })

  it("also indexes by short model id (without provider prefix) so cross-provider lookups work", () => {
    const fixture = {
      opencode: {
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          "deepseek-v4-flash-free": {
            id: "deepseek-v4-flash-free",
            name: "DeepSeek V4 Flash Free",
            limit: { context: 200000, output: 128000 },
          },
        },
      },
    }
    const map = parseModelsDevModels(fixture)
    assert.deepEqual(map.get("deepseek-v4-flash-free"), { contextWindow: 200000, outputLimit: 128000 })
  })

  it("includes models with output-only limits (output undefined means no data)", () => {
    const fixture = {
      opencode: {
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          "output-only": {
            id: "output-only",
            name: "Output Only",
            limit: { context: 65536 },
          },
        },
      },
    }
    const map = parseModelsDevModels(fixture)
    assert.deepEqual(map.get("opencode/output-only"), { contextWindow: 65536 })
    // outputLimit should be undefined
    assert.equal(map.get("opencode/output-only")!.outputLimit, undefined)
  })

  it("ignores entries with missing or non-numeric limit.context", () => {
    const fixture = {
      provider: {
        id: "provider",
        models: {
          good: { id: "good", limit: { context: 100000 } },
          missing: { id: "missing" },
          "no-limit": { id: "no-limit", limit: {} },
          "junk-ctx": { id: "junk-ctx", limit: { context: "lots" } },
          "neg-ctx": { id: "neg-ctx", limit: { context: -1 } },
        },
      },
    }
    const map = parseModelsDevModels(fixture)
    assert.deepEqual(map.get("provider/good"), { contextWindow: 100000 })
    assert.equal(map.has("provider/missing"), false)
    assert.equal(map.has("provider/no-limit"), false)
    assert.equal(map.has("provider/junk-ctx"), false)
    assert.equal(map.has("provider/neg-ctx"), false)
  })

  it("tolerates a missing or non-object payload without throwing", () => {
    assert.equal(parseModelsDevModels({}).size, 0)
    assert.equal(parseModelsDevModels(null).size, 0)
    assert.equal(parseModelsDevModels(undefined).size, 0)
    assert.equal(parseModelsDevModels("garbage").size, 0)
  })

  it("tolerates a provider entry with no models field", () => {
    const fixture = { myprovider: { id: "myprovider", name: "My Provider" } }
    assert.equal(parseModelsDevModels(fixture).size, 0)
  })
})

describe("lookupModelsDevEntry", () => {
  it("matches by exact provider/model id first, then by short id, then returns undefined", () => {
    const map = new Map<string, ModelsDevEntry>([
      ["opencode/deepseek-v4-flash-free", { contextWindow: 200000, outputLimit: 128000 }],
      ["deepseek-v4-flash-free", { contextWindow: 200000, outputLimit: 128000 }],
    ])
    assert.deepEqual(lookupModelsDevEntry(map, "opencode/deepseek-v4-flash-free"), { contextWindow: 200000, outputLimit: 128000 })
    assert.deepEqual(lookupModelsDevEntry(map, "anyprovider/deepseek-v4-flash-free"), { contextWindow: 200000, outputLimit: 128000 })
    assert.equal(lookupModelsDevEntry(map, "unknown/model"), undefined)
  })

  it("is case-insensitive on the short id so casing differences still resolve", () => {
    const map = new Map<string, ModelsDevEntry>([["glm-5-free", { contextWindow: 204800, outputLimit: 131072 }]])
    assert.deepEqual(lookupModelsDevEntry(map, "anyhost/GLM-5-free"), { contextWindow: 204800, outputLimit: 131072 })
  })
})

describe("isCacheFresh (models.dev)", () => {
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
