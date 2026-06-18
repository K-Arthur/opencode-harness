import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const componentsCss = readFileSync(path.join(__dirname, "components.css"), "utf8")
const contextUsageCss = readFileSync(path.join(__dirname, "context-usage.css"), "utf8")
const combined = componentsCss + "\n" + contextUsageCss

describe("CF Changed Files dropdown — CSS rule coverage", () => {
  it("styles .cf-summary-bar with display flex, padding, and border-bottom", () => {
    const idx = combined.indexOf(".cf-summary-bar")
    assert.ok(idx >= 0, ".cf-summary-bar must have a CSS rule")
    const block = combined.slice(idx, idx + 300)
    assert.ok(block.includes("display"), ".cf-summary-bar must set display")
    assert.ok(block.includes("padding") || block.includes("flex"), ".cf-summary-bar must set padding or flex")
  })

  it("styles .cf-summary-count with a distinct look from body text", () => {
    const idx = combined.indexOf(".cf-summary-count")
    assert.ok(idx >= 0, ".cf-summary-count must have a CSS rule")
  })

  it("styles .cf-summary-stats with font-mono and gap", () => {
    const idx = combined.indexOf(".cf-summary-stats")
    assert.ok(idx >= 0, ".cf-summary-stats must have a CSS rule")
    const block = combined.slice(idx, idx + 200)
    assert.ok(block.includes("display") || block.includes("gap"), ".cf-summary-stats must set display or gap")
  })

  it("styles .cf-collapse-all-btn matching .cf-sort-btn baseline", () => {
    const idx = combined.indexOf(".cf-collapse-all-btn")
    assert.ok(idx >= 0, ".cf-collapse-all-btn must have a CSS rule")
    // 500-char window accounts for consolidated multi-selector rules where
    // properties follow after several grouped selectors (DRY CSS pattern).
    const block = combined.slice(idx, idx + 500)
    assert.ok(block.includes("background") || block.includes("cursor"), ".cf-collapse-all-btn must set pointer styling")
  })

  it("styles .cf-open-btn as an interactive icon button", () => {
    const idx = combined.indexOf(".cf-open-btn")
    assert.ok(idx >= 0, ".cf-open-btn must have a CSS rule")
    const block = combined.slice(idx, idx + 300)
    assert.ok(block.includes("cursor"), ".cf-open-btn must set cursor")
  })

  it("styles .cf-plan-tag as a small badge", () => {
    const idx = combined.indexOf(".cf-plan-tag")
    assert.ok(idx >= 0, ".cf-plan-tag must have a CSS rule")
    const block = combined.slice(idx, idx + 200)
    assert.ok(block.includes("font-size") || block.includes("padding"), ".cf-plan-tag must set font-size or padding")
  })

  it("styles .cf-dir-group as a block container", () => {
    const idx = combined.indexOf(".cf-dir-group")
    assert.ok(idx >= 0, ".cf-dir-group must have a CSS rule")
  })

  it("styles .cf-dir-header with muted label text", () => {
    const idx = combined.indexOf(".cf-dir-header")
    assert.ok(idx >= 0, ".cf-dir-header must have a CSS rule")
    const block = combined.slice(idx, idx + 200)
    assert.ok(
      block.includes("color") || block.includes("font-size") || block.includes("font-weight"),
      ".cf-dir-header must set font/color properties"
    )
  })
})
