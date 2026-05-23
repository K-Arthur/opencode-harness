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

  it("does not throw when context chip elements are unavailable", () => {
    assert.ok(source.includes("if (!els.contextBar || !els.contextChips)"))
    assert.ok(source.includes("Context chip container missing"))
  })

  it("applies CSS custom properties via root.style.setProperty", () => {
    assert.ok(source.includes("root.style.setProperty"))
  })

  it("handles rate limit with reset delay", () => {
    assert.ok(source.includes("rate-limit-notice"))
    assert.ok(source.includes("Rate limit exceeded"))
  })

  it("shows context usage percentage", () => {
    assert.ok(source.includes(".context-text"))
    assert.ok(source.includes("usage.percent"))
    assert.ok(source.includes(".context-progress-fill"))
  })

  it("shows tokens-only when maxTokens is unknown, with a clickable 'set limit' affordance (0.2.15)", () => {
    // 0.2.13 dropped a tooltip pointing at the override command. 0.2.15
    // makes the row itself clickable via the `needs-override` marker so
    // the user can fix the missing window in one click. Lock both:
    //   - the visible "set limit" hint (text)
    //   - the marker the click handler in tabs.ts keys off of
    assert.ok(
      source.includes("set limit"),
      "must show a 'set limit' affordance when maxTokens is unknown",
    )
    assert.ok(
      source.includes("Tokens-only display when maxTokens is unknown"),
      "must keep the inline comment so the rationale survives a future refactor",
    )
    assert.ok(
      source.includes("needs-override"),
      "must set a marker the click handler can key off of so the row routes to the override dialog",
    )
  })
})
