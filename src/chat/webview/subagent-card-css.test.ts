import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

// CSS-contract test (mirrors messages-css / question-bar-css style): the
// subagent-card renderer emits these classes, so blocks.css must style them.
const blocks = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")
const layout = readFileSync(path.join(__dirname, "css", "layout.css"), "utf8")

describe("subagent-card CSS contract", () => {
  for (const cls of [
    ".subagent-card",
    ".subagent-card--completed",
    ".subagent-card--failed",
    ".subagent-card-header",
    ".subagent-card-title",
    ".subagent-card-purpose",
    ".subagent-card-status--running",
    ".subagent-card-duration",
    ".subagent-card-body",
    ".subagent-card-section--error",
    ".subagent-card-debug",
  ]) {
    it(`styles ${cls}`, () => {
      assert.ok(blocks.includes(cls), `${cls} must be defined in blocks.css`)
    })
  }

  it("running status pulses but respects reduced motion", () => {
    assert.match(blocks, /\.subagent-card-status--running\s*{[^}]*animation:\s*badge-pulse/s)
    assert.match(blocks, /prefers-reduced-motion: reduce[\s\S]*\.subagent-card-status--running\s*{\s*animation:\s*none/)
  })

  it("header toggle badge is styled and hides when empty", () => {
    assert.ok(layout.includes(".header-badge"), ".header-badge must be defined in layout.css")
    assert.match(layout, /\.header-badge\.hidden\s*{\s*display:\s*none/)
  })
})
