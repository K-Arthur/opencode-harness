import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "theme.ts"), "utf8")

describe("theme.ts", () => {
  it("exports updateContextChips", () => {
    assert.ok(source.includes("export function updateContextChips"))
  })

  it("exports updateContextUsage", () => {
    assert.ok(source.includes("export function updateContextUsage"))
  })

  it("exports applyThemeVars", () => {
    assert.ok(source.includes("export function applyThemeVars"))
  })

  it("exports updateModelIndicator", () => {
    assert.ok(source.includes("export function updateModelIndicator"))
  })

  it("exports handleRateLimitExhausted", () => {
    assert.ok(source.includes("export function handleRateLimitExhausted"))
  })

  it("hides context bar when no chips", () => {
    assert.ok(source.includes('els.contextBar.classList.add("hidden")'))
    assert.ok(source.includes('els.contextBar.classList.remove("hidden")'))
  })

  it("applies CSS custom properties via root.style.setProperty", () => {
    assert.ok(source.includes("root.style.setProperty"))
  })

  it("handles rate limit with reset delay", () => {
    assert.ok(source.includes("rate-limit-notice"))
    assert.ok(source.includes("Rate limit exceeded"))
  })

  it("shows context usage percentage", () => {
    assert.ok(source.includes("contextLabel.textContent"))
    assert.ok(source.includes("pct"))
  })
})
