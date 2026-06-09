import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { summarizeOpencodeMessageUsage } from "./sdkUsageSummary"

describe("summarizeOpencodeMessageUsage", () => {
  it("sums opencode assistant message cost and token fields", () => {
    const summary = summarizeOpencodeMessageUsage([
      {
        info: {
          role: "assistant",
          cost: 0.02,
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
        },
        parts: [],
      },
      {
        info: {
          role: "assistant",
          cost: 0.03,
          tokens: { total: 50, input: 40, output: 8, reasoning: 1, cache: { read: 1, write: 0 } },
        },
        parts: [],
      },
    ])

    assert.deepEqual(summary, {
      cost: 0.05,
      tokenUsage: {
        prompt: 140,
        completion: 28,
        reasoning: 6,
        cacheRead: 31,
        cacheWrite: 10,
        total: 215,
      },
    })
  })

  it("ignores user messages and rows without opencode usage", () => {
    const summary = summarizeOpencodeMessageUsage([
      { info: { role: "user", cost: 999, tokens: { input: 999, output: 999, reasoning: 999, cache: { read: 999, write: 999 } } }, parts: [] },
      { info: { role: "assistant" }, parts: [] },
    ])

    assert.equal(summary, undefined)
  })
})
