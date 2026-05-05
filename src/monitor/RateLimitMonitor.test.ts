import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "RateLimitMonitor.ts"), "utf8")

describe("RateLimitMonitor.ts", () => {
  it("exports RateLimitState interface", () => {
    assert.ok(source.includes("export interface RateLimitState"))
  })

  it("exports RateLimitAdapter interface", () => {
    assert.ok(source.includes("export interface RateLimitAdapter"))
  })

  it("exports OPENAI_ADAPTER constant", () => {
    assert.ok(source.includes("export const OPENAI_ADAPTER"))
  })

  it("exports ANTHROPIC_ADAPTER constant", () => {
    assert.ok(source.includes("export const ANTHROPIC_ADAPTER"))
  })

  it("exports GENERIC_ADAPTER constant", () => {
    assert.ok(source.includes("export const GENERIC_ADAPTER"))
  })

  it("exports ADAPTERS array", () => {
    assert.ok(source.includes("export const ADAPTERS"))
  })

  it("exports RateLimitMonitor class", () => {
    assert.ok(source.includes("export class RateLimitMonitor"))
  })

  it("has updateFromHeaders method", () => {
    assert.ok(source.includes("updateFromHeaders("))
  })

  it("has recordTokenUsage method", () => {
    assert.ok(source.includes("recordTokenUsage("))
  })

  it("has isExhausted getter", () => {
    assert.ok(source.includes("get isExhausted()"))
  })

  it("has startCountdown method", () => {
    assert.ok(source.includes("startCountdown("))
  })

  it("has stopCountdown method", () => {
    assert.ok(source.includes("stopCountdown("))
  })

  it("has onReset event emitter", () => {
    assert.ok(source.includes("_onReset"))
  })

  it("uses min of tokens and requests for status bar", () => {
    assert.ok(source.includes("Math.min") && source.includes("remainingTokens") && source.includes("remainingRequests"))
  })
})
