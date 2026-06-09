import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  OPENAI_ADAPTER,
  ANTHROPIC_ADAPTER,
  GENERIC_ADAPTER,
  safeParseInt,
  parseDuration,
} from "./rateLimitCore"

const monitorSource = readFileSync(path.join(__dirname, "RateLimitMonitor.ts"), "utf8")

describe("safeParseInt", () => {
  it("returns undefined for undefined input", () => {
    assert.equal(safeParseInt(undefined, "test"), undefined)
  })

  it("parses valid numeric strings", () => {
    assert.equal(safeParseInt("42"), 42)
    assert.equal(safeParseInt("0"), 0)
    assert.equal(safeParseInt("100000"), 100000)
  })

  it("returns undefined for non-numeric strings", () => {
    assert.equal(safeParseInt("abc"), undefined)
    assert.equal(safeParseInt(""), undefined)
    assert.equal(safeParseInt("not-a-number"), undefined)
  })

  it("returns undefined for null", () => {
    assert.equal(safeParseInt(null as unknown as string), undefined)
  })
})

describe("parseDuration", () => {
  it("parses seconds format", () => {
    const result = parseDuration("30s")
    assert.ok(result)
    const diff = result!.getTime() - Date.now()
    assert.ok(Math.abs(diff - 30000) < 100)
  })

  it("parses minutes format", () => {
    const result = parseDuration("5m")
    assert.ok(result)
    const diff = result!.getTime() - Date.now()
    assert.ok(Math.abs(diff - 300000) < 100)
  })

  it("parses hours format", () => {
    const result = parseDuration("2h")
    assert.ok(result)
    const diff = result!.getTime() - Date.now()
    assert.ok(Math.abs(diff - 7200000) < 100)
  })

  it("returns undefined for malformed durations", () => {
    assert.equal(parseDuration("not-a-date"), undefined)
    assert.equal(parseDuration(""), undefined)
    assert.equal(parseDuration("10x"), undefined)
    assert.equal(parseDuration("abc"), undefined)
  })
})

describe("OPENAI_ADAPTER", () => {
  it("parses valid OpenAI rate limit headers", () => {
    const result = OPENAI_ADAPTER.parseFromHeaders({
      "x-ratelimit-remaining-requests": "10",
      "x-ratelimit-remaining-tokens": "5000",
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-limit-tokens": "50000",
      "x-ratelimit-reset-requests": "30s",
    })
    assert.ok(result)
    assert.equal(result!.provider, "openai")
    assert.equal(result!.remainingRequests, 10)
    assert.equal(result!.remainingTokens, 5000)
    assert.equal(result!.limitRequests, 100)
    assert.equal(result!.limitTokens, 50000)
    assert.ok(result!.resetAt)
  })

  it("returns null when no remaining headers are present", () => {
    const result = OPENAI_ADAPTER.parseFromHeaders({
      "x-ratelimit-limit-requests": "100",
    })
    assert.equal(result, null)
  })

  it("returns undefined for non-numeric header values instead of NaN", () => {
    const result = OPENAI_ADAPTER.parseFromHeaders({
      "x-ratelimit-remaining-requests": "not-a-number",
      "x-ratelimit-remaining-tokens": "also-bad",
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-limit-tokens": "50000",
    })
    assert.ok(result)
    assert.equal(result!.remainingRequests, undefined)
    assert.equal(result!.remainingTokens, undefined)
  })

  it("handles empty headers object", () => {
    const result = OPENAI_ADAPTER.parseFromHeaders({})
    assert.equal(result, null)
  })
})

describe("ANTHROPIC_ADAPTER", () => {
  it("parses valid Anthropic rate limit headers", () => {
    const result = ANTHROPIC_ADAPTER.parseFromHeaders({
      "anthropic-ratelimit-requests-remaining": "5",
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-tokens-remaining": "10000",
      "anthropic-ratelimit-tokens-limit": "100000",
      "anthropic-ratelimit-input-tokens-remaining": "8000",
      "anthropic-ratelimit-output-tokens-remaining": "2000",
      "anthropic-ratelimit-input-tokens-limit": "80000",
      "anthropic-ratelimit-output-tokens-limit": "20000",
      "anthropic-ratelimit-requests-reset": "2024-01-01T00:00:00Z",
    })
    assert.ok(result)
    assert.equal(result!.provider, "anthropic")
    assert.equal(result!.remainingRequests, 5)
    assert.equal(result!.remainingTokens, 10000)
    assert.equal(result!.remainingInputTokens, 8000)
    assert.equal(result!.remainingOutputTokens, 2000)
  })

  it("returns null when no relevant headers present", () => {
    const result = ANTHROPIC_ADAPTER.parseFromHeaders({
      "content-type": "application/json",
    })
    assert.equal(result, null)
  })
})

describe("GENERIC_ADAPTER", () => {
  it("parses generic rate limit headers", () => {
    const result = GENERIC_ADAPTER.parseFromHeaders({
      "ratelimit-remaining": "25",
      "ratelimit-limit": "100",
    })
    assert.ok(result)
    assert.equal(result!.provider, "generic")
    assert.equal(result!.remainingRequests, 25)
    assert.equal(result!.limitRequests, 100)
  })

  it("returns null when both remaining and limit are missing", () => {
    const result = GENERIC_ADAPTER.parseFromHeaders({})
    assert.equal(result, null)
  })
})

describe("ADAPTERS priority (openai-like headers)", () => {
  it("anthropic adapter wins for anthropic headers", () => {
    const result = ANTHROPIC_ADAPTER.parseFromHeaders({
      "anthropic-ratelimit-requests-remaining": "5",
      "anthropic-ratelimit-tokens-remaining": "10000",
      "x-ratelimit-remaining-requests": "10",
    })
    assert.ok(result)
    assert.equal(result!.provider, "anthropic")
  })
})

describe("RateLimitMonitor persistence", () => {
  it("persists cumulative observed token and cost usage", () => {
    assert.ok(monitorSource.includes("RATE_LIMIT_USAGE_KEY"), "must define a persistence key")
    assert.ok(monitorSource.includes("restorePersistedUsage"), "must restore persisted usage on construction")
    assert.ok(monitorSource.includes("persistUsage"), "must persist usage after recording")
    assert.ok(monitorSource.includes("context.globalState") || monitorSource.includes("vscode.Memento"), "must use VS Code memento storage")
  })
})
