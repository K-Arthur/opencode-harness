import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CONTEXT,
  DEFAULT_OLLAMA_HOST,
  buildCustomProviderConfig,
  buildOllamaProviderConfig,
  extractOllamaModelIds,
  extractOllamaModelInfo,
  fetchOllamaModelDetails,
  fetchOllamaModelIds,
  mergeCustomProviderConfig,
  mergeOllamaConfig,
  normalizeOllamaHost,
  normalizeProviderId,
  redactConfigSecrets,
  resolveOllamaEndpoints,
} from "./OllamaConfigService"

describe("OllamaConfigService", () => {
  it("builds an OpenCode Ollama provider from Ollama tags", () => {
    const modelIds = extractOllamaModelIds({
      models: [
        { name: "qwen3.5:4b", model: "qwen3.5:4b" },
        { model: "llama3.2:latest" },
      ],
    })

    const provider = buildOllamaProviderConfig(modelIds)

    assert.equal(provider.npm, "@ai-sdk/openai-compatible")
    assert.equal(provider.name, "Ollama (local)")
    assert.equal(provider.options?.baseURL, DEFAULT_OLLAMA_BASE_URL)
    assert.deepEqual(Object.keys(provider.models ?? {}), ["qwen3.5:4b", "llama3.2:latest"])
    assert.equal(provider.models?.["qwen3.5:4b"]?.id, "qwen3.5:4b")
    assert.equal(provider.models?.["llama3.2:latest"]?.name, "llama3.2:latest")
  })

  it("merges Ollama config without dropping existing OpenCode config", () => {
    const existing = {
      plugin: ["@different-ai/opencode-browser"],
      model: "opencode/big-pickle",
      mcp: {
        context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
      },
      provider: {
        anthropic: { options: { apiKey: "kept" } },
        ollama: {
          name: "Existing Ollama",
          options: { baseURL: "http://localhost:11434/v1", timeout: false },
          models: {
            "existing:latest": { id: "existing:latest", name: "Existing" },
          },
        },
      },
    }

    const merged = mergeOllamaConfig(existing, ["qwen3.5:4b"])

    assert.deepEqual(merged.plugin, existing.plugin)
    assert.equal(merged.model, "opencode/big-pickle")
    assert.deepEqual(merged.mcp, existing.mcp)
    assert.equal(merged.provider?.anthropic?.options?.apiKey, "kept")
    assert.equal(merged.provider?.ollama?.options?.timeout, false)
    assert.equal(merged.provider?.ollama?.models?.["existing:latest"]?.name, "Existing")
    assert.equal(merged.provider?.ollama?.models?.["qwen3.5:4b"]?.id, "qwen3.5:4b")
  })

  it("declares a fallback context window so the token gauge is never blank", () => {
    const provider = buildOllamaProviderConfig(["llama3.2:latest"])
    assert.equal(provider.models?.["llama3.2:latest"]?.limit?.context, DEFAULT_OLLAMA_CONTEXT)
  })

  it("uses the probed context window and tool capability when provided", () => {
    const provider = buildOllamaProviderConfig([
      { id: "qwen3.5:4b", contextLength: 32768, supportsTools: true },
      { id: "gemma2:2b", contextLength: 8192, supportsTools: false },
    ])
    assert.equal(provider.models?.["qwen3.5:4b"]?.limit?.context, 32768)
    assert.equal(provider.models?.["qwen3.5:4b"]?.tool_call, true)
    // Honest capability: a model without tool support is not advertised as tool-capable.
    assert.equal(provider.models?.["gemma2:2b"]?.tool_call, false)
  })
})

describe("extractOllamaModelInfo", () => {
  it("reads architecture-prefixed context length and tool capability from /api/show", () => {
    const info = extractOllamaModelInfo({
      capabilities: ["completion", "tools"],
      model_info: { "qwen2.context_length": 32768, "general.architecture": "qwen2" },
    })
    assert.equal(info.contextLength, 32768)
    assert.equal(info.supportsTools, true)
  })

  it("returns empty info for unusable payloads", () => {
    assert.deepEqual(extractOllamaModelInfo(null), {})
    assert.deepEqual(extractOllamaModelInfo({ model_info: {} }), {})
  })
})

describe("normalizeOllamaHost / resolveOllamaEndpoints", () => {
  it("adds a scheme and strips accidental /v1 or /api suffixes", () => {
    assert.equal(normalizeOllamaHost("localhost:11434"), "http://localhost:11434")
    assert.equal(normalizeOllamaHost("http://localhost:11434/v1"), "http://localhost:11434")
    assert.equal(normalizeOllamaHost("http://localhost:11434/api/tags"), "http://localhost:11434")
    assert.equal(normalizeOllamaHost("  "), DEFAULT_OLLAMA_HOST)
  })

  it("derives every endpoint from a single host so they can't drift", () => {
    const ep = resolveOllamaEndpoints("http://192.168.1.5:11434")
    assert.equal(ep.tagsUrl, "http://192.168.1.5:11434/api/tags")
    assert.equal(ep.showUrl, "http://192.168.1.5:11434/api/show")
    assert.equal(ep.baseURL, "http://192.168.1.5:11434/v1")
  })

  it("defaults the canonical base URL to the canonical host", () => {
    assert.equal(DEFAULT_OLLAMA_BASE_URL, `${DEFAULT_OLLAMA_HOST}/v1`)
  })
})

describe("fetchOllamaModelIds error handling", () => {
  it("raises an actionable message when Ollama is unreachable", async () => {
    const fetchImpl = (async () => {
      const err = new TypeError("fetch failed")
      ;(err as { cause?: unknown }).cause = { code: "ECONNREFUSED" }
      throw err
    }) as unknown as typeof fetch

    await assert.rejects(
      () => fetchOllamaModelIds(fetchImpl, "http://127.0.0.1:11434/api/tags"),
      /Could not reach Ollama/,
    )
  })
})

describe("custom OpenAI-compatible providers", () => {
  it("derives a safe provider id from a display name", () => {
    assert.equal(normalizeProviderId("Together AI"), "together-ai")
    assert.equal(normalizeProviderId("  My.Local_Server  "), "my.local_server")
    assert.equal(normalizeProviderId("***"), "")
  })

  it("builds an openai-compatible provider block with key and models", () => {
    const provider = buildCustomProviderConfig({
      id: "together",
      name: "Together AI",
      baseURL: "https://api.together.xyz/v1",
      apiKey: "sk-secret",
      modelIds: ["mixtral-8x7b", "llama-3.3-70b"],
    })
    assert.equal(provider.npm, "@ai-sdk/openai-compatible")
    assert.equal(provider.name, "Together AI")
    assert.equal(provider.options?.baseURL, "https://api.together.xyz/v1")
    assert.equal(provider.options?.apiKey, "sk-secret")
    assert.deepEqual(Object.keys(provider.models ?? {}), ["mixtral-8x7b", "llama-3.3-70b"])
  })

  it("omits apiKey for keyless/local endpoints", () => {
    const provider = buildCustomProviderConfig({
      id: "local",
      name: "Local vLLM",
      baseURL: "http://localhost:8000/v1",
      modelIds: ["my-model"],
    })
    assert.equal(provider.options?.apiKey, undefined)
  })

  it("merges into existing config without clobbering other providers", () => {
    const existing = {
      provider: { anthropic: { options: { apiKey: "kept" } } },
    }
    const merged = mergeCustomProviderConfig(existing, {
      id: "together",
      name: "Together AI",
      baseURL: "https://api.together.xyz/v1",
      apiKey: "sk-new",
      modelIds: ["mixtral-8x7b"],
    })
    assert.equal(merged.provider?.anthropic?.options?.apiKey, "kept")
    assert.equal(merged.provider?.together?.options?.baseURL, "https://api.together.xyz/v1")
    assert.equal(merged.provider?.together?.models?.["mixtral-8x7b"]?.id, "mixtral-8x7b")
  })
})

describe("redactConfigSecrets", () => {
  it("masks API keys anywhere while preserving structure, without mutating input", () => {
    const config = {
      provider: {
        anthropic: { options: { apiKey: "sk-real", baseURL: "https://x/v1" } },
        together: { options: { api_key: "tok", token: "abc" } },
      },
    }
    const redacted = redactConfigSecrets(config)
    assert.notEqual(redacted.provider.anthropic.options.apiKey, "sk-real")
    assert.equal(redacted.provider.anthropic.options.baseURL, "https://x/v1")
    assert.notEqual(redacted.provider.together.options.api_key, "tok")
    assert.notEqual(redacted.provider.together.options.token, "abc")
    // Original object is untouched.
    assert.equal(config.provider.anthropic.options.apiKey, "sk-real")
  })
})

describe("fetchOllamaModelDetails", () => {
  it("enriches ids with probed info and tolerates per-model failures", async () => {
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { model?: string }
      if (body.model === "good:latest") {
        return {
          ok: true,
          json: async () => ({ capabilities: ["tools"], model_info: { "llama.context_length": 16384 } }),
        }
      }
      return { ok: false, json: async () => ({}) }
    }) as unknown as typeof fetch

    const details = await fetchOllamaModelDetails(["good:latest", "bad:latest"], fetchImpl, "http://x/api/show")
    const good = details.find((d) => d.id === "good:latest")
    const bad = details.find((d) => d.id === "bad:latest")
    assert.equal(good?.contextLength, 16384)
    assert.equal(good?.supportsTools, true)
    assert.deepEqual(bad, { id: "bad:latest" })
  })
})
